// Household A vs B isolation, run against an in-memory Postgres (PGlite) with stand-ins for
// Supabase's auth schema and roles. It applies the real migration and seed files, then fills
// EVERY table in BOTH households with rows before asserting, so nothing passes on empty tables.
// The same checks against your real project live in rls.live.test.ts (opt-in).
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, createTestDb, readSeed } from "@/test/pglite";

const seed = readSeed();

/** Deterministic uuid: h is the household digit (1 or 2), n the row number. */
const id = (h: number, n: number) => `00000000-0000-4000-9${h}00-${String(n).padStart(12, "0")}`;

const A = { household: id(1, 1), patient: id(1, 10), med: id(1, 14), plan: id(1, 18), item: id(1, 19), reminder: id(1, 20), alert: id(1, 22) };
const B = { household: id(2, 1), patient: id(2, 10), med: id(2, 14), plan: id(2, 18), item: id(2, 19), reminder: id(2, 20), alert: id(2, 22) };
const userA = id(1, 90);
const clinicianA = id(1, 91);
const adminA = id(1, 92);
const userB = id(2, 90);
const adminB = id(2, 92);

/** One row in every table for household number h. */
function populate(h: number): string {
  const H = id(h, 1);
  const P = id(h, 10);
  return `
    insert into public.households (id, name) values ('${H}', 'Household ${h}');
    insert into public.patients (id, household_id, full_name, preferred_name, birth_year)
      values ('${P}', '${H}', 'Patient ${h}', 'P${h}', 1950);
    insert into public.contacts (id, household_id, patient_id, name, priority)
      values ('${id(h, 11)}', '${H}', '${P}', 'Contact ${h}', 'primary');
    insert into public.consents (id, household_id, patient_id, basis, given_by, evidence_note)
      values ('${id(h, 12)}', '${H}', '${P}', 'guardian', 'Guardian ${h}', 'Test evidence');
    insert into public.conditions (id, household_id, patient_id, name)
      values ('${id(h, 13)}', '${H}', '${P}', 'Condition ${h}');
    insert into public.medications (id, household_id, patient_id, brand_name, ingredient)
      values ('${id(h, 14)}', '${H}', '${P}', 'Medicine ${h}', 'ingredient${h}');
    insert into public.allergies (id, household_id, patient_id, substance)
      values ('${id(h, 15)}', '${H}', '${P}', 'Substance ${h}');
    insert into public.providers (id, household_id, patient_id, name)
      values ('${id(h, 16)}', '${H}', '${P}', 'Doctor ${h}');
    insert into public.vault_documents (id, household_id, patient_id, doc_type, storage_path, mime_type, size_bytes)
      values ('${id(h, 17)}', '${H}', '${P}', 'prescription', 'path/${h}.pdf', 'application/pdf', 1000);
    insert into public.care_plans (id, household_id, patient_id, name)
      values ('${id(h, 18)}', '${H}', '${P}', 'Plan ${h}');
    insert into public.care_plan_items (id, household_id, patient_id, care_plan_id, item_type, title, medication_id, times_of_day)
      values ('${id(h, 19)}', '${H}', '${P}', '${id(h, 18)}', 'medication', 'Item ${h}', '${id(h, 14)}', '{08:00}');
    insert into public.reminders (id, household_id, patient_id, care_plan_item_id, due_at)
      values ('${id(h, 20)}', '${H}', '${P}', '${id(h, 19)}', now());
    insert into public.escalation_steps (household_id, reminder_id, step, action)
      values ('${H}', '${id(h, 20)}', 1, 'prompt');
    insert into public.events (id, household_id, patient_id, kind)
      values ('${id(h, 21)}', '${H}', '${P}', 'test');
    insert into public.alerts (id, household_id, patient_id, reminder_id, kind, summary)
      values ('${id(h, 22)}', '${H}', '${P}', '${id(h, 20)}', 'test', 'Summary ${h}');
    insert into public.conversations (id, household_id, patient_id)
      values ('${id(h, 23)}', '${H}', '${P}');
    insert into public.messages (household_id, conversation_id, role, content)
      values ('${H}', '${id(h, 23)}', 'patient', 'Hello ${h}');
    insert into public.daily_summaries (household_id, patient_id, summary_date, story)
      values ('${H}', '${P}', current_date, 'Story ${h}');
    insert into public.media (household_id, patient_id, kind, storage_path, mime_type, size_bytes)
      values ('${H}', '${P}', 'photo', 'media/${h}.jpg', 'image/jpeg', 1000);
    insert into public.device_tokens (household_id, patient_id, token_hash, expires_at)
      values ('${H}', '${P}', 'device-hash-${h}', now() + interval '1 day');
    insert into public.ack_tokens (household_id, alert_id, token_hash, expires_at)
      values ('${H}', '${id(h, 22)}', 'ack-hash-${h}', now() + interval '1 day');
    insert into public.invites (household_id, role, token_hash)
      values ('${H}', 'family', repeat('${h}', 64));
    insert into public.device_pairings (household_id, patient_id, code_hash)
      values ('${H}', '${P}', repeat('${h}', 63) || 'a');
  `;
}

