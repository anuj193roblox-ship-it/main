-- Nurra 0002_auth: rate limiting, invites, household creation, demo claim (Stage S2).
-- Apply after 0001_init.sql in the Supabase SQL editor.
--
-- Everything here is server-only:
--   * The rate-limit table lives in a "private" schema that the Supabase API does not expose.
--   * invites has RLS on and no client policies.
--   * Every function is revoked from public, anon and authenticated, and granted to service_role only.
--     The app calls them from server code with the service-role client, passing the user id it
--     took from the verified session. The client never sends a role, a household id or a user id.

-- ---------------------------------------------------------------------------
-- Rate limiting: sliding window, no extra services
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.rate_limit_hits (
  id bigint generated always as identity primary key,
  -- Keys are sha256 hashes built by the server (e.g. of "login:account:<email>"). No raw emails or IPs.
  key text not null check (char_length(key) between 1 and 128),
  hit_at timestamptz not null default now()
);
create index rate_limit_hits_key_time_idx on private.rate_limit_hits (key, hit_at);
alter table private.rate_limit_hits enable row level security;
revoke all on private.rate_limit_hits from public, anon, authenticated;

-- Records an attempt and says whether it is allowed.
-- Blocked attempts are not recorded, so a lockout always ends when the oldest hit leaves the window.
-- p_now exists so tests can move time; the app never passes it.
create or replace function public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer,
  p_now timestamptz default now()
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = private, public
as $$
declare
  window_start timestamptz := p_now - make_interval(secs => p_window_seconds);
  hits integer;
  oldest timestamptz;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit';
  end if;

  -- Serialise attempts for the same key so two parallel requests cannot both slip under the limit.
  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));

  delete from private.rate_limit_hits where key = p_key and hit_at <= window_start;

  -- Occasional housekeeping for keys that are never seen again.
  if random() < 0.01 then
    delete from private.rate_limit_hits where hit_at < p_now - interval '1 day';
  end if;

  select count(*), min(hit_at) into hits, oldest
  from private.rate_limit_hits
  where key = p_key and hit_at > window_start;

  if hits >= p_limit then
    return query select false,
      greatest(1, ceil(extract(epoch from (oldest + make_interval(secs => p_window_seconds) - p_now)))::integer);
    return;
  end if;

  insert into private.rate_limit_hits (key, hit_at) values (p_key, p_now);
  return query select true, 0;
end;
$$;

-- Clears a key, e.g. the per-account login counter after a successful sign-in.
create or replace function public.reset_rate_limit(p_key text)
returns void
language sql
security definer
set search_path = private, public
as $$
  delete from private.rate_limit_hits where key = p_key;
$$;

-- ---------------------------------------------------------------------------
-- Invites (AUTH-6): the only way to join an existing household or become a clinician
-- ---------------------------------------------------------------------------

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  role text not null check (role in ('family', 'clinician')),
  -- sha256 of the token. The token itself is shown once to the inviter and never stored.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  check ((used_at is null) = (used_by is null))
);
create index invites_household_idx on public.invites (household_id);

