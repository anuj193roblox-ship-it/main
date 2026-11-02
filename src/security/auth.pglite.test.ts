// Migration 0002 (Stage S2) against an in-memory Postgres: rate limiter, household creation,
// demo claim and invites. Functions are called as service_role, exactly as the server does.
import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, createTestDb, readSeed } from "@/test/pglite";

const DEMO = "00000000-0000-4000-8000-000000000001";
const uid = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

let db: PGlite;

const svc = <T>(fn: () => Promise<T>) => asRole(db, "service_role", null, fn);

async function verifiedUser(n: number): Promise<string> {
  await db.exec(`insert into auth.users (id, email_confirmed_at) values ('${uid(n)}', now())`);
  return uid(n);
}
async function unverifiedUser(n: number): Promise<string> {
  await db.exec(`insert into auth.users (id, email_confirmed_at) values ('${uid(n)}', null)`);
  return uid(n);
}
async function roleOf(user: string): Promise<{ role: string; household_id: string } | undefined> {
  return (await db.query<{ role: string; household_id: string }>(`select role, household_id from public.users where id = '${user}'`)).rows[0];
}

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(readSeed());
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("rate limiter (sliding window)", () => {
  const t0 = "2026-11-02T10:00:00Z";
  const at = (seconds: number) => `'${t0}'::timestamptz + interval '${seconds} seconds'`;
  const hit = (key: string, seconds: number, limit = 3, windowSec = 60) =>
    svc(async () => (await db.query<{ allowed: boolean; retry_after_seconds: number }>(
      `select * from public.check_rate_limit('${key}', ${limit}, ${windowSec}, ${at(seconds)})`)).rows[0]);

  it("allows up to the limit, blocks the next attempt, then recovers after the window", async () => {
    expect((await hit("k1", 0)).allowed).toBe(true);
    expect((await hit("k1", 10)).allowed).toBe(true);
    expect((await hit("k1", 20)).allowed).toBe(true);
    const blocked = await hit("k1", 30);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retry_after_seconds).toBe(30); // the hit at 0 leaves the window at 60
    expect((await hit("k1", 59)).allowed).toBe(false);
    // Blocked attempts are not counted, so the lockout really ends with the window.
    expect((await hit("k1", 61)).allowed).toBe(true);
  });

  it("keys are independent", async () => {
    for (const s of [0, 1, 2]) await hit("k2", s);
    expect((await hit("k2", 3)).allowed).toBe(false);
    expect((await hit("k3", 3)).allowed).toBe(true);
  });

  it("reset clears a key (used after a successful login)", async () => {
    for (const s of [0, 1, 2]) await hit("k4", s);
    expect((await hit("k4", 3)).allowed).toBe(false);
    await svc(() => db.query(`select public.reset_rate_limit('k4')`));
    expect((await hit("k4", 4)).allowed).toBe(true);
  });

  it("rejects nonsense limits", async () => {
    await expect(hit("k5", 0, 0)).rejects.toThrow(/invalid rate limit/);
  });
});

describe("clients cannot call the auth functions or reach the private schema", () => {
  const calls = [
    `select * from public.check_rate_limit('x', 1, 1)`,
    `select public.reset_rate_limit('x')`,
    `select public.create_household_for_user('${uid(999)}', 'x', 'x')`,
    `select public.claim_demo_household('${uid(999)}', 'x')`,
    `select * from public.accept_invite('${"0".repeat(64)}', '${uid(999)}', 'x')`,
    `select * from private.rate_limit_hits`,
  ];
  it.each(calls)("authenticated and anon are denied: %s", async (sql) => {
    await expect(asRole(db, "authenticated", uid(1), () => db.query(sql))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, "anon", null, () => db.query(sql))).rejects.toThrow(/permission denied/);
  });
});

describe("first sign-up creates a new household with the user as admin", () => {
  it("refuses an unverified email", async () => {
    const u = await unverifiedUser(10);
    const r = await svc(() => db.query<{ h: string | null }>(`select public.create_household_for_user('${u}', 'Asha', 'Asha home') as h`));
    expect(r.rows[0].h).toBeNull();
    expect(await roleOf(u)).toBeUndefined();
  });

  it("creates a household and an admin, once", async () => {
    const u = await verifiedUser(11);
    const r = await svc(() => db.query<{ h: string }>(`select public.create_household_for_user('${u}', 'Asha', 'Asha home') as h`));
    expect(r.rows[0].h).toMatch(/^[0-9a-f-]{36}$/);
    expect(await roleOf(u)).toEqual({ role: "admin", household_id: r.rows[0].h });
    const again = await svc(() => db.query<{ h: string | null }>(`select public.create_household_for_user('${u}', 'Asha', 'Second') as h`));
    expect(again.rows[0].h).toBeNull();
    const audit = await db.query(`select action from public.audit_log where actor_id = '${u}' order by action`);
    expect(audit.rows).toEqual([{ action: "auth.household_created" }, { action: "auth.role_assigned_admin" }]);
  });
});

