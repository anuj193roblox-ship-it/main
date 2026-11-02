// Live household A vs B test against your real Supabase project (security gate for S1).
// Opt-in: set RLS_LIVE_TEST=1 in .env.local after applying supabase/migrations/0001_init.sql.
// It creates two temporary auth users and households, inserts its own rows (patient, contact,
// medicine, care plan, care plan item, allergy, condition, reminder, alert, event) in BOTH
// households, asserts isolation in both directions, then deletes everything.
// Passwords are random per run and never printed.
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.RLS_LIVE_TEST === "1";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type Household = {
  label: string;
  client: SupabaseClient;
  userId: string;
  householdId: string;
  patientId: string;
  medicationId: string;
  planItemId: string;
};

// Tables the signed-in client may read. Each gets a row per household before we assert.
const readableTables = [
  "patients", "contacts", "medications", "care_plans", "care_plan_items",
  "allergies", "conditions", "reminders", "alerts", "events",
] as const;

describe.skipIf(!enabled)("live RLS: household A and household B cannot touch each other", () => {
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const run = randomUUID().slice(0, 8);
  const created: { userIds: string[]; householdIds: string[] } = { userIds: [], householdIds: [] };
  let a: Household;
  let b: Household;

  async function must<D>(label: string, p: PromiseLike<{ data: D; error: { message: string } | null }>): Promise<NonNullable<D>> {
    const { data, error } = await p;
    if (error || data === null || data === undefined) throw new Error(`${label} failed: ${error?.message}`);
    return data as NonNullable<D>;
  }

  async function makeHousehold(label: string): Promise<Household> {
    const email = `rls-${run}-${label}@example.invalid`;
    const password = randomBytes(18).toString("base64url");
    const { data: auth, error: authErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (authErr || !auth.user) throw new Error(`createUser failed: ${authErr?.message}`);
    created.userIds.push(auth.user.id);

    const hh = await must("household", admin.from("households").insert({ name: `RLS test ${label} ${run}` }).select("id").single());
    created.householdIds.push(hh.id);
    const householdId = hh.id;

    await must("users", admin.from("users").insert({ id: auth.user.id, household_id: householdId, role: "family", display_name: label }).select("id").single());
    const patient = await must("patient", admin.from("patients").insert({ household_id: householdId, full_name: `Test ${label}`, preferred_name: label, birth_year: 1950 }).select("id").single());
    const patientId = patient.id;
    const base = { household_id: householdId, patient_id: patientId };

    await must("contact", admin.from("contacts").insert({ ...base, name: `Contact ${label}`, priority: "primary" }).select("id").single());
    const med = await must("medication", admin.from("medications").insert({ ...base, brand_name: `Medicine ${label}`, ingredient: `ingredient-${label}` }).select("id").single());
    const plan = await must("care plan", admin.from("care_plans").insert({ ...base, name: `Plan ${label}` }).select("id").single());
    const item = await must("care plan item", admin.from("care_plan_items").insert({ ...base, care_plan_id: plan.id, item_type: "medication", title: `Item ${label}`, medication_id: med.id, times_of_day: ["08:00"] }).select("id").single());
    await must("allergy", admin.from("allergies").insert({ ...base, substance: `Substance ${label}` }).select("id").single());
    await must("condition", admin.from("conditions").insert({ ...base, name: `Condition ${label}` }).select("id").single());
    const reminder = await must("reminder", admin.from("reminders").insert({ ...base, care_plan_item_id: item.id, due_at: new Date().toISOString() }).select("id").single());
    await must("event", admin.from("events").insert({ ...base, kind: "test" }).select("id").single());
    await must("alert", admin.from("alerts").insert({ ...base, reminder_id: reminder.id, kind: "test", summary: `Alert ${label}` }).select("id").single());

    const client = createClient(url, anon, { auth: { persistSession: false } });
    const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`sign-in failed: ${signInErr.message}`);
    return { label, client, userId: auth.user.id, householdId, patientId, medicationId: med.id, planItemId: item.id };
  }

  beforeAll(async () => {
    a = await makeHousehold("a");
    b = await makeHousehold("b");
  }, 120_000);

  afterAll(async () => {
    for (const id of created.householdIds) await admin.from("households").delete().eq("id", id);
    for (const id of created.userIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("both households really hold rows in every readable table (no empty-table passes)", async () => {
    for (const t of readableTables) {
      for (const h of [a, b]) {
        const { count, error } = await admin.from(t).select("id", { count: "exact", head: true }).eq("household_id", h.householdId);
        expect(error, `${t}`).toBeNull();
        expect(count, `${t} for ${h.label}`).toBeGreaterThan(0);
      }
    }
  });

  it.each(readableTables)("%s: each household reads its own rows and none of the other's", async (t) => {
    for (const [me, other] of [[a, b], [b, a]] as const) {
      const own = await me.client.from(t).select("id").eq("household_id", me.householdId);
      expect(own.error).toBeNull();
      expect(own.data?.length, `${me.label} reads own ${t}`).toBeGreaterThan(0);

      const cross = await me.client.from(t).select("id").eq("household_id", other.householdId);
      expect(cross.data ?? [], `${me.label} reads ${other.label}'s ${t}`).toHaveLength(0);

      const all = await me.client.from(t).select("household_id");
      expect((all.data ?? []).every((r) => r.household_id === me.householdId), `${me.label} unfiltered ${t}`).toBe(true);
    }
  });

  it("households and users are visible only to their own members", async () => {
    for (const [me, other] of [[a, b], [b, a]] as const) {
      expect((await me.client.from("households").select("id").eq("id", other.householdId)).data ?? []).toHaveLength(0);
      expect((await me.client.from("users").select("id").eq("household_id", other.householdId)).data ?? []).toHaveLength(0);
      expect((await me.client.from("households").select("id").eq("id", me.householdId)).data).toHaveLength(1);
    }
  });

  it("server-only tables are unreadable from the client", async () => {
    for (const t of ["device_tokens", "ack_tokens", "audit_log", "invites"]) {
      expect((await a.client.from(t).select("*")).data ?? [], t).toHaveLength(0);
    }
  });

  it("neither household can insert into the other", async () => {
    for (const [me, other] of [[a, b], [b, a]] as const) {
      const ins = await me.client.from("patients").insert({ household_id: other.householdId, full_name: "Intruder", preferred_name: "Intruder", birth_year: 1950 });
      expect(ins.error, `${me.label} into ${other.label}`).not.toBeNull();
      const med = await me.client.from("medications").insert({ household_id: me.householdId, patient_id: other.patientId, brand_name: "Intruder" });
      expect(med.error, `${me.label} medicine onto ${other.label}'s patient`).not.toBeNull();
      const link = await me.client.from("care_plan_items").insert({
        household_id: me.householdId, patient_id: me.patientId, care_plan_id: (await admin.from("care_plans").select("id").eq("household_id", me.householdId).single()).data?.id,
        item_type: "medication", title: "Cross link", medication_id: other.medicationId, times_of_day: ["08:00"],
      });
      expect(link.error, `${me.label} plan item linked to ${other.label}'s medicine`).not.toBeNull();
    }
  });

  it("neither household can update or delete the other's rows", async () => {
    for (const [me, other] of [[a, b], [b, a]] as const) {
      const upd = await me.client.from("patients").update({ preferred_name: "Hacked" }).eq("id", other.patientId).select("id");
      expect(upd.data ?? []).toHaveLength(0);
      const del = await me.client.from("medications").delete().eq("id", other.medicationId).select("id");
      expect(del.data ?? []).toHaveLength(0);
      const delItem = await me.client.from("care_plan_items").delete().eq("id", other.planItemId).select("id");
      expect(delItem.data ?? []).toHaveLength(0);
    }
    // Confirm with the service role that nothing actually changed.
    for (const h of [a, b]) {
      const p = await must("patient check", admin.from("patients").select("preferred_name").eq("id", h.patientId).single());
      expect(p.preferred_name).toBe(h.label);
      const m = await admin.from("medications").select("id").eq("id", h.medicationId);
      expect(m.data).toHaveLength(1);
    }
  });

  it("a user cannot change their own role or household", async () => {
    for (const [me, other] of [[a, b], [b, a]] as const) {
      const role = await me.client.from("users").update({ role: "admin" }).eq("id", me.userId).select("id");
      expect(role.data ?? []).toHaveLength(0);
      const move = await me.client.from("users").update({ household_id: other.householdId }).eq("id", me.userId).select("id");
      expect(move.data ?? []).toHaveLength(0);
      const row = await must("user check", admin.from("users").select("role, household_id").eq("id", me.userId).single());
      expect(row).toEqual({ role: "family", household_id: me.householdId });
    }
  });

  it("signed-out requests see nothing", async () => {
    const anonClient = createClient(url, anon, { auth: { persistSession: false } });
    for (const t of [...readableTables, "households", "users"]) {
      expect((await anonClient.from(t).select("id")).data ?? [], t).toHaveLength(0);
    }
  });
});
