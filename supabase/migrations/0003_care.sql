-- Nurra 0003_care: onboarding, Vault Lite and care plan rules (Stage S3).
-- Apply after 0002_auth.sql in the Supabase SQL editor. Safe on a database that already has the
-- seed data: existing plan items are converted to the new schedule columns.

-- ---------------------------------------------------------------------------
-- 1. Audit: record WHICH columns changed (names only, never values)
-- ---------------------------------------------------------------------------

alter table public.audit_log add column if not exists changed_columns text[];

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
  hh uuid;
  cols text[];
begin
  if tg_op = 'DELETE' then
    rid := old.id;
    hh := old.household_id;
    cols := null;
  elsif tg_op = 'INSERT' then
    rid := new.id;
    hh := new.household_id;
    select array_agg(key order by key) into cols
      from jsonb_each(to_jsonb(new))
     where value <> 'null'::jsonb and key not in ('id', 'household_id', 'created_at');
  else
    rid := new.id;
    hh := new.household_id;
    select array_agg(n.key order by n.key) into cols
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o on o.key = n.key
     where n.value is distinct from o.value;
    -- Nothing changed: nothing to record.
    if cols is null then
      return new;
    end if;
  end if;

  -- Column NAMES only. Values (doses, names, notes) never reach the audit log.
  insert into public.audit_log (household_id, actor_id, action, table_name, record_id, changed_columns)
  values (hh, auth.uid(), lower(tg_op), tg_table_name, rid, cols);
  return coalesce(new, old);
end;
$$;

-- Contacts and providers are household medical-support data too.
drop trigger if exists audit_contacts on public.contacts;
create trigger audit_contacts after insert or update or delete on public.contacts
  for each row execute function public.audit_row_change();
drop trigger if exists audit_providers on public.providers;
create trigger audit_providers after insert or update or delete on public.providers
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- 2. Medicines: human approval (family or clinician) next to clinician verification
-- ---------------------------------------------------------------------------

alter table public.medications
  add column if not exists approved_by uuid references public.users (id) on delete set null,
  add column if not exists approved_at timestamptz;
alter table public.medications drop constraint if exists medications_approved_pair;
alter table public.medications add constraint medications_approved_pair check ((approved_by is null) = (approved_at is null));

-- Replaces the 0001 guard. Rules for signed-in clients (server/service-role writes have no auth.uid()):
--   * New entries are always Unverified: no approval, no verification.
--   * Any clinical edit returns the entry to Unverified, whatever else the request tried to set.
--   * Only a clinician can verify, and only as themselves.
--   * Any household member can approve, and only as themselves.
create or replace function public.medications_verification_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verified_by := null;
    new.verified_at := null;
    new.approved_by := null;
    new.approved_at := null;
    return new;
  end if;

  if (new.brand_name, new.generic_name, new.ingredient, new.strength, new.dose, new.frequency, new.timing,
      new.with_food, new.purpose, new.prescriber, new.start_date, new.stop_date, new.status)
     is distinct from
     (old.brand_name, old.generic_name, old.ingredient, old.strength, old.dose, old.frequency, old.timing,
      old.with_food, old.purpose, old.prescriber, old.start_date, old.stop_date, old.status) then
    new.verified_by := null;
    new.verified_at := null;
    new.approved_by := null;
    new.approved_at := null;
    return new;
  end if;

  if new.verified_by is distinct from old.verified_by or new.verified_at is distinct from old.verified_at then
    if public.current_role_name() is distinct from 'clinician' then
      raise exception 'Only a clinician can verify a medicine';
    end if;
    if new.verified_by is not null and new.verified_by <> auth.uid() then
      raise exception 'Verification must be recorded as the signed-in clinician';
    end if;
  end if;

  if new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
    if public.current_role_name() is null then
      raise exception 'Only a household member can approve a medicine';
    end if;
    if new.approved_by is not null and new.approved_by <> auth.uid() then
      raise exception 'Approval must be recorded as the signed-in user';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Contacts: E.164 phone, known channels, one primary and one secondary per patient
-- ---------------------------------------------------------------------------

alter table public.contacts drop constraint if exists contacts_phone_e164;
alter table public.contacts add constraint contacts_phone_e164 check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');
alter table public.contacts drop constraint if exists contacts_channels_known;
alter table public.contacts add constraint contacts_channels_known check (channels <@ array['whatsapp', 'call']::text[]);
alter table public.contacts drop constraint if exists contacts_whatsapp_needs_phone;
alter table public.contacts add constraint contacts_whatsapp_needs_phone check (whatsapp_opt_in_at is null or phone is not null);
alter table public.contacts drop constraint if exists contacts_one_per_priority;
alter table public.contacts add constraint contacts_one_per_priority unique (patient_id, priority);

