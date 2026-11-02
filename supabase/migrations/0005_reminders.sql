-- Nurra 0005_reminders: reminder generation and the escalation engine (Stage S5).
-- Apply with: npm run db:migrate
--
-- The engine runs from POST /api/cron/tick with the service role. Everything that must be atomic
-- lives in the functions below (server-only). Clients can read reminders, steps and alerts of their
-- own household (existing RLS) and can write none of them.

-- ---------------------------------------------------------------------------
-- Escalation settings per plan (CARE-4). Minutes. Steps are relative:
--   prompt at due, re-prompt after reprompt_after, [voice call voice_call.after after the
--   re-prompt], family alert family_after after the re-prompt, secondary alert secondary_after
--   after the family alert. Missed at missed_after from due. null = that step is off.
-- ---------------------------------------------------------------------------

alter table public.care_plans
  add column if not exists active boolean not null default true,
  add column if not exists escalation_config jsonb not null default '{
    "critical":  {"reprompt_after": 5,  "voice_call": {"enabled": false, "after": 5},  "family_after": 10,   "secondary_after": 15,   "missed_after": 60},
    "important": {"reprompt_after": 10, "voice_call": {"enabled": false, "after": 10}, "family_after": 20,   "secondary_after": 30,   "missed_after": 90},
    "normal":    {"reprompt_after": 15, "voice_call": {"enabled": false, "after": 15}, "family_after": null, "secondary_after": null, "missed_after": 120}
  }'::jsonb;

-- The 0001 columns are replaced by escalation_config.
alter table public.care_plans
  drop column if exists reprompt_after_min,
  drop column if exists family_alert_after_min,
  drop column if exists secondary_after_min;

-- ---------------------------------------------------------------------------
-- Reminders: one per plan item and due time (REM-1 idempotency)
-- ---------------------------------------------------------------------------

create unique index if not exists reminders_item_due_unique on public.reminders (care_plan_item_id, due_at);
create index if not exists reminders_claim_idx on public.reminders (next_action_at)
  where status in ('scheduled', 'prompted', 'escalating');

-- ---------------------------------------------------------------------------
-- Escalation steps: 0 prompt, 1 re-prompt, 2 voice call, 3 family alert, 4 secondary alert
-- ---------------------------------------------------------------------------

do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.escalation_steps'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%step >= 1%' or pg_get_constraintdef(oid) ilike '%action%')
  loop
    execute format('alter table public.escalation_steps drop constraint %I', c);
  end loop;
end
$$;

alter table public.escalation_steps
  add column if not exists status text not null default 'done',
  add column if not exists detail text;
alter table public.escalation_steps drop constraint if exists escalation_steps_step_range;
alter table public.escalation_steps add constraint escalation_steps_step_range check (step between 0 and 4);
alter table public.escalation_steps drop constraint if exists escalation_steps_action_known;
alter table public.escalation_steps add constraint escalation_steps_action_known
  check (action in ('prompt', 'reprompt', 'voice_call', 'family_alert', 'secondary_alert'));
alter table public.escalation_steps drop constraint if exists escalation_steps_status_known;
alter table public.escalation_steps add constraint escalation_steps_status_known check (status in ('done', 'failed', 'skipped'));
alter table public.escalation_steps drop constraint if exists escalation_steps_detail_code;
alter table public.escalation_steps add constraint escalation_steps_detail_code check (detail is null or detail ~ '^[a-z_]{1,40}$');

-- ---------------------------------------------------------------------------
-- Alerts: which contact, and delivery status (sending is Stage S6)
-- ---------------------------------------------------------------------------

alter table public.alerts
  add column if not exists contact_id uuid,
  add column if not exists delivery_status text;
alter table public.alerts drop constraint if exists alerts_contact_fk;
alter table public.alerts add constraint alerts_contact_fk
  foreign key (contact_id, household_id) references public.contacts (id, household_id) on delete set null (contact_id);
