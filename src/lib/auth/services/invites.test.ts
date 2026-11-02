// Invite flow end to end: the TypeScript services (hashing, generic messages, household from the
// session) running against the real SQL from migration 0002 in PGlite.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, createTestDb } from "@/test/pglite";
import type { Role } from "../access";
import { createMemoryAuditLogger } from "../audit";
import { createMemoryRateLimiter } from "../rate-limit";
import { randomToken, sha256Hex } from "../tokens";
import { claimDemoHousehold, createHousehold } from "./household";
import { acceptInvite, type AcceptInviteDeps, createInvite, type CreateInviteDeps, INVITE_UNUSABLE } from "./invites";

const uid = (n: number) => `00000000-0000-4000-b000-${String(n).padStart(12, "0")}`;
let db: PGlite;
let householdA = "";
let householdB = "";
const adminA = uid(1);
const adminB = uid(2);
const familyA = uid(3);

function createDeps(): CreateInviteDeps {
  return {
    randomToken,
    hash: sha256Hex,
    limiter: createMemoryRateLimiter(),
    audit: createMemoryAuditLogger(),
    siteUrl: "https://nurra.example",
    async insertInvite(row) {
      const r = await asRole(db, "service_role", null, () =>
        db.query<{ id: string }>(
          `insert into public.invites (household_id, role, token_hash, created_by) values ($1, $2, $3, $4) returning id`,
          [row.householdId, row.role, row.tokenHash, row.createdBy],
        ),
      );
      return r.rows[0] ?? null;
    },
  };
}

function acceptDeps(): AcceptInviteDeps {
  return {
    hash: sha256Hex,
    limiter: createMemoryRateLimiter(),
    audit: createMemoryAuditLogger(),
    async acceptInvite(tokenHash, userId, displayName) {
      const r = await asRole(db, "service_role", null, () =>
        db.query<{ household_id: string; role: Role }>(`select * from public.accept_invite($1, $2, $3)`, [tokenHash, userId, displayName]),
      );
      return r.rows[0] ? { householdId: r.rows[0].household_id, role: r.rows[0].role } : null;
    },
  };
}

async function newVerifiedUser(n: number) {
  await db.query(`insert into auth.users (id, email_confirmed_at) values ($1, now())`, [uid(n)]);
  return uid(n);
}

const tokenOf = (link: unknown) => String(link).split("/invite/")[1];
const memberOf = async (user: string) =>
  (await db.query<{ household_id: string; role: string }>(`select household_id, role from public.users where id = $1`, [user])).rows[0];

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [adminA, adminB, familyA]) await db.query(`insert into auth.users (id, email_confirmed_at) values ($1, now())`, [id]);
  const create = (user: string, name: string) =>
    createHousehold({ displayName: name, householdName: `${name} home` }, { userId: user }, {
      limiter: createMemoryRateLimiter(),
      createHousehold: async (u, d, h) =>
        (await asRole(db, "service_role", null, () => db.query<{ h: string | null }>(`select public.create_household_for_user($1, $2, $3) as h`, [u, d, h]))).rows[0].h,
    });
  expect((await create(adminA, "Anita")).status).toBe(201);
  expect((await create(adminB, "Bina")).status).toBe(201);
  householdA = (await memberOf(adminA)).household_id;
  householdB = (await memberOf(adminB)).household_id;
  await db.query(`insert into public.users (id, household_id, role, display_name) values ($1, $2, 'family', 'Ravi')`, [familyA, householdA]);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("creating invites", () => {
  it("the first sign-up became admin of a new household, created server-side", async () => {
    expect(await memberOf(adminA)).toEqual({ household_id: householdA, role: "admin" });
    expect(householdA).not.toBe(householdB);
  });

  it("the household always comes from the session, never the body (A cannot invite into B)", async () => {
    const res = await createInvite(
      { role: "clinician", household_id: householdB, householdId: householdB },
      { userId: adminA, householdId: householdA, role: "admin" },
      createDeps(),
    );
    expect(res.status).toBe(201);
    const hash = await sha256Hex(tokenOf(res.body.link));
    const row = (await db.query<{ household_id: string }>(`select household_id from public.invites where token_hash = $1`, [hash])).rows[0];
    expect(row.household_id).toBe(householdA);
  });

  it("only the household admin can invite", async () => {
    const res = await createInvite({ role: "family" }, { userId: familyA, householdId: householdA, role: "family" }, createDeps());
    expect(res.status).toBe(403);
  });

  it("invites cannot make someone an admin", async () => {
    const res = await createInvite({ role: "admin" }, { userId: adminA, householdId: householdA, role: "admin" }, createDeps());
    expect(res.status).toBe(400);
  });

  it("only the hash is stored, never the token", async () => {
    const res = await createInvite({ role: "family" }, { userId: adminA, householdId: householdA, role: "admin" }, createDeps());
    const token = tokenOf(res.body.link);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const dump = JSON.stringify((await db.query(`select * from public.invites`)).rows);
    expect(dump).not.toContain(token);
  });
});

