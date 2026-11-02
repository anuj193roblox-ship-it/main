// Vault Lite (VLT-1 to VLT-5): conditions, medicines, allergies. Every change is made by a person
// through the server, checked for role and household, and audited by the database triggers.
import type { ServiceResult } from "@/lib/auth/services/result";
import { z } from "zod";
import {
  canApproveMedicine,
  canEditCare,
  canVerifyMedicine,
  type CareCtx,
  currentPatient,
  FORBIDDEN,
  guarded,
  NO_PATIENT,
  NOT_FOUND,
  orNull,
} from "../context";
import type { CareTable, Db, Row } from "../db";
import { type MedicineChange, medicineChange } from "../medicine-change";
import { allergySchema, conditionSchema, firstIssue, medicationSchema, type VaultKind } from "../schemas";

const uuid = z.uuid();

/** Form fields (camelCase) to database columns. Only these columns can ever be written. */
const MAPPERS: Record<VaultKind, (raw: unknown) => { ok: true; row: Row } | { ok: false; error: string }> = {
  conditions(raw) {
    const p = conditionSchema.safeParse(raw);
    if (!p.success) return { ok: false, error: firstIssue(p.error) };
    const c = p.data;
    return { ok: true, row: { name: c.name, since: orNull(c.since), treating_doctor: orNull(c.treatingDoctor), notes: orNull(c.notes) } };
  },
  medications(raw) {
    const p = medicationSchema.safeParse(raw);
    if (!p.success) return { ok: false, error: firstIssue(p.error) };
    const m = p.data;
    return {
      ok: true,
      row: {
        brand_name: m.brandName,
        generic_name: orNull(m.genericName),
        ingredient: orNull(m.ingredient?.toLowerCase()),
        strength: orNull(m.strength),
        dose: orNull(m.dose),
        frequency: orNull(m.frequency),
        timing: [...new Set(m.timing)].sort(),
        with_food: orNull(m.withFood),
        purpose: orNull(m.purpose),
        prescriber: orNull(m.prescriber),
        start_date: orNull(m.startDate),
        stop_date: orNull(m.stopDate),
        status: m.status,
      },
    };
  },
  allergies(raw) {
    const p = allergySchema.safeParse(raw);
    if (!p.success) return { ok: false, error: firstIssue(p.error) };
    const a = p.data;
    return { ok: true, row: { substance: a.substance, reaction: orNull(a.reaction), severity: a.severity } };
  },
};

const TABLE: Record<VaultKind, CareTable> = { conditions: "conditions", medications: "medications", allergies: "allergies" };

export type VaultView = {
  patient: Row | null;
  conditions: Row[];
  medications: Row[];
  allergies: Row[];
  /** display_name by user id, for "Approved by Anita" and "Verified by Dr Rao". */
  names: Record<string, string>;
};

export async function loadVault(db: Db, ctx: CareCtx): Promise<VaultView> {
  const patient = await currentPatient(db, ctx);
  if (!patient) return { patient: null, conditions: [], medications: [], allergies: [], names: {} };
  const where = { household_id: ctx.householdId, patient_id: patient.id };
  const [conditions, medications, allergies, users] = await Promise.all([
    db.select("conditions", where, { column: "created_at" }),
    db.select("medications", where, { column: "created_at" }),
    db.select("allergies", where, { column: "created_at" }),
    db.select("users", { household_id: ctx.householdId }),
  ]);
  const names = Object.fromEntries(users.map((u) => [String(u.id), String(u.display_name)]));
  return { patient, conditions, medications, allergies, names };
}

export async function createVaultEntry(kind: VaultKind, raw: unknown, db: Db, ctx: CareCtx): Promise<ServiceResult> {
  if (!canEditCare(ctx.role)) return FORBIDDEN;
  const mapped = MAPPERS[kind](raw);
  if (!mapped.ok) return { status: 400, body: { error: mapped.error } };
  return guarded(async () => {
    const patient = await currentPatient(db, ctx);
    if (!patient) return NO_PATIENT;
    const row = await db.insert(TABLE[kind], { ...mapped.row, household_id: ctx.householdId, patient_id: patient.id });
    return { status: 201, body: { id: row.id } };
  });
}

