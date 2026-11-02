// Stage S3 services against the real migrations (0001-0003) in PGlite, running as real signed-in
// users so row-level security, the audit trigger, the medicine verification guard and the
// activation rule all apply.
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@/test/pglite";
import { pgliteDb } from "@/test/pglite-db";
import type { CareCtx } from "../context";
import { DbError } from "../db";
import { MEDICATION_LINK_REQUIRED } from "../schemas";
import { activate, loadOnboarding, NEEDS_CONSENT, NEEDS_PRIMARY_CONTACT, saveConsent, saveContacts, savePatient } from "./onboarding";
import { applyPreset, createPlanItem, decideReview, deletePlanItem, loadPlan, PLAN_HAS_ITEMS, updatePlanItem } from "./plan";
import { approveMedicine, createVaultEntry, deleteVaultEntry, loadVault, updateVaultEntry, verifyMedicine } from "./vault";

const uid = (n: number) => `00000000-0000-4000-c000-${String(n).padStart(12, "0")}`;
let pg: PGlite;
const ctx: Record<"adminA" | "familyA" | "clinicianA" | "adminB", CareCtx> = {} as never;

const db = (c: CareCtx) => pgliteDb(pg, c.userId);
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows[0];
const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;

const meera = { fullName: "Meera Rao", preferredName: "Meera", birthYear: 1946, language: "en", timezone: "Asia/Kolkata", conditions: ["Mild dementia"] };
const consent = { basis: "guardian", givenBy: "Anita Rao", evidenceNote: "Meera agreed at home with Anita present, 2 Nov.", agreed: true };
const contacts = {
  primary: { name: "Anita", phone: "98765 43210", relationship: "Daughter", channels: ["whatsapp", "call"], whatsappAgreed: true },
  secondary: { name: "Ravi", phone: "+91 91234 56789", relationship: "Son", channels: ["call"], whatsappAgreed: false },
};
const medicine = (over: Record<string, unknown> = {}) => ({
  brandName: "Amlodac",
  genericName: "Amlodipine",
  ingredient: "Amlodipine",
  strength: "5 mg",
  dose: "1 tablet",
  frequency: "Once a day",
  timing: ["08:00"],
  withFood: "any",
  purpose: "Blood pressure",
  prescriber: "Dr Rao",
  startDate: "2024-03-01",
  stopDate: "",
  status: "active",
  ...over,
});