describe("demo household claim", () => {
  it("refuses an unverified email", async () => {
    const u = await unverifiedUser(20);
    const r = await svc(() => db.query<{ ok: boolean }>(`select public.claim_demo_household('${u}', 'Anita') as ok`));
    expect(r.rows[0].ok).toBe(false);
  });

  it("refuses a user who already has a household", async () => {
    const r = await svc(() => db.query<{ ok: boolean }>(`select public.claim_demo_household('${uid(11)}', 'Asha') as ok`));
    expect(r.rows[0].ok).toBe(false);
    expect((await roleOf(uid(11)))?.household_id).not.toBe(DEMO);
  });

  it("the first verified user claims it as admin; the second is refused", async () => {
    const first = await verifiedUser(21);
    const second = await verifiedUser(22);
    expect((await svc(() => db.query<{ ok: boolean }>(`select public.claim_demo_household('${first}', 'Anita') as ok`))).rows[0].ok).toBe(true);
    expect(await roleOf(first)).toEqual({ role: "admin", household_id: DEMO });
    expect((await svc(() => db.query<{ ok: boolean }>(`select public.claim_demo_household('${second}', 'Ravi') as ok`))).rows[0].ok).toBe(false);
    expect(await roleOf(second)).toBeUndefined();
  });

  it("once claimed, the owner can read Meera through RLS and an outsider cannot", async () => {
    const meera = `select 1 from public.patients where preferred_name = 'Meera'`;
    expect((await asRole(db, "authenticated", uid(21), () => db.query(meera))).rows).toHaveLength(1);
    expect((await asRole(db, "authenticated", uid(11), () => db.query(meera))).rows).toHaveLength(0);
  });
});

describe("invites", () => {
  let household = "";
  const accept = (token: string, user: string) =>
    svc(async () => (await db.query<{ household_id: string; role: string }>(
      `select * from public.accept_invite('${sha(token)}', '${user}', 'Invitee')`)).rows);

  beforeAll(async () => {
    household = (await roleOf(uid(11)))!.household_id;
  });

  async function invite(token: string, role: string, opts: { expired?: boolean } = {}) {
    const created = opts.expired ? `now() - interval '25 hours'` : "now()";
    const expires = opts.expired ? `now() - interval '1 hour'` : `now() + interval '24 hours'`;
    await db.exec(`insert into public.invites (household_id, role, token_hash, created_by, created_at, expires_at)
                   values ('${household}', '${role}', '${sha(token)}', '${uid(11)}', ${created}, ${expires})`);
  }

  it("a valid invite works once and gives the invited role in the invite's household", async () => {
    await invite("token-valid", "clinician");
    const user = await verifiedUser(30);
    expect(await accept("token-valid", user)).toEqual([{ household_id: household, role: "clinician" }]);
    expect(await roleOf(user)).toEqual({ role: "clinician", household_id: household });
    const audit = await db.query(`select action from public.audit_log where actor_id = '${user}' order by action`);
    expect(audit.rows).toEqual([{ action: "auth.invite_used" }, { action: "auth.role_assigned_clinician" }]);
  });

  it("a reused invite fails", async () => {
    const other = await verifiedUser(31);
    expect(await accept("token-valid", other)).toEqual([]);
    expect(await roleOf(other)).toBeUndefined();
  });

  it("an expired invite fails", async () => {
    await invite("token-expired", "family", { expired: true });
    const user = await verifiedUser(32);
    expect(await accept("token-expired", user)).toEqual([]);
    expect(await roleOf(user)).toBeUndefined();
  });

  it("a tampered token fails", async () => {
    await invite("token-real", "family");
    const user = await verifiedUser(33);
    expect(await accept("token-reaL", user)).toEqual([]);
    expect(await accept("token-real ", user)).toEqual([]);
    expect(await roleOf(user)).toBeUndefined();
  });

  it("an unverified user cannot accept, and the invite is not used up", async () => {
    const user = await unverifiedUser(34);
    expect(await accept("token-real", user)).toEqual([]);
    const used = await db.query<{ used_at: string | null }>(`select used_at from public.invites where token_hash = '${sha("token-real")}'`);
    expect(used.rows[0].used_at).toBeNull();
  });

  it("someone already in a household cannot join another, and the invite is not used up", async () => {
    expect(await accept("token-real", uid(21))).toEqual([]);
    expect((await roleOf(uid(21)))?.household_id).toBe(DEMO);
    const used = await db.query<{ used_at: string | null }>(`select used_at from public.invites where token_hash = '${sha("token-real")}'`);
    expect(used.rows[0].used_at).toBeNull();
  });

  it("invites cannot grant admin or last longer than 24 hours", async () => {
    await expect(invite("token-admin", "admin")).rejects.toThrow(/check/);
    await expect(
      db.exec(`insert into public.invites (household_id, role, token_hash, expires_at)
               values ('${household}', 'family', '${sha("long")}', now() + interval '25 hours')`),
    ).rejects.toThrow(/check/);
  });

  it("clients cannot read or create invites", async () => {
    expect((await asRole(db, "authenticated", uid(11), () => db.query(`select * from public.invites`))).rows).toHaveLength(0);
    await expect(
      asRole(db, "authenticated", uid(11), () =>
        db.exec(`insert into public.invites (household_id, role, token_hash) values ('${household}', 'clinician', '${sha("mine")}')`)),
    ).rejects.toThrow(/row-level security/);
  });
});