alter table public.alerts drop constraint if exists alerts_delivery_status_known;
alter table public.alerts add constraint alerts_delivery_status_known
  check (delivery_status is null or delivery_status in ('queued', 'sending', 'sent', 'delivered', 'failed'));
create index if not exists alerts_reminder_idx on public.alerts (reminder_id);

alter table public.care_plans drop constraint if exists care_plans_escalation_object;
alter table public.care_plans add constraint care_plans_escalation_object check (jsonb_typeof(escalation_config) = 'object');

-- ---------------------------------------------------------------------------
-- REM-1: reminder times for active plan items, in each patient's timezone (Postgres applies daylight
-- saving; a local time that does not exist on the change day moves forward by the gap).
-- Only active patients, active plans and active items. A medicine item only when its vault medicine is
-- active, within its dates, and approved or clinician-verified.
-- ---------------------------------------------------------------------------

create or replace function private.reminder_candidates(p_from timestamptz, p_to timestamptz)
returns table (item_id uuid, household_id uuid, patient_id uuid, due_at timestamptz)
language sql
stable
set search_path = public
as $$
  with items as (
    select i.id, i.household_id, i.patient_id, i.schedule_kind, i.times_of_day, i.days_of_week,
           i.interval_minutes, i.window_start, i.window_end, i.on_date, i.expires_on,
           p.timezone as tz, m.start_date as med_start, m.stop_date as med_stop
      from public.care_plan_items i
      join public.care_plans cp on cp.id = i.care_plan_id and cp.household_id = i.household_id
      join public.patients p on p.id = i.patient_id and p.household_id = i.household_id
      left join public.medications m on m.id = i.medication_id and m.household_id = i.household_id
     where p.status = 'active'
       and cp.active
       and i.active
       and not i.is_placeholder
       and (i.item_type <> 'medication'
            or (m.id is not null and m.status = 'active' and (m.approved_by is not null or m.verified_by is not null)))
  ),
  days as (
    select it.*, d::date as local_day
      from items it,
           generate_series((p_from at time zone it.tz)::date - 1, (p_to at time zone it.tz)::date + 1, interval '1 day') d
  ),
  live_days as (
    select * from days
     where (expires_on is null or local_day <= expires_on)
       and (med_start is null or local_day >= med_start)
       and (med_stop is null or local_day <= med_stop)
  ),
  candidates as (
    select d.id, d.household_id, d.patient_id, ((d.local_day + t) at time zone d.tz) as due_at
      from live_days d
      cross join lateral unnest(d.times_of_day) t
     where d.schedule_kind = 'times' and extract(dow from d.local_day)::int = any (d.days_of_week)
    union all
    select d.id, d.household_id, d.patient_id, (ts at time zone d.tz)
      from live_days d
      cross join lateral generate_series(d.local_day + d.window_start, d.local_day + d.window_end,
                                         make_interval(mins => d.interval_minutes)) ts
     where d.schedule_kind = 'interval' and extract(dow from d.local_day)::int = any (d.days_of_week)
    union all
    select d.id, d.household_id, d.patient_id, ((d.local_day + t) at time zone d.tz)
      from live_days d
      cross join lateral unnest(d.times_of_day) t
     where d.schedule_kind = 'once' and d.local_day = d.on_date
  )
  select distinct c.id, c.household_id, c.patient_id, c.due_at
    from candidates c
   where c.due_at >= p_from and c.due_at < p_to;
$$;

revoke all on function private.reminder_candidates(timestamptz, timestamptz) from public, anon, authenticated;