let db: PGlite;

/** Run fn as a signed-in user (RLS applies). uid null means signed out. */
function as<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
  return asRole(db, "authenticated", uid, fn);
}

async function count(sql: string): Promise<number> {
  const r = await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) x`);
  return r.rows[0].n;
}

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(`
    insert into auth.users (id) values ('${userA}'), ('${clinicianA}'), ('${adminA}'), ('${userB}'), ('${adminB}');
  `);
  await db.exec(populate(1));
  await db.exec(populate(2));
  await db.exec(`
    insert into public.users (id, household_id, role, display_name) values
      ('${userA}', '${A.household}', 'family', 'Family A'),
      ('${clinicianA}', '${A.household}', 'clinician', 'Clinician A'),
      ('${adminA}', '${A.household}', 'admin', 'Admin A'),
      ('${userB}', '${B.household}', 'family', 'Family B'),
      ('${adminB}', '${B.household}', 'admin', 'Admin B');
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const allTables = async () =>
  (await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows.map(
    (r) => r.tablename,
  );

describe("schema and seed", () => {
  it("RLS is enabled on every table", async () => {
    const off = await db.query(
      `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(off.rows).toEqual([]);
    expect((await allTables()).length).toBe(25);
  });

  it("the seed applies twice and loads Meera, Anita, Ravi and an unverified plan", async () => {
    await db.exec(seed);
    await db.exec(seed);
    expect(await count(`select 1 from public.patients where preferred_name = 'Meera'`)).toBe(1);
    expect(await count(`select 1 from public.contacts where name in ('Anita', 'Ravi')`)).toBe(2);
    expect(await count(`select 1 from public.care_plan_items where care_plan_id = '00000000-0000-4000-8000-000000000060'`)).toBe(7);
    expect(await count(`select 1 from public.medications where verified_by is not null`)).toBe(0);
  });

  it("every table really holds rows for both households before we test isolation", async () => {
    for (const t of await allTables()) {
      if (t === "users") continue;
      const key = t === "households" ? "id" : "household_id";
      for (const hh of [A.household, B.household]) {
        const n = await count(`select 1 from public.${t} where ${key} = '${hh}'`);
        expect(n, `${t} has no row for ${hh}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("household A and household B cannot see each other", () => {
  // Server-only tables: RLS on, no client policy. Even the owner's own rows are invisible to clients.
  const serverOnly = ["device_tokens", "ack_tokens", "invites", "device_pairings"];
  // Readable only by the household admin.
  const adminOnly = ["audit_log"];

  it("covers every table", async () => {
    const tables = await allTables();
    expect(tables.filter((t) => !["households", "users"].includes(t)).length).toBe(23);
  });

  it.each([
    "patients", "contacts", "consents", "conditions", "medications", "allergies", "providers", "vault_documents",
    "care_plans", "care_plan_items", "reminders", "escalation_steps", "events", "alerts", "conversations",
    "messages", "daily_summaries", "media",
  ])("%s: each household sees only its own rows", async (t) => {
    const own = (hh: string) => `select 1 from public.${t} where household_id = '${hh}'`;
    expect(await as(userA, () => count(own(A.household)))).toBeGreaterThan(0);
    expect(await as(userB, () => count(own(B.household)))).toBeGreaterThan(0);
    expect(await as(userB, () => count(own(A.household)))).toBe(0);
    expect(await as(userA, () => count(own(B.household)))).toBe(0);
    // Without a filter, a user gets exactly their own household's rows and nothing else.
    const mine = await as(userA, () => db.query<{ household_id: string }>(`select household_id from public.${t}`));
    expect(mine.rows.every((r) => r.household_id === A.household)).toBe(true);
  });

  it.each(serverOnly)("%s: rows exist but no client can read them", async (t) => {
    expect(await count(`select 1 from public.${t}`)).toBe(2);
    expect(await as(userA, () => count(`select 1 from public.${t}`))).toBe(0);
    expect(await as(adminA, () => count(`select 1 from public.${t}`))).toBe(0);
  });

  it.each(adminOnly)("%s: only the household admin reads it, and only their own", async (t) => {
    expect(await count(`select 1 from public.${t} where household_id = '${A.household}'`)).toBeGreaterThan(0);
    expect(await as(userA, () => count(`select 1 from public.${t}`))).toBe(0);
    expect(await as(adminA, () => count(`select 1 from public.${t} where household_id = '${A.household}'`))).toBeGreaterThan(0);
    expect(await as(adminA, () => count(`select 1 from public.${t} where household_id = '${B.household}'`))).toBe(0);
    expect(await as(adminB, () => count(`select 1 from public.${t} where household_id = '${A.household}'`))).toBe(0);
  });

  it("households and users: members see only their own household", async () => {
    expect(await as(userA, () => count(`select 1 from public.households`))).toBe(1);
    expect(await as(userB, () => count(`select 1 from public.households where id = '${A.household}'`))).toBe(0);
    expect(await as(userB, () => count(`select 1 from public.users where household_id = '${A.household}'`))).toBe(0);
    expect(await as(userA, () => count(`select 1 from public.users`))).toBe(3);
  });

  it("signed-out requests see nothing in any table", async () => {
    for (const t of await allTables()) {
      expect(await as(null, () => count(`select 1 from public.${t}`)), t).toBe(0);
    }
  });
});

describe("writes across households are rejected", () => {
  it("B cannot insert a patient into A", async () => {
    await expect(
      as(userB, () =>
        db.exec(`insert into public.patients (household_id, full_name, preferred_name, birth_year)
                 values ('${A.household}', 'X', 'X', 1950)`),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("B cannot attach a medicine to A's patient, even labelled with B's household", async () => {
    await expect(
      as(userB, () =>
        db.exec(`insert into public.medications (household_id, patient_id, brand_name)
                 values ('${B.household}', '${A.patient}', 'Intruder')`),
      ),
    ).rejects.toThrow(/foreign key|violates/);
  });

  it("B cannot update or delete any of A's rows", async () => {
    for (const t of ["patients", "contacts", "medications", "allergies", "conditions", "care_plans", "care_plan_items"]) {
      const idCol = t === "patients" ? "id" : "household_id";
      const target = t === "patients" ? A.patient : A.household;
      const upd = await as(userB, () => db.query(`update public.${t} set created_at = now() where ${idCol} = '${target}' returning 1`));
      const del = await as(userB, () => db.query(`delete from public.${t} where ${idCol} = '${target}' returning 1`));
      expect(upd.rows.length, `update ${t}`).toBe(0);
      expect(del.rows.length, `delete ${t}`).toBe(0);
    }
    expect(await count(`select 1 from public.medications where household_id = '${A.household}'`)).toBeGreaterThan(0);
  });

  it("A cannot touch B either", async () => {
    const upd = await as(userA, () => db.query(`update public.medications set dose = '99' where household_id = '${B.household}' returning 1`));
    expect(upd.rows.length).toBe(0);
  });

  it("server-written tables reject client inserts", async () => {
    const inserts = [
      `insert into public.alerts (household_id, patient_id, kind, summary) values ('${A.household}', '${A.patient}', 'x', 'x')`,
      `insert into public.reminders (household_id, patient_id, due_at) values ('${A.household}', '${A.patient}', now())`,
      `insert into public.events (household_id, patient_id, kind) values ('${A.household}', '${A.patient}', 'x')`,
      `insert into public.device_tokens (household_id, patient_id, token_hash, expires_at) values ('${A.household}', '${A.patient}', 'h', now())`,
      `insert into public.audit_log (household_id, action, table_name) values ('${A.household}', 'x', 'x')`,
    ];
    for (const sql of inserts) await expect(as(userA, () => db.exec(sql)), sql).rejects.toThrow(/row-level security/);
  });
});

describe("roles and consent cannot be tampered with from the client", () => {
  it("a family user cannot promote themselves or move household", async () => {
    const promote = await as(userA, () => db.query(`update public.users set role = 'admin' where id = '${userA}' returning 1`));
    const move = await as(userA, () => db.query(`update public.users set household_id = '${B.household}' where id = '${userA}' returning 1`));
    expect(promote.rows.length).toBe(0);
    expect(move.rows.length).toBe(0);
    await expect(
      as(userA, () => db.exec(`insert into public.users (id, household_id, role, display_name) values (gen_random_uuid(), '${A.household}', 'admin', 'x')`)),
    ).rejects.toThrow();
  });

  it("consent can be recorded but not edited or deleted", async () => {
    const edit = await as(userA, () => db.query(`update public.consents set given_by = 'Someone' where household_id = '${A.household}' returning 1`));
    const del = await as(userA, () => db.query(`delete from public.consents where household_id = '${A.household}' returning 1`));
    expect(edit.rows.length).toBe(0);
    expect(del.rows.length).toBe(0);
    const ins = await as(userA, () =>
      db.query(`insert into public.consents (household_id, patient_id, basis, given_by, evidence_note)
                values ('${A.household}', '${A.patient}', 'self', 'Patient', 'Said yes') returning 1`),
    );
    expect(ins.rows.length).toBe(1);
  });
});

describe("medicine verification and audit (VLT-4, VLT-5)", () => {
  let medId = "";

  it("a new medicine is Unverified even if the client sends verified_by", async () => {
    const r = await as(userA, () =>
      db.query<{ id: string; verified_by: string | null }>(
        `insert into public.medications (household_id, patient_id, brand_name, verified_by, verified_at)
         values ('${A.household}', '${A.patient}', 'Guard test', '${clinicianA}', now()) returning id, verified_by`,
      ),
    );
    expect(r.rows[0].verified_by).toBeNull();
    medId = r.rows[0].id;
  });

  it("a family user cannot verify", async () => {
    await expect(
      as(userA, () => db.exec(`update public.medications set verified_by = '${clinicianA}', verified_at = now() where id = '${medId}'`)),
    ).rejects.toThrow(/clinician/);
  });

  it("a clinician can verify, but only as themselves", async () => {
    await as(clinicianA, () => db.exec(`update public.medications set verified_by = '${clinicianA}', verified_at = now() where id = '${medId}'`));
    expect((await db.query<{ verified_by: string }>(`select verified_by from public.medications where id = '${medId}'`)).rows[0].verified_by).toBe(clinicianA);
    await expect(
      as(clinicianA, () => db.exec(`update public.medications set verified_by = '${userA}', verified_at = now() where id = '${medId}'`)),
    ).rejects.toThrow(/signed-in clinician/);
  });

  it("editing a verified medicine makes it Unverified again", async () => {
    await as(userA, () => db.exec(`update public.medications set dose = '2 tablets' where id = '${medId}'`));
    expect((await db.query<{ verified_by: string | null }>(`select verified_by from public.medications where id = '${medId}'`)).rows[0].verified_by).toBeNull();
  });

  it("every change wrote an audit row, readable by the admin only", async () => {
    // Three successful writes: insert, clinician verification, family edit. Rejected attempts write nothing.
    expect(await count(`select 1 from public.audit_log where table_name = 'medications' and record_id = '${medId}'`)).toBe(3);
    expect(await as(userA, () => count(`select 1 from public.audit_log`))).toBe(0);
    expect(await as(adminA, () => count(`select 1 from public.audit_log where record_id = '${medId}'`))).toBeGreaterThan(0);
  });
});

describe("data integrity", () => {
  it("a medication plan item needs a vault medicine", async () => {
    await expect(
      db.exec(`insert into public.care_plan_items (household_id, patient_id, care_plan_id, item_type, title, times_of_day)
               values ('${A.household}', '${A.patient}', '${A.plan}', 'medication', 'No link', '{08:00}')`),
    ).rejects.toThrow(/care_plan_items_medication_link/);
  });

  it("a plan item cannot link to another household's medicine", async () => {
    await expect(
      db.exec(`insert into public.care_plan_items (household_id, patient_id, care_plan_id, item_type, title, medication_id, times_of_day)
               values ('${A.household}', '${A.patient}', '${A.plan}', 'medication', 'Cross link', '${B.med}', '{08:00}')`),
    ).rejects.toThrow(/foreign key/);
  });

  it("a duplicate escalation step is rejected (idempotency)", async () => {
    await expect(
      db.exec(`insert into public.escalation_steps (household_id, reminder_id, step, action)
               values ('${A.household}', '${A.reminder}', 1, 'prompt')`),
    ).rejects.toThrow(/unique|duplicate/);
  });

  it("deleting a household cascades through every table", async () => {
    await db.exec(`delete from public.households where id = '${B.household}'`);
    for (const t of await allTables()) {
      if (["households", "users", "audit_log"].includes(t)) continue;
      expect(await count(`select 1 from public.${t} where household_id = '${B.household}'`), t).toBe(0);
    }
    expect(await count(`select 1 from public.users where household_id = '${B.household}'`)).toBe(0);
  });
});
