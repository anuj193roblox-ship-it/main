-- Nurra 0001_init: Phase 1 schema, row-level security, audit triggers.
-- Apply once in the Supabase SQL editor. Then run supabase/seed.sql for demo data.
--
-- Security model
--   * Every table has household_id and RLS enabled.
--   * Signed-in users can only see rows of their own household (public.users.household_id).
--   * Role and household_id are never writable from the client: public.users has no write policy.
--   * Tables written by the server only (reminders, alerts, tokens, audit_log ...) have no client
--     write policy. The service-role key bypasses RLS and is used only in server code.
--   * Child rows use composite foreign keys (id, household_id), so a row can never point at a
--     patient, plan or medicine of another household.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

-- App users. id is the Supabase Auth user id. Role is set by the server only.
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  role text not null default 'family' check (role in ('family', 'clinician', 'admin')),
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now()
);
create index users_household_idx on public.users (household_id);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 120),
  preferred_name text not null check (char_length(preferred_name) between 1 and 60),
  birth_year integer not null check (birth_year between 1900 and 2100),
  language text not null default 'en' check (language in ('en', 'hi', 'kn')),
  timezone text not null default 'Asia/Kolkata',
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  activated_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, household_id)
);
create index patients_household_idx on public.patients (household_id);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  relationship text,
  priority text not null check (priority in ('primary', 'secondary')),
  phone text,
  email text,
  channels text[] not null default '{whatsapp}',
  whatsapp_opt_in_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade
);
create index contacts_patient_idx on public.contacts (patient_id);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  basis text not null check (basis in ('self', 'guardian')),
  given_by text not null check (char_length(given_by) between 1 and 120),
  evidence_note text not null check (char_length(evidence_note) between 1 and 1000),
  given_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade
);
create index consents_patient_idx on public.consents (patient_id);

-- ---------------------------------------------------------------------------
-- Vault
-- ---------------------------------------------------------------------------

create table public.conditions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  name text not null check (char_length(name) between 1 and 200),
  since date,
  treating_doctor text,
  notes text,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade
);
create index conditions_patient_idx on public.conditions (patient_id);

create table public.medications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  brand_name text not null check (char_length(brand_name) between 1 and 200),
  generic_name text,
  ingredient text,
  strength text,
  dose text,
  frequency text,
  timing text[] not null default '{}',
  with_food text check (with_food in ('before', 'with', 'after', 'any')),
  purpose text,
  prescriber text,
  start_date date,
  stop_date date,
  status text not null default 'active' check (status in ('active', 'stopped')),
  verified_by uuid references public.users (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  check ((verified_by is null) = (verified_at is null)),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade
);
create index medications_patient_idx on public.medications (patient_id);

create table public.allergies (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  substance text not null check (char_length(substance) between 1 and 200),
  reaction text,
  severity text not null default 'moderate' check (severity in ('mild', 'moderate', 'severe')),
  created_at timestamptz not null default now(),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade
);
create index allergies_patient_idx on public.allergies (patient_id);

create table public.providers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  name text not null check (char_length(name) between 1 and 200),
  specialty text,
  phone text,
  address text,
  created_at timestamptz not null default now(),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade
);
create index providers_patient_idx on public.providers (patient_id);

create table public.vault_documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  doc_type text not null check (doc_type in ('prescription', 'report', 'insurance', 'other')),
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade
);
create index vault_documents_patient_idx on public.vault_documents (patient_id);

-- ---------------------------------------------------------------------------
-- Care plan, reminders, escalation
-- ---------------------------------------------------------------------------

create table public.care_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  preset text check (preset in ('dementia', 'diabetes', 'post_surgery')),
  -- Escalation delays in minutes (CARE-4 is built in a later stage; defaults match REM-3).
  reprompt_after_min integer not null default 5 check (reprompt_after_min between 1 and 120),
  family_alert_after_min integer not null default 10 check (family_alert_after_min between 1 and 240),
  secondary_after_min integer not null default 15 check (secondary_after_min between 1 and 240),
  created_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade
);
create index care_plans_patient_idx on public.care_plans (patient_id);