-- Creates reminders for [p_now - lookback, p_now + horizon). Idempotent: unique (item, due_at).
-- Also withdraws future reminders that have not started and are no longer in the plan (item stopped,
-- time changed, medicine stopped or no longer approved, patient paused).
create or replace function public.generate_reminders(
  p_now timestamptz,
  p_horizon_hours integer default 24,
  p_lookback_minutes integer default 10
)
returns table (generated integer, withdrawn integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  n_new integer;
  n_gone integer;
begin
  with c as (
    select * from private.reminder_candidates(p_now - make_interval(mins => p_lookback_minutes),
                                              p_now + make_interval(hours => p_horizon_hours))
  ),
  ins as (
    insert into public.reminders (household_id, patient_id, care_plan_item_id, due_at, status, next_action_at)
    select c.household_id, c.patient_id, c.item_id, c.due_at, 'scheduled', c.due_at from c
    on conflict (care_plan_item_id, due_at) do nothing
    returning 1
  ),
  gone as (
    delete from public.reminders r
     where r.status = 'scheduled'
       and r.attempt = 0
       and r.care_plan_item_id is not null
       and r.due_at > p_now
       and r.due_at < p_now + make_interval(hours => p_horizon_hours)
       and not exists (select 1 from c where c.item_id = r.care_plan_item_id and c.due_at = r.due_at)
    returning 1
  )
  select (select count(*) from ins), (select count(*) from gone) into n_new, n_gone;

  generated := n_new;
  withdrawn := n_gone;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- REM-2: claim due reminders with a short lease. SKIP LOCKED: parallel ticks take different rows.
-- A tick that crashes leaves an expired lease, and a later tick takes the row again.
-- ---------------------------------------------------------------------------

create or replace function public.claim_due_reminders(
  p_now timestamptz,
  p_limit integer default 50,
  p_lease_seconds integer default 30
)
returns setof public.reminders
language sql
security definer
set search_path = public
as $$
  update public.reminders r
     set locked_until = p_now + make_interval(secs => p_lease_seconds)
   where r.id in (
     select id from public.reminders
      where status in ('scheduled', 'prompted', 'escalating')
        and next_action_at is not null
        and next_action_at <= p_now
        and (locked_until is null or locked_until <= p_now)
      order by next_action_at
      limit p_limit
      for update skip locked
   )
  returning r.*;
$$;

-- ---------------------------------------------------------------------------
-- REM-4: apply one step atomically. The step row is the idempotency key: ON CONFLICT DO NOTHING on
-- (reminder_id, step); the alert or event is written only when the step row is new.
-- p_step null: no step, only a status or next-action change (missed, or release the lease).
-- applied = true when something new happened.
-- ---------------------------------------------------------------------------

create or replace function public.apply_reminder_step(
  p_reminder uuid,
  p_step integer,
  p_action text,
  p_step_status text,
  p_detail text,
  p_reminder_status text,
  p_next_action_at timestamptz,
  p_alert jsonb,
  p_event jsonb,
  p_now timestamptz
)
returns table (applied boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.reminders%rowtype;
  new_step uuid;
begin
  select * into r from public.reminders where id = p_reminder for update;
  -- Confirmed, resolved, refused or missed meanwhile: nothing more to do, ever.
  if not found or r.status not in ('scheduled', 'prompted', 'escalating') then
    applied := false;
    return next;
    return;
  end if;

  if p_step is not null then
    insert into public.escalation_steps (household_id, reminder_id, step, action, status, detail, executed_at)
    values (r.household_id, r.id, p_step, p_action, coalesce(p_step_status, 'done'), p_detail, p_now)
    on conflict (reminder_id, step) do nothing
    returning id into new_step;

    if new_step is null then
      -- Another tick already did this step and moved the reminder on. Only release our lease.
      update public.reminders set locked_until = null where id = r.id;
      applied := false;
      return next;
      return;
    end if;
  end if;

  if p_alert is not null then
    insert into public.alerts (household_id, patient_id, reminder_id, contact_id, severity, kind, summary, status, delivery_status, created_at)
    values (r.household_id, r.patient_id, r.id, nullif(p_alert ->> 'contact_id', '')::uuid, p_alert ->> 'severity',
            p_alert ->> 'kind', p_alert ->> 'summary', 'open', 'queued', p_now);
  end if;

  if p_event is not null then
    insert into public.events (household_id, patient_id, kind, severity, payload, occurred_at)
    values (r.household_id, r.patient_id, p_event ->> 'kind', coalesce(p_event ->> 'severity', 'info'),
            coalesce(p_event -> 'payload', '{}'::jsonb), p_now);
  end if;

  update public.reminders
     set status = coalesce(p_reminder_status, r.status),
         next_action_at = p_next_action_at,
         attempt = r.attempt + case when p_step is null then 0 else 1 end,
         locked_until = null
   where id = r.id;
  applied := true;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- REM-5 / REM-6: confirm. Stops every later step. If the family was already alerted, a green
-- "resolved" alert is queued to each contact that was alerted. Confirmed stays confirmed.
-- outcome: confirmed, already, not_open or not_found.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_reminder(
  p_reminder uuid,
  p_patient uuid,
  p_household uuid,
  p_by text,
  p_user uuid,
  p_source text,
  p_now timestamptz
)
returns table (outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.reminders%rowtype;
begin
  select * into r from public.reminders
   where id = p_reminder and patient_id = p_patient and household_id = p_household
   for update;
  if not found then
    outcome := 'not_found';
  elsif r.status = 'confirmed' then
    outcome := 'already';
  elsif r.status not in ('scheduled', 'prompted', 'escalating', 'refused') then
    outcome := 'not_open';
  else
    update public.reminders
       set status = 'confirmed', confirmed_by = p_by, confirmed_by_user = p_user, confirmed_at = p_now,
           next_action_at = null, locked_until = null
     where id = r.id;

    insert into public.events (household_id, patient_id, kind, severity, payload, occurred_at)
    values (r.household_id, r.patient_id, 'dose_confirmed', 'info',
            jsonb_build_object('source', p_source, 'reminder_id', r.id, 'by', p_by), p_now);

    insert into public.alerts (household_id, patient_id, reminder_id, contact_id, severity, kind, summary, status, delivery_status, created_at)
    select r.household_id, r.patient_id, r.id, a.contact_id, 'info', 'reminder_resolved',
           'Resolved: the reminder was confirmed after all.', 'open', 'queued', p_now
      from public.alerts a
     where a.reminder_id = r.id
       and a.kind in ('reminder_not_confirmed', 'reminder_not_confirmed_secondary')
       and a.contact_id is not null;
    outcome := 'confirmed';
  end if;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- A family member acknowledges an alert (Stage S6 calls this from the API). Stops later steps and
-- resolves the reminder. acknowledged = true if the alert was open.
-- ---------------------------------------------------------------------------

create or replace function public.acknowledge_alert(p_alert uuid, p_household uuid, p_user uuid, p_now timestamptz)
returns table (acknowledged boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
begin
  update public.alerts
     set status = 'acknowledged', acknowledged_by = p_user, acknowledged_at = p_now
   where id = p_alert and household_id = p_household and status = 'open'
  returning reminder_id into rid;
  if not found then
    acknowledged := false;
    return next;
    return;
  end if;
  if rid is not null then
    update public.reminders
       set status = 'resolved', next_action_at = null, locked_until = null
     where id = rid and status in ('scheduled', 'prompted', 'escalating', 'refused');
  end if;
  acknowledged := true;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions: server (service_role) only
-- ---------------------------------------------------------------------------

revoke all on function public.generate_reminders(timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_due_reminders(timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.apply_reminder_step(uuid, integer, text, text, text, text, timestamptz, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.confirm_reminder(uuid, uuid, uuid, text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.acknowledge_alert(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.generate_reminders(timestamptz, integer, integer) to service_role;
grant execute on function public.claim_due_reminders(timestamptz, integer, integer) to service_role;
grant execute on function public.apply_reminder_step(uuid, integer, text, text, text, text, timestamptz, jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.confirm_reminder(uuid, uuid, uuid, text, uuid, text, timestamptz) to service_role;
grant execute on function public.acknowledge_alert(uuid, uuid, uuid, timestamptz) to service_role;

notify pgrst, 'reload schema';