describe("accepting invites", () => {
  let token = "";

  beforeAll(async () => {
    const res = await createInvite({ role: "clinician" }, { userId: adminA, householdId: householdA, role: "admin" }, createDeps());
    token = tokenOf(res.body.link);
  });

  it("a valid invite works once: the user joins household A as clinician", async () => {
    const user = await newVerifiedUser(10);
    const res = await acceptInvite({ token, displayName: "Dr Rao" }, { userId: user, ip: "1.1.1.1" }, acceptDeps());
    expect(res).toEqual({ status: 200, body: { next: "/app/today" } });
    expect(await memberOf(user)).toEqual({ household_id: householdA, role: "clinician" });
  });

  it("a reused invite fails with the generic message", async () => {
    const user = await newVerifiedUser(11);
    const res = await acceptInvite({ token, displayName: "Someone" }, { userId: user, ip: "1.1.1.1" }, acceptDeps());
    expect(res).toEqual({ status: 400, body: { error: INVITE_UNUSABLE } });
    expect(await memberOf(user)).toBeUndefined();
  });

  it("an expired invite fails with the same message", async () => {
    const res = await createInvite({ role: "family" }, { userId: adminA, householdId: householdA, role: "admin" }, createDeps());
    const expiredToken = tokenOf(res.body.link);
    await db.query(`update public.invites set created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour' where token_hash = $1`, [
      await sha256Hex(expiredToken),
    ]);
    const user = await newVerifiedUser(12);
    expect(await acceptInvite({ token: expiredToken, displayName: "Late" }, { userId: user, ip: "1.1.1.1" }, acceptDeps())).toEqual({
      status: 400,
      body: { error: INVITE_UNUSABLE },
    });
  });

  it("tampered tokens fail with the same message, and do not use up the real invite", async () => {
    const res = await createInvite({ role: "family" }, { userId: adminA, householdId: householdA, role: "admin" }, createDeps());
    const real = tokenOf(res.body.link);
    const flipped = (real[0] === "A" ? "B" : "A") + real.slice(1);
    const user = await newVerifiedUser(13);
    for (const t of [flipped, real.slice(0, 42), `${real}A`, real.toLowerCase() === real ? real.toUpperCase() : real.toLowerCase(), "../../etc"]) {
      expect(await acceptInvite({ token: t, displayName: "Tamper" }, { userId: user, ip: "1.1.1.1" }, acceptDeps())).toEqual({
        status: 400,
        body: { error: INVITE_UNUSABLE },
      });
    }
    expect(await memberOf(user)).toBeUndefined();
    expect((await acceptInvite({ token: real, displayName: "Real" }, { userId: user, ip: "1.1.1.1" }, acceptDeps())).status).toBe(200);
  });

  it("a member of household B cannot use an invite to reach household A", async () => {
    const res = await createInvite({ role: "family" }, { userId: adminA, householdId: householdA, role: "admin" }, createDeps());
    const result = await acceptInvite({ token: tokenOf(res.body.link), displayName: "Bina" }, { userId: adminB, ip: "1.1.1.1" }, acceptDeps());
    expect(result).toEqual({ status: 400, body: { error: INVITE_UNUSABLE } });
    expect(await memberOf(adminB)).toEqual({ household_id: householdB, role: "admin" });
  });

  it("household B's admin still cannot read household A's rows after all this", async () => {
    const rows = await asRole(db, "authenticated", adminB, () => db.query(`select id from public.users where household_id = $1`, [householdA]));
    expect(rows.rows).toHaveLength(0);
  });
});

describe("household creation and demo claim", () => {
  it("a second household for the same user is refused", async () => {
    const res = await createHousehold({ displayName: "Anita", householdName: "Another" }, { userId: adminA }, {
      limiter: createMemoryRateLimiter(),
      createHousehold: async (u, d, h) =>
        (await asRole(db, "service_role", null, () => db.query<{ h: string | null }>(`select public.create_household_for_user($1, $2, $3) as h`, [u, d, h]))).rows[0].h,
    });
    expect(res.status).toBe(409);
  });

  it("the demo claim is unavailable unless NEXT_PUBLIC_DEMO_MODE is on", async () => {
    let called = false;
    const res = await claimDemoHousehold({ displayName: "X" }, { userId: uid(50) }, {
      demoMode: false,
      limiter: createMemoryRateLimiter(),
      claim: async () => {
        called = true;
        return true;
      },
    });
    expect(res.status).toBe(404);
    expect(called).toBe(false);
  });
});