create table public.care_plan_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  care_plan_id uuid not null,
  item_type text not null check (
    item_type in ('medication', 'meal', 'water', 'exercise', 'sleep', 'appointment', 'checkin_question', 'reading')
  ),
  title text not null check (char_length(title) between 1 and 200),
  severity text not null default 'normal' check (severity in ('normal', 'important', 'critical')),
  medication_id uuid,
  time_of_day time,
  days_of_week integer[] not null default '{0,1,2,3,4,5,6}',
  details text,
  expires_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  check (item_type <> 'medication' or medication_id is not null),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade,
  foreign key (care_plan_id, household_id) references public.care_plans (id, household_id) on delete cascade,
  -- A medicine used in a plan cannot be deleted on its own. Mark it stopped instead.
  -- (no action is checked at statement end, so deleting the whole patient still cascades.)
  foreign key (medication_id, household_id) references public.medications (id, household_id) on delete no action
);
create index care_plan_items_plan_idx on public.care_plan_items (care_plan_id);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  care_plan_item_id uuid,
  due_at timestamptz not null,
  status text not null default 'scheduled' check (
    status in ('scheduled', 'prompted', 'confirmed', 'escalating', 'resolved', 'missed', 'refused')
  ),
  confirmed_by text check (confirmed_by in ('patient', 'family')),
  confirmed_by_user uuid references public.users (id) on delete set null,
  confirmed_at timestamptz,
  attempt integer not null default 0,
  next_action_at timestamptz,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade,
  foreign key (care_plan_item_id, household_id) references public.care_plan_items (id, household_id) on delete set null (care_plan_item_id)
);
create index reminders_due_idx on public.reminders (next_action_at) where status in ('scheduled', 'prompted', 'escalating');
create index reminders_patient_idx on public.reminders (patient_id, due_at);

create table public.escalation_steps (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  reminder_id uuid not null,
  step integer not null check (step >= 1),
  action text not null check (action in ('prompt', 'reprompt', 'family_alert', 'secondary_alert')),
  executed_at timestamptz not null default now(),
  -- Idempotency: a double tick can never create the same step twice.
  unique (reminder_id, step),
  foreign key (reminder_id, household_id) references public.reminders (id, household_id) on delete cascade
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  kind text not null check (char_length(kind) between 1 and 60),
  severity text not null default 'info' check (severity in ('info', 'warning', 'urgent')),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade
);
create index events_patient_idx on public.events (patient_id, occurred_at desc);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  reminder_id uuid,
  event_id uuid references public.events (id) on delete set null,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'urgent')),
  kind text not null check (char_length(kind) between 1 and 60),
  summary text not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  acknowledged_by uuid references public.users (id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade,
  foreign key (reminder_id, household_id) references public.reminders (id, household_id) on delete set null (reminder_id)
);
create index alerts_patient_idx on public.alerts (patient_id, created_at desc);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  started_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade
);
create index conversations_patient_idx on public.conversations (patient_id, started_at desc);

-- Transcripts are stored. Raw audio is not stored by default (PRIV-2).
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  conversation_id uuid not null,
  role text not null check (role in ('patient', 'nurra', 'system')),
  content text not null,
  mood text,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, household_id) references public.conversations (id, household_id) on delete cascade
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

create table public.daily_summaries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  summary_date date not null,
  story text not null,
  source text not null default 'template' check (source in ('model', 'template')),
  created_at timestamptz not null default now(),
  unique (patient_id, summary_date),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade
);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  kind text not null check (kind in ('voice_note', 'photo', 'song')),
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Security tables (server-only: RLS on, no client policies)
-- ---------------------------------------------------------------------------

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  token_hash text not null unique,
  scope text[] not null default '{checkin,confirm}',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade
);
create index device_tokens_patient_idx on public.device_tokens (patient_id);

