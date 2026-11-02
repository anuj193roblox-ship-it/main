-- Nurra 0004_patient: device pairing and patient check-ins (Stage S4).
-- Apply with: npm run db:migrate
--
-- Patient devices never get a Supabase account. A family member creates a 6-digit pairing code;
-- the device exchanges it once for a long random device token. Only hashes are stored.
-- Everything here is server-only (RLS on, no client policies, functions for service_role only).

-- ---------------------------------------------------------------------------
-- Pairing codes (ONB-4): 6 digits, 10 minutes, single use, stored as an HMAC hash
-- ---------------------------------------------------------------------------

create table public.device_pairings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  patient_id uuid not null,
  -- HMAC-SHA256 of the code with a server secret: a leaked table does not reveal codes.
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade
);
-- One live code per value at a time (codes are short, so the server retries on a clash).
create unique index device_pairings_live_code on public.device_pairings (code_hash) where used_at is null;
create index device_pairings_patient_idx on public.device_pairings (patient_id);
alter table public.device_pairings enable row level security;
revoke all on public.device_pairings from anon;

-- ---------------------------------------------------------------------------
-- Device tokens: label, who paired it, when it was last used
-- ---------------------------------------------------------------------------

alter table public.device_tokens
  add column if not exists label text not null default 'Patient device' check (char_length(label) between 1 and 60),
  add column if not exists created_by uuid references public.users (id) on delete set null,
  add column if not exists last_used_at timestamptz;

-- ---------------------------------------------------------------------------
-- Messages: structured meta (intent, mood, escalate). Transcripts only, never audio (PRIV-2).
-- ---------------------------------------------------------------------------

alter table public.messages
  add column if not exists meta jsonb not null default '{}'::jsonb;
alter table public.messages drop constraint if exists messages_content_length;
alter table public.messages add constraint messages_content_length check (char_length(content) between 1 and 2000);

-- ---------------------------------------------------------------------------
-- Exchange a pairing code for a device token, atomically: the code can be used once only.
-- Returns the new device, or no row (unknown, used or expired code: all look the same).
-- ---------------------------------------------------------------------------

create or replace function public.consume_pairing_code(
  p_code_hash text,
  p_token_hash text,
  p_label text,
  p_expires_at timestamptz
)
returns table (device_id uuid, patient_id uuid, household_id uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  pairing record;
  new_device uuid;
begin
  update public.device_pairings d
     set used_at = now()
   where d.code_hash = p_code_hash
     and d.used_at is null
     and d.expires_at > now()
  returning d.id, d.patient_id, d.household_id, d.created_by into pairing;

  if pairing.id is null then
    return;
  end if;

  insert into public.device_tokens (household_id, patient_id, token_hash, scope, expires_at, label, created_by)
  values (pairing.household_id, pairing.patient_id, p_token_hash, '{checkin,confirm}', p_expires_at,
          coalesce(nullif(trim(p_label), ''), 'Patient device'), pairing.created_by)
  returning id into new_device;

  insert into public.audit_log (household_id, actor_id, action, table_name, record_id)
  values (pairing.household_id, pairing.created_by, 'device.paired', 'device_tokens', new_device);

  return query select new_device, pairing.patient_id, pairing.household_id;
end;
$$;

revoke all on function public.consume_pairing_code(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_pairing_code(text, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