-- ---------------------------------------------------------------------------
-- 4. Consent: which version of the consent text was shown
-- ---------------------------------------------------------------------------

alter table public.consents add column if not exists text_version text not null default 'unversioned'
  check (char_length(text_version) between 1 and 40);

-- ---------------------------------------------------------------------------
-- 5. Activation needs a consent and a primary contact (ONB-2, ONB-5)
-- ---------------------------------------------------------------------------

create or replace function public.patients_activation_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    if not exists (select 1 from public.consents c where c.patient_id = new.id and c.revoked_at is null) then
      raise exception 'nurra_activation_needs_consent' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.contacts c where c.patient_id = new.id and c.priority = 'primary' and c.phone is not null
    ) then
      raise exception 'nurra_activation_needs_primary_contact' using errcode = 'P0001';
    end if;
    new.activated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists patients_activation_guard on public.patients;
create trigger patients_activation_guard before insert or update on public.patients
  for each row execute function public.patients_activation_guard();

-- ---------------------------------------------------------------------------
-- 6. Care plan items: schedules, medicine placeholders, medicine snapshot
-- ---------------------------------------------------------------------------

alter table public.care_plan_items
  add column if not exists times_of_day time[] not null default '{}',
  add column if not exists schedule_kind text not null default 'times',
  add column if not exists interval_minutes integer,
  add column if not exists window_start time,
  add column if not exists window_end time,
  add column if not exists on_date date,
  -- A medication slot from a preset, waiting for the family to link a vault medicine.
  add column if not exists is_placeholder boolean not null default false,
  -- The medicine's dose, frequency, time and status when the plan last accepted them.
  -- If the vault entry changes, the difference is shown as "Apply this change to the reminders?".
  add column if not exists medication_snapshot jsonb;

-- Convert rows created with the 0001 single time column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_plan_items' and column_name = 'time_of_day'
  ) then
    update public.care_plan_items set times_of_day = array[time_of_day] where time_of_day is not null;
    update public.care_plan_items
       set schedule_kind = 'once', on_date = coalesce(expires_on, current_date), times_of_day = '{10:00}'
     where time_of_day is null and item_type = 'appointment';
    update public.care_plan_items set times_of_day = '{09:00}'
     where cardinality(times_of_day) = 0 and schedule_kind = 'times';
    alter table public.care_plan_items drop column time_of_day;
  end if;
end
$$;

update public.care_plan_items i
   set medication_snapshot = jsonb_build_object(
         'strength', m.strength, 'dose', m.dose, 'frequency', m.frequency,
         'timing', to_jsonb(m.timing), 'status', m.status)
  from public.medications m
 where m.id = i.medication_id and i.medication_snapshot is null;

-- Replace the 0001 rule "medication items need a medicine" with one that allows inactive placeholders.
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.care_plan_items'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%medication_id IS NOT NULL%'
  loop
    execute format('alter table public.care_plan_items drop constraint %I', c);
  end loop;
end
$$;

alter table public.care_plan_items drop constraint if exists care_plan_items_medication_link;
alter table public.care_plan_items add constraint care_plan_items_medication_link check (
  item_type <> 'medication' or medication_id is not null or (is_placeholder and not active)
);
alter table public.care_plan_items drop constraint if exists care_plan_items_placeholder_shape;
alter table public.care_plan_items add constraint care_plan_items_placeholder_shape check (
  not is_placeholder or (item_type = 'medication' and medication_id is null)
);
alter table public.care_plan_items drop constraint if exists care_plan_items_schedule;
alter table public.care_plan_items add constraint care_plan_items_schedule check (
  (schedule_kind = 'times'
     and cardinality(times_of_day) between 1 and 12
     and cardinality(days_of_week) between 1 and 7 and days_of_week <@ array[0, 1, 2, 3, 4, 5, 6])
  or (schedule_kind = 'interval'
     and item_type = 'water'
     and interval_minutes between 15 and 240
     and window_start is not null and window_end is not null and window_start < window_end
     and cardinality(days_of_week) between 1 and 7 and days_of_week <@ array[0, 1, 2, 3, 4, 5, 6])
  or (schedule_kind = 'once' and on_date is not null and cardinality(times_of_day) between 1 and 12)
);

-- Make the Supabase API see the new columns at once.
notify pgrst, 'reload schema';
