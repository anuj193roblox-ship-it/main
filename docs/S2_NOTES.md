# Notes for Stage S2 (carried over from S1)

## The demo household has no owner

`supabase/seed.sql` creates the Rao household (`00000000-0000-4000-8000-000000000001`) with Meera, Anita, Ravi and a care plan, but no row in `public.users`. A `public.users` row needs a Supabase Auth user, and those only exist after sign-up (S2). Until someone is attached, RLS correctly shows that household to nobody.

## Plan

### 1. Claim flow (main path)

After the first user signs up and verifies their email, offer "Use the demo household" while it is unclaimed.

- Server-only. The browser sends no role, no household id and no user id. The server takes the user id from the verified session.
- Allowed only when all of these hold: `NEXT_PUBLIC_DEMO_MODE` is `true`, the email is verified, and the demo household has zero users.
- Atomic, so two sign-ups at once cannot both win. Use one Postgres function in a new migration, `0002_claim_demo_household.sql`:
  `claim_demo_household(p_user uuid, p_name text)` runs
  `insert into public.users (id, household_id, role, display_name) select p_user, <demo id>, 'admin', p_name where not exists (select 1 from public.users where household_id = <demo id>)`
  and returns whether a row was inserted.
- `revoke execute ... from public, anon, authenticated`. Call it only with the service-role client from server code (`import "server-only"`).
- Write an `audit_log` row for the claim.
- Everyone else who signs up gets their own empty household. Never put them in the demo one.
- The claimer becomes `admin` (household owner). Role is decided by this server code, never by the client.

### 2. Fallback script

`scripts/attach-demo-owner.mjs <email>` for when the app flow is not usable (for example demo mode is off in production).

- Reads the service-role key from `.env.local`. It never prints keys or tokens.
- Finds the Auth user by email, then runs the same guarded insert. It refuses if the household already has an owner.

## Do not do

- Do not add a client insert or update policy on `public.users` to make claiming easier. It would let anyone set their own role or household. S1's tests assert this stays closed.
- Do not seed a fake Auth user with a known password.

## Tests to add in S2

- A second claimer is rejected.
- A claim with an unverified email is rejected.
- A claim is rejected when demo mode is off.
- A sign-up request that includes `role` or `household_id` is ignored.
- After a claim, the owner can read the seeded patient and a different household's user cannot.