create table public.ack_tokens (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  alert_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (alert_id, household_id) references public.alerts (id, household_id) on delete cascade
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  -- Plain ids, no foreign keys: the trail must survive deletes, and cascades must not trip over it.
  household_id uuid,
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id uuid,
  -- Never put PII, health details or secrets here. Ids and action names only.
  created_at timestamptz not null default now()
);
create index audit_log_household_idx on public.audit_log (household_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id from public.users where id = auth.uid()
$$;

create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid()
$$;

revoke all on function public.current_household_id() from public, anon;
revoke all on function public.current_role_name() from public, anon;
grant execute on function public.current_household_id() to authenticated;
grant execute on function public.current_role_name() to authenticated;

-- ---------------------------------------------------------------------------
-- Audit trigger: ids and action only (no health values, no PII)
-- ---------------------------------------------------------------------------

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
  hh uuid;
begin
  if tg_op = 'DELETE' then
    rid := old.id;
    hh := old.household_id;
  else
    rid := new.id;
    hh := new.household_id;
  end if;
  insert into public.audit_log (household_id, actor_id, action, table_name, record_id)
  values (hh, auth.uid(), lower(tg_op), tg_table_name, rid);
  return coalesce(new, old);
end;
$$;

create trigger audit_patients after insert or update or delete on public.patients
  for each row execute function public.audit_row_change();
create trigger audit_consents after insert or update or delete on public.consents
  for each row execute function public.audit_row_change();
create trigger audit_conditions after insert or update or delete on public.conditions
  for each row execute function public.audit_row_change();
create trigger audit_medications after insert or update or delete on public.medications
  for each row execute function public.audit_row_change();
create trigger audit_allergies after insert or update or delete on public.allergies
  for each row execute function public.audit_row_change();
create trigger audit_care_plans after insert or update or delete on public.care_plans
  for each row execute function public.audit_row_change();
create trigger audit_care_plan_items after insert or update or delete on public.care_plan_items
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- Medicine verification guard (VLT-4)
--   * New entries are always Unverified.
--   * Only a clinician can set or clear verified_by / verified_at, and only as themselves.
--   * Any other edit to a verified entry makes it Unverified again.
-- Server (service-role) calls have auth.uid() null and are not restricted here.
-- ---------------------------------------------------------------------------

create or replace function public.medications_verification_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changing_verification boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verified_by := null;
    new.verified_at := null;
    return new;
  end if;

  changing_verification :=
    new.verified_by is distinct from old.verified_by or new.verified_at is distinct from old.verified_at;

  if changing_verification then
    if public.current_role_name() <> 'clinician' then
      raise exception 'Only a clinician can verify a medicine';
    end if;
    if new.verified_by is not null and new.verified_by <> auth.uid() then
      raise exception 'Verification must be recorded as the signed-in clinician';
    end if;
    return new;
  end if;

  if (new.brand_name, new.generic_name, new.ingredient, new.strength, new.dose, new.frequency, new.timing,
      new.with_food, new.purpose, new.prescriber, new.start_date, new.stop_date, new.status)
     is distinct from
     (old.brand_name, old.generic_name, old.ingredient, old.strength, old.dose, old.frequency, old.timing,
      old.with_food, old.purpose, old.prescriber, old.start_date, old.stop_date, old.status) then
    new.verified_by := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;

create trigger medications_verification_guard before insert or update on public.medications
  for each row execute function public.medications_verification_guard();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.households enable row level security;
alter table public.users enable row level security;
alter table public.patients enable row level security;
alter table public.contacts enable row level security;
alter table public.consents enable row level security;
alter table public.conditions enable row level security;
alter table public.medications enable row level security;
alter table public.allergies enable row level security;
alter table public.providers enable row level security;
alter table public.vault_documents enable row level security;
alter table public.care_plans enable row level security;
alter table public.care_plan_items enable row level security;
alter table public.reminders enable row level security;
alter table public.escalation_steps enable row level security;
alter table public.events enable row level security;
alter table public.alerts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.daily_summaries enable row level security;
alter table public.media enable row level security;
alter table public.device_tokens enable row level security;
alter table public.ack_tokens enable row level security;
alter table public.audit_log enable row level security;

-- households: members read their own; only the admin can rename it.
create policy households_select on public.households
  for select to authenticated using (id = public.current_household_id());
create policy households_update on public.households
  for update to authenticated
  using (id = public.current_household_id() and public.current_role_name() = 'admin')
  with check (id = public.current_household_id());

-- users: read household members. No client writes: role and household_id are server-controlled.
create policy users_select on public.users
  for select to authenticated using (household_id = public.current_household_id());

-- Household tables the client may read and write (care data edited by family and clinicians).
do $$
declare
  t text;
begin
  foreach t in array array[
    'patients', 'contacts', 'conditions', 'medications', 'allergies', 'providers',
    'vault_documents', 'care_plans', 'care_plan_items'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (household_id = public.current_household_id())',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (household_id = public.current_household_id())',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (household_id = public.current_household_id()) with check (household_id = public.current_household_id())',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (household_id = public.current_household_id())',
      t || '_delete', t);
  end loop;
end
$$;

-- consents: can be recorded and read, never edited or deleted from the client (evidence trail).
create policy consents_select on public.consents
  for select to authenticated using (household_id = public.current_household_id());
create policy consents_insert on public.consents
  for insert to authenticated with check (household_id = public.current_household_id());

-- Server-written tables the client may only read.
do $$
declare
  t text;
begin
  foreach t in array array[
    'reminders', 'escalation_steps', 'events', 'alerts', 'conversations', 'messages',
    'daily_summaries', 'media'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (household_id = public.current_household_id())',
      t || '_select', t);
  end loop;
end
$$;

-- audit_log: the household admin can read it. Nobody can write from the client.
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (household_id = public.current_household_id() and public.current_role_name() = 'admin');

-- device_tokens and ack_tokens: RLS on, no policies. Only the server (service role) can touch them.

-- Safety net: the anon role never needs table access in this schema.
revoke all on all tables in schema public from anon;