export type PlanReview = { itemId: string; itemTitle: string; medicineName: string } & MedicineChange;

/** Plan items whose linked medicine differs from what the plan last accepted. */
export async function reviewsForMedicine(db: Db, ctx: CareCtx, med: Row): Promise<PlanReview[]> {
  const items = await db.select("care_plan_items", { household_id: ctx.householdId, medication_id: med.id });
  const out: PlanReview[] = [];
  for (const item of items) {
    const change = medicineChange(item.medication_snapshot, med);
    if (change) out.push({ itemId: String(item.id), itemTitle: String(item.title), medicineName: String(med.brand_name), ...change });
  }
  return out;
}

export async function updateVaultEntry(kind: VaultKind, id: string, raw: unknown, db: Db, ctx: CareCtx): Promise<ServiceResult> {
  if (!canEditCare(ctx.role)) return FORBIDDEN;
  if (!uuid.safeParse(id).success) return NOT_FOUND;
  const mapped = MAPPERS[kind](raw);
  if (!mapped.ok) return { status: 400, body: { error: mapped.error } };
  return guarded(async () => {
    const rows = await db.update(TABLE[kind], { id, household_id: ctx.householdId }, mapped.row);
    if (rows.length === 0) return NOT_FOUND;
    // A medicine change never moves the plan by itself: return what needs a decision (CARE-6).
    const reviews = kind === "medications" ? await reviewsForMedicine(db, ctx, rows[0]) : [];
    return { status: 200, body: { reviews } };
  });
}

export async function deleteVaultEntry(kind: VaultKind, id: string, db: Db, ctx: CareCtx): Promise<ServiceResult> {
  if (!canEditCare(ctx.role)) return FORBIDDEN;
  if (!uuid.safeParse(id).success) return NOT_FOUND;
  return guarded(
    async () => {
      const n = await db.remove(TABLE[kind], { id, household_id: ctx.householdId });
      return n === 0 ? NOT_FOUND : { status: 200, body: { ok: true } };
    },
    (e) =>
      e.code === "23503"
        ? { status: 409, body: { error: "This medicine is in the care plan. Remove it from the plan first, or mark it stopped." } }
        : null,
  );
}

/** "Approve": a person in the household confirms the entry. Recorded as themselves. */
export async function approveMedicine(id: string, db: Db, ctx: CareCtx, now: () => Date = () => new Date()): Promise<ServiceResult> {
  if (!canApproveMedicine(ctx.role)) return FORBIDDEN;
  if (!uuid.safeParse(id).success) return NOT_FOUND;
  return guarded(
    async () => {
      const rows = await db.update("medications", { id, household_id: ctx.householdId }, { approved_by: ctx.userId, approved_at: now().toISOString() });
      return rows.length === 0 ? NOT_FOUND : { status: 200, body: { ok: true } };
    },
    (e) => (e.code === "P0001" ? FORBIDDEN : null),
  );
}

/** "Clinician verified": clinicians only. The database trigger enforces this too. */
export async function verifyMedicine(id: string, db: Db, ctx: CareCtx, now: () => Date = () => new Date()): Promise<ServiceResult> {
  if (!canVerifyMedicine(ctx.role)) return { status: 403, body: { error: "Only a clinician can verify a medicine." } };
  if (!uuid.safeParse(id).success) return NOT_FOUND;
  return guarded(
    async () => {
      const rows = await db.update("medications", { id, household_id: ctx.householdId }, { verified_by: ctx.userId, verified_at: now().toISOString() });
      return rows.length === 0 ? NOT_FOUND : { status: 200, body: { ok: true } };
    },
    (e) => (e.code === "P0001" ? { status: 403, body: { error: "Only a clinician can verify a medicine." } } : null),
  );
}