beforeAll(async () => {
  pg = await createTestDb();
  const users = [
    ["adminA", 1],
    ["familyA", 2],
    ["clinicianA", 3],
    ["adminB", 4],
  ] as const;
  for (const [, n] of users) await pg.query(`insert into auth.users (id, email_confirmed_at) values ($1, now())`, [uid(n)]);
  const hhA = (await one<{ h: string }>(`select public.create_household_for_user($1, 'Anita', 'Rao family') as h`, [uid(1)])).h;
  const hhB = (await one<{ h: string }>(`select public.create_household_for_user($1, 'Bina', 'Other family') as h`, [uid(4)])).h;
  await pg.query(`insert into public.users (id, household_id, role, display_name) values ($1, $2, 'family', 'Ravi'), ($3, $2, 'clinician', 'Dr Rao')`, [uid(2), hhA, uid(3)]);
  ctx.adminA = { userId: uid(1), householdId: hhA, role: "admin" };
  ctx.familyA = { userId: uid(2), householdId: hhA, role: "family" };
  ctx.clinicianA = { userId: uid(3), householdId: hhA, role: "clinician" };
  ctx.adminB = { userId: uid(4), householdId: hhB, role: "admin" };
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

describe("onboarding and activation", () => {
  it("a clinician cannot add a person or give consent", async () => {
    expect((await savePatient(meera, db(ctx.clinicianA), ctx.clinicianA)).status).toBe(403);
    expect((await saveConsent(consent, db(ctx.clinicianA), ctx.clinicianA)).status).toBe(403);
  });

  it("step 1 creates one draft with its conditions, and saving again does not duplicate", async () => {
    expect(await savePatient(meera, db(ctx.adminA), ctx.adminA)).toEqual({ status: 200, body: { next: "/onboarding/consent" } });
    expect((await savePatient({ ...meera, conditions: ["mild dementia", "High blood pressure"] }, db(ctx.adminA), ctx.adminA)).status).toBe(200);
    const patients = await all(`select status from public.patients where household_id = $1`, [ctx.adminA.householdId]);
    expect(patients).toEqual([{ status: "draft" }]);
    const conditions = await all<{ name: string }>(`select name from public.conditions where household_id = $1 order by name`, [ctx.adminA.householdId]);
    expect(conditions.map((c) => c.name)).toEqual(["High blood pressure", "Mild dementia"]);
  });

  it("activation is blocked without consent", async () => {
    const res = await activate(db(ctx.adminA), ctx.adminA);
    expect(res).toEqual({ status: 409, body: { error: NEEDS_CONSENT, step: "/onboarding/consent" } });
    expect((await one<{ status: string }>(`select status from public.patients where household_id = $1`, [ctx.adminA.householdId])).status).toBe("draft");
  });

  it("consent stores basis, given_by, the evidence note and the text version", async () => {
    expect((await saveConsent({ ...consent, agreed: false }, db(ctx.adminA), ctx.adminA)).status).toBe(400);
    expect(await saveConsent(consent, db(ctx.adminA), ctx.adminA)).toEqual({ status: 200, body: { next: "/onboarding/contacts" } });
    const row = await one(`select basis, given_by, evidence_note, text_version, revoked_at from public.consents where household_id = $1`, [ctx.adminA.householdId]);
    expect(row).toEqual({
      basis: "guardian",
      given_by: "Anita Rao",
      evidence_note: "Meera agreed at home with Anita present, 2 Nov.",
      text_version: "draft-2026-11b",
      revoked_at: null,
    });
  });

  it("activation is blocked without a primary contact", async () => {
    const res = await activate(db(ctx.adminA), ctx.adminA);
    expect(res).toEqual({ status: 409, body: { error: NEEDS_PRIMARY_CONTACT, step: "/onboarding/contacts" } });
  });

  it.each(["12345", "+91 12345 67890", "phone me", "+0 98765 43210", "98765 4321", "<script>alert(1)</script>", "+91 98765 43210 12345"])(
    "invalid phone %j is rejected on the server and nothing is saved",
    async (phone) => {
      const res = await saveContacts({ ...contacts, primary: { ...contacts.primary, phone } }, db(ctx.adminA), ctx.adminA);
      expect(res.status).toBe(400);
      expect(String(res.body.error)).toMatch(/^Primary contact: Enter a mobile number/);
      expect(await all(`select id from public.contacts where household_id = $1`, [ctx.adminA.householdId])).toEqual([]);
    },
  );

  it("the database refuses a non-E.164 phone even if the server check were skipped", async () => {
    const patient = (await loadOnboarding(db(ctx.adminA), ctx.adminA)).patient!;
    await expect(
      db(ctx.adminA).insert("contacts", { household_id: ctx.adminA.householdId, patient_id: patient.id, name: "X", priority: "primary", phone: "98765" }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("contacts are stored in E.164 with the WhatsApp agreement time only when ticked", async () => {
    expect(await saveContacts(contacts, db(ctx.adminA), ctx.adminA)).toEqual({ status: 200, body: { next: "/onboarding/review" } });
    const rows = await all<{ priority: string; phone: string; whatsapp_opt_in_at: string | null; channels: string[] }>(
      `select priority, phone, whatsapp_opt_in_at, channels from public.contacts where household_id = $1 order by priority`,
      [ctx.adminA.householdId],
    );
    expect(rows[0]).toMatchObject({ priority: "primary", phone: "+919876543210", channels: ["whatsapp", "call"] });
    expect(rows[0].whatsapp_opt_in_at).not.toBeNull();
    expect(rows[1]).toMatchObject({ priority: "secondary", phone: "+919123456789", whatsapp_opt_in_at: null });
  });

  it("with consent and a primary contact, activation works and records the time", async () => {
    expect(await activate(db(ctx.adminA), ctx.adminA)).toEqual({ status: 200, body: { next: "/app/today" } });
    const p = await one<{ status: string; activated_at: string | null }>(`select status, activated_at from public.patients where household_id = $1`, [ctx.adminA.householdId]);
    expect(p.status).toBe("active");
    expect(p.activated_at).not.toBeNull();
  });

  it("a patient cannot be created already active", async () => {
    await expect(
      db(ctx.adminB).insert("patients", { household_id: ctx.adminB.householdId, full_name: "X", preferred_name: "X", birth_year: 1950, status: "active" }),
    ).rejects.toThrow(/nurra_activation_needs_consent/);
  });
});

describe("Vault Lite medicines", () => {
  let medId = "";

  it("a new medicine starts Unverified even if the request tries to verify it", async () => {
    const res = await createVaultEntry("medications", { ...medicine(), verified_by: uid(3), approved_by: uid(2), household_id: ctx.adminB.householdId }, db(ctx.familyA), ctx.familyA);
    expect(res.status).toBe(201);
    medId = String(res.body.id);
    const row = await one(`select household_id, approved_by, verified_by, timing from public.medications where id = $1`, [medId]);
    expect(row).toEqual({ household_id: ctx.familyA.householdId, approved_by: null, verified_by: null, timing: ["08:00"] });
  });

  it("family can approve, as themselves", async () => {
    expect((await approveMedicine(medId, db(ctx.familyA), ctx.familyA)).status).toBe(200);
    expect((await one(`select approved_by from public.medications where id = $1`, [medId])).approved_by).toBe(uid(2));
  });

  it("a family member cannot set clinician verified: the service refuses, and so does the database", async () => {
    expect(await verifyMedicine(medId, db(ctx.familyA), ctx.familyA)).toEqual({ status: 403, body: { error: "Only a clinician can verify a medicine." } });
    await expect(
      db(ctx.familyA).update("medications", { id: medId, household_id: ctx.familyA.householdId }, { verified_by: uid(2), verified_at: new Date().toISOString() }),
    ).rejects.toThrow(/Only a clinician can verify/);
    await expect(
      db(ctx.familyA).update("medications", { id: medId, household_id: ctx.familyA.householdId }, { approved_by: uid(1), approved_at: new Date().toISOString() }),
    ).rejects.toThrow(/as the signed-in user/);
    expect((await one(`select verified_by from public.medications where id = $1`, [medId])).verified_by).toBeNull();
  });

  it("a clinician can verify", async () => {
    expect((await verifyMedicine(medId, db(ctx.clinicianA), ctx.clinicianA)).status).toBe(200);
    expect((await one(`select verified_by from public.medications where id = $1`, [medId])).verified_by).toBe(uid(3));
  });

  it("editing the medicine returns it to Unverified", async () => {
    expect((await updateVaultEntry("medications", medId, medicine({ dose: "2 tablets" }), db(ctx.familyA), ctx.familyA)).status).toBe(200);
    expect(await one(`select approved_by, verified_by from public.medications where id = $1`, [medId])).toEqual({ approved_by: null, verified_by: null });
  });

  it("conditions and allergies have list, add, edit and delete", async () => {
    const c = await createVaultEntry("conditions", { name: "Diabetes type 2", since: "2020-01-01", treatingDoctor: "", notes: "Diet controlled" }, db(ctx.familyA), ctx.familyA);
    const a = await createVaultEntry("allergies", { substance: "Penicillin", reaction: "Rash", severity: "severe" }, db(ctx.familyA), ctx.familyA);
    expect([c.status, a.status]).toEqual([201, 201]);
    expect((await updateVaultEntry("allergies", String(a.body.id), { substance: "Penicillin", reaction: "Hives", severity: "severe" }, db(ctx.familyA), ctx.familyA)).status).toBe(200);
    const vault = await loadVault(db(ctx.familyA), ctx.familyA);
    expect(vault.allergies.map((x) => x.reaction)).toEqual(["Hives"]);
    expect(vault.conditions.map((x) => x.name)).toContain("Diabetes type 2");
    expect((await deleteVaultEntry("conditions", String(c.body.id), db(ctx.familyA), ctx.familyA)).status).toBe(200);
    expect((await deleteVaultEntry("allergies", String(a.body.id), db(ctx.familyA), ctx.familyA)).status).toBe(200);
  });

  it("vault changes write audit rows with column names and no values", async () => {
    const rows = await all<{ action: string; changed_columns: string[] | null; actor_id: string }>(
      `select action, changed_columns, actor_id from public.audit_log where table_name = 'medications' and record_id = $1 order by created_at, action`,
      [medId],
    );
    expect(rows.map((r) => r.action)).toEqual(["insert", "update", "update", "update"]);
    const edit = rows[3];
    expect(edit.actor_id).toBe(uid(2));
    expect(edit.changed_columns).toEqual(expect.arrayContaining(["dose", "verified_by", "verified_at", "approved_by", "approved_at"]));
    expect(rows[1].changed_columns).toEqual(["approved_at", "approved_by"]);
    const dump = JSON.stringify(await all(`select * from public.audit_log`));
    for (const value of ["2 tablets", "1 tablet", "Amlodac", "Blood pressure", "Diet controlled", "Penicillin", "Hives", "+919876543210", "Anita Rao", "Meera"]) {
      expect(dump, value).not.toContain(value);
    }
  });
});

describe("care plan", () => {
  it("medication plan items without a linked medicine are rejected", async () => {
    const item = { itemType: "medication", title: "Morning medicines", severity: "important", schedule: { kind: "times", times: ["08:00"], days: [0, 1, 2, 3, 4, 5, 6] } };
    expect(await createPlanItem(item, db(ctx.familyA), ctx.familyA)).toEqual({ status: 400, body: { error: MEDICATION_LINK_REQUIRED } });
    // A medicine id from another household is treated as "no medicine".
    const bMed = await createVaultEntry("medications", medicine(), db(ctx.adminB), ctx.adminB);
    expect(bMed.status).toBe(409); // household B has no patient yet
    expect(await createPlanItem({ ...item, medicationId: randomUUID() }, db(ctx.familyA), ctx.familyA)).toEqual({ status: 400, body: { error: MEDICATION_LINK_REQUIRED } });
    // And the database refuses an active unlinked medication item outright.
    const plan = await loadPlan(db(ctx.familyA), ctx.familyA);
    await expect(
      db(ctx.familyA).insert("care_plan_items", {
        household_id: ctx.familyA.householdId, patient_id: plan.patient!.id, care_plan_id: plan.plan?.id ?? uid(1), item_type: "medication", title: "X", times_of_day: ["08:00"],
      }),
    ).rejects.toBeInstanceOf(DbError);
  });

  it("a preset fills an empty plan; medication slots are inactive placeholders; a second preset is refused", async () => {
    expect(await applyPreset({ preset: "dementia" }, db(ctx.familyA), ctx.familyA)).toEqual({ status: 201, body: { ok: true } });
    const plan = await loadPlan(db(ctx.familyA), ctx.familyA);
    const placeholders = plan.items.filter((i) => i.item_type === "medication");
    expect(placeholders.length).toBe(2);
    expect(placeholders.every((i) => i.is_placeholder === true && i.active === false && i.medication_id === null)).toBe(true);
    const water = plan.items.find((i) => i.item_type === "water")!;
    expect(water).toMatchObject({ schedule_kind: "interval", interval_minutes: 120 });
    expect(await applyPreset({ preset: "diabetes" }, db(ctx.familyA), ctx.familyA)).toEqual({ status: 409, body: { error: PLAN_HAS_ITEMS } });
  });

  it("repeating every few minutes is only allowed for water", async () => {
    const res = await createPlanItem(
      { itemType: "meal", title: "Snack", severity: "normal", schedule: { kind: "interval", everyMinutes: 60, from: "09:00", to: "18:00", days: [1] } },
      db(ctx.familyA),
      ctx.familyA,
    );
    expect(res.status).toBe(400);
  });

  let itemId = "";
  let medId = "";

  it("linking a placeholder to an Unverified medicine is allowed and records a snapshot", async () => {
    medId = String((await createVaultEntry("medications", medicine({ brandName: "Aricept", timing: ["20:00"] }), db(ctx.familyA), ctx.familyA)).body.id);
    const plan = await loadPlan(db(ctx.familyA), ctx.familyA);
    itemId = String(plan.items.find((i) => i.title === "Evening medicines")!.id);
    const res = await updatePlanItem(
      itemId,
      { itemType: "medication", title: "Evening medicines", severity: "important", schedule: { kind: "times", times: ["20:00"], days: [0, 1, 2, 3, 4, 5, 6] }, medicationId: medId },
      db(ctx.familyA),
      ctx.familyA,
    );
    expect(res.status).toBe(200);
    const item = await one(`select active, is_placeholder, medication_id, medication_snapshot from public.care_plan_items where id = $1`, [itemId]);
    expect(item).toMatchObject({ active: true, is_placeholder: false, medication_id: medId });
    expect(item.medication_snapshot).toMatchObject({ timing: ["20:00"], dose: "1 tablet", status: "active" });
  });

  it("a medicine change raises 'apply to reminders' with before and after, and does not change the plan until confirmed", async () => {
    const res = await updateVaultEntry("medications", medId, medicine({ brandName: "Aricept", timing: ["21:00"], dose: "2 tablets" }), db(ctx.familyA), ctx.familyA);
    expect(res.status).toBe(200);
    const reviews = res.body.reviews as { itemId: string; changes: { field: string; before: string; after: string }[]; proposal: { times?: string[] } }[];
    expect(reviews).toHaveLength(1);
    expect(reviews[0].itemId).toBe(itemId);
    expect(reviews[0].changes).toEqual([
      { field: "dose", label: "Dose", before: "1 tablet", after: "2 tablets" },
      { field: "timing", label: "Times", before: "20:00", after: "21:00" },
    ]);
    expect(reviews[0].proposal.times).toEqual(["21:00"]);

    // Not applied yet: the plan still has the old time.
    expect((await one(`select times_of_day from public.care_plan_items where id = $1`, [itemId])).times_of_day).toEqual(["20:00:00"]);
    expect((await loadPlan(db(ctx.familyA), ctx.familyA)).reviews.map((r) => r.itemId)).toEqual([itemId]);

    // Confirmed: now it changes, and the prompt goes away.
    expect((await decideReview(itemId, { decision: "apply" }, db(ctx.familyA), ctx.familyA)).status).toBe(200);
    expect((await one(`select times_of_day from public.care_plan_items where id = $1`, [itemId])).times_of_day).toEqual(["21:00:00"]);
    expect((await loadPlan(db(ctx.familyA), ctx.familyA)).reviews).toEqual([]);
  });

  it("'keep' leaves the plan as it is; a stopped medicine can switch the item off when applied", async () => {
    await updateVaultEntry("medications", medId, medicine({ brandName: "Aricept", timing: ["22:00"], dose: "2 tablets" }), db(ctx.familyA), ctx.familyA);
    expect((await decideReview(itemId, { decision: "keep" }, db(ctx.familyA), ctx.familyA)).status).toBe(200);
    expect((await one(`select times_of_day from public.care_plan_items where id = $1`, [itemId])).times_of_day).toEqual(["21:00:00"]);

    await updateVaultEntry("medications", medId, medicine({ brandName: "Aricept", timing: ["22:00"], dose: "2 tablets", status: "stopped", stopDate: "2026-11-02" }), db(ctx.familyA), ctx.familyA);
    expect((await one(`select active from public.care_plan_items where id = $1`, [itemId])).active).toBe(true);
    expect((await decideReview(itemId, { decision: "apply" }, db(ctx.familyA), ctx.familyA)).status).toBe(200);
    expect((await one(`select active from public.care_plan_items where id = $1`, [itemId])).active).toBe(false);
    expect((await decideReview(itemId, { decision: "apply" }, db(ctx.familyA), ctx.familyA)).status).toBe(409);
  });

  it("a medicine used in the plan cannot be deleted from the vault", async () => {
    expect((await deleteVaultEntry("medications", medId, db(ctx.familyA), ctx.familyA)).status).toBe(409);
  });

  it("care plan changes write audit rows with column names and no values", async () => {
    const rows = await all<{ changed_columns: string[] | null }>(
      `select changed_columns from public.audit_log where table_name = 'care_plan_items' and record_id = $1 and action = 'update' order by created_at`,
      [itemId],
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.flatMap((r) => r.changed_columns ?? [])).toEqual(expect.arrayContaining(["medication_id", "times_of_day", "active", "medication_snapshot"]));
    const dump = JSON.stringify(await all(`select * from public.audit_log where table_name = 'care_plan_items'`));
    for (const value of ["Evening medicines", "21:00", "2 tablets", "Aricept"]) expect(dump, value).not.toContain(value);
  });
});

describe("household A cannot read or change household B through the services", () => {
  let bMed = "";
  let bItem = "";
  let bCondition = "";

  beforeAll(async () => {
    const d = db(ctx.adminB);
    await savePatient({ ...meera, fullName: "Bina's mother", preferredName: "Amma" }, d, ctx.adminB);
    bMed = String((await createVaultEntry("medications", medicine({ brandName: "B medicine" }), d, ctx.adminB)).body.id);
    bCondition = String((await createVaultEntry("conditions", { name: "B condition" }, d, ctx.adminB)).body.id);
    await applyPreset({ preset: "diabetes" }, d, ctx.adminB);
    bItem = String((await loadPlan(d, ctx.adminB)).items[0].id);
  });

  it("A's views never include B's people, vault or plan", async () => {
    const vault = await loadVault(db(ctx.familyA), ctx.familyA);
    const plan = await loadPlan(db(ctx.familyA), ctx.familyA);
    const onboarding = await loadOnboarding(db(ctx.familyA), ctx.familyA);
    const text = JSON.stringify({ vault, plan, onboarding });
    for (const s of ["B medicine", "B condition", "Amma", bItem, bMed]) expect(text, s).not.toContain(s);
  });

  it("A cannot change or delete B's vault entries or plan items, even with the right ids", async () => {
    const d = db(ctx.adminA);
    expect((await updateVaultEntry("medications", bMed, medicine({ dose: "99" }), d, ctx.adminA)).status).toBe(404);
    expect((await deleteVaultEntry("conditions", bCondition, d, ctx.adminA)).status).toBe(404);
    expect((await approveMedicine(bMed, d, ctx.adminA)).status).toBe(404);
    expect((await updatePlanItem(bItem, { itemType: "meal", title: "Hacked", severity: "normal", schedule: { kind: "times", times: ["08:00"], days: [1] } }, d, ctx.adminA)).status).toBe(404);
    expect((await deletePlanItem(bItem, d, ctx.adminA)).status).toBe(404);
    expect((await decideReview(bItem, { decision: "apply" }, d, ctx.adminA)).status).toBe(404);
    expect(await one(`select dose, approved_by from public.medications where id = $1`, [bMed])).toEqual({ dose: "1 tablet", approved_by: null });
    expect((await one(`select title from public.care_plan_items where id = $1`, [bItem])).title).not.toBe("Hacked");
    expect(await one(`select count(*)::int as n from public.conditions where id = $1`, [bCondition])).toEqual({ n: 1 });
  });

  it("even a forged household id in the query returns nothing: RLS holds under the services", async () => {
    const d = db(ctx.adminA);
    expect(await d.select("medications", { household_id: ctx.adminB.householdId })).toEqual([]);
    expect(await d.update("medications", { id: bMed, household_id: ctx.adminB.householdId }, { dose: "99" })).toEqual([]);
    expect(await d.remove("care_plan_items", { id: bItem, household_id: ctx.adminB.householdId })).toBe(0);
  });

  it("A cannot link B's medicine into A's plan", async () => {
    const res = await createPlanItem(
      { itemType: "medication", title: "Sneaky", severity: "normal", schedule: { kind: "times", times: ["08:00"], days: [1] }, medicationId: bMed },
      db(ctx.familyA),
      ctx.familyA,
    );
    expect(res).toEqual({ status: 400, body: { error: MEDICATION_LINK_REQUIRED } });
  });
});