alter table public.invites enable row level security;
-- No policies: clients can neither read nor write invites. The server uses the service role.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_email_verified(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (select 1 from auth.users where id = p_user and email_confirmed_at is not null)
$$;

-- ---------------------------------------------------------------------------
-- First sign-up: a new household with the user as admin (household owner)
-- Returns the new household id, or null if the user is unverified or already has a household.
-- ---------------------------------------------------------------------------

create or replace function public.create_household_for_user(
  p_user uuid,
  p_display_name text,
  p_household_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_household uuid;
begin
  if not public.is_email_verified(p_user) then
    return null;
  end if;

  -- One household per user. Lock the user's (possible) row to make parallel calls safe.
  perform pg_advisory_xact_lock(hashtextextended('household-for-' || p_user::text, 0));
  if exists (select 1 from public.users where id = p_user) then
    return null;
  end if;

  insert into public.households (name) values (p_household_name) returning id into new_household;
  insert into public.users (id, household_id, role, display_name)
  values (p_user, new_household, 'admin', p_display_name);

  insert into public.audit_log (household_id, actor_id, action, table_name, record_id)
  values (new_household, p_user, 'auth.household_created', 'auth', new_household),
         (new_household, p_user, 'auth.role_assigned_admin', 'auth', p_user);
  return new_household;
end;
$$;

-- ---------------------------------------------------------------------------
-- Demo household claim (docs/S2_NOTES.md). The app checks NEXT_PUBLIC_DEMO_MODE before calling.
-- Returns true only for the first verified user, and only if they have no household yet.
-- ---------------------------------------------------------------------------

create or replace function public.claim_demo_household(p_user uuid, p_display_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  demo constant uuid := '00000000-0000-4000-8000-000000000001';
  inserted integer;
begin
  if not public.is_email_verified(p_user) then
    return false;
  end if;

  -- Lock the demo household row: two claims at the same moment cannot both win.
  perform 1 from public.households where id = demo for update;
  if not found then
    return false;
  end if;

  if exists (select 1 from public.users where id = p_user) then
    return false;
  end if;

  insert into public.users (id, household_id, role, display_name)
  select p_user, demo, 'admin', p_display_name
  where not exists (select 1 from public.users where household_id = demo);
  get diagnostics inserted = row_count;

  if inserted = 1 then
    insert into public.audit_log (household_id, actor_id, action, table_name, record_id)
    values (demo, p_user, 'auth.demo_household_claimed', 'auth', demo),
           (demo, p_user, 'auth.role_assigned_admin', 'auth', p_user);
  end if;
  return inserted = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Accept an invite. Single-use, unexpired, verified email, user not yet in a household.
-- Returns the household and role, or no row. Every failure looks the same to the caller.
-- ---------------------------------------------------------------------------

create or replace function public.accept_invite(p_token_hash text, p_user uuid, p_display_name text)
returns table (household_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  inv record;
begin
  if not public.is_email_verified(p_user) then
    return;
  end if;
  if exists (select 1 from public.users u where u.id = p_user) then
    return;
  end if;

  -- Claim the invite atomically: only one caller can flip used_at from null.
  update public.invites i
     set used_at = now(), used_by = p_user
   where i.token_hash = p_token_hash
     and i.used_at is null
     and i.expires_at > now()
  returning i.id, i.household_id, i.role into inv;

  if inv.id is null then
    return;
  end if;

  insert into public.users (id, household_id, role, display_name)
  values (p_user, inv.household_id, inv.role, p_display_name);

  insert into public.audit_log (household_id, actor_id, action, table_name, record_id)
  values (inv.household_id, p_user, 'auth.invite_used', 'auth', inv.id),
         (inv.household_id, p_user, 'auth.role_assigned_' || inv.role, 'auth', p_user);

  return query select inv.household_id, inv.role;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions: server (service_role) only
-- ---------------------------------------------------------------------------

revoke all on function public.check_rate_limit(text, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.reset_rate_limit(text) from public, anon, authenticated;
revoke all on function public.is_email_verified(uuid) from public, anon, authenticated;
revoke all on function public.create_household_for_user(uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_demo_household(uuid, text) from public, anon, authenticated;
revoke all on function public.accept_invite(text, uuid, text) from public, anon, authenticated;

grant usage on schema private to service_role;
grant all on private.rate_limit_hits to service_role;
grant execute on function public.check_rate_limit(text, integer, integer, timestamptz) to service_role;
grant execute on function public.reset_rate_limit(text) to service_role;
grant execute on function public.is_email_verified(uuid) to service_role;
grant execute on function public.create_household_for_user(uuid, text, text) to service_role;
grant execute on function public.claim_demo_household(uuid, text) to service_role;
grant execute on function public.accept_invite(text, uuid, text) to service_role;

revoke all on public.invites from anon;

-- Make the Supabase API (PostgREST) see the new functions and table straight away.
-- Without this, calls can fail with PGRST202 "function not found" until the schema cache refreshes.
notify pgrst, 'reload schema';
