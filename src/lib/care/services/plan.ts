// Care plan builder (CARE-1, 2, 3, 5, 6). Stores the plan only: no reminders are generated here.
import type { ServiceResult } from "@/lib/auth/services/result";
import { z } from "zod";
import { canEditCare, type CareCtx, currentPatient, FORBIDDEN, guarded, hhmm, NO_PATIENT, NOT_FOUND, orNull } from "../context";
import type { Db, Row } from "../db";
import { medicineChange, snapshotOf } from "../medicine-change";
import { type PresetKey, PRESETS } from "../presets";
import { firstIssue, MEDICATION_LINK_REQUIRED, planItemSchema, presetSchema, reviewSchema, type Schedule } from "../schemas";
import type { PlanReview } from "./vault";

const uuid = z.uuid();

export const PLAN_HAS_ITEMS = "This plan already has items. Presets are for an empty plan.";

/** Schedule from the form to database columns. */
export function scheduleColumns(s: Schedule): Row {
  if (s.kind === "times") {
    return { schedule_kind: "times", times_of_day: [...new Set(s.times)].sort(), days_of_week: [...s.days].sort(), interval_minutes: null, window_start: null, window_end: null, on_date: null };
  }
  if (s.kind === "interval") {
    return { schedule_kind: "interval", times_of_day: [], days_of_week: [...s.days].sort(), interval_minutes: s.everyMinutes, window_start: s.from, window_end: s.to, on_date: null };
  }
  return { schedule_kind: "once", times_of_day: [...new Set(s.times)].sort(), on_date: s.date, interval_minutes: null, window_start: null, window_end: null };
}

/** Database row back to the form's schedule. */
export function scheduleOf(item: Row): Schedule {
  const days = Array.isArray(item.days_of_week) ? (item.days_of_week as number[]) : [0, 1, 2, 3, 4, 5, 6];
  const times = Array.isArray(item.times_of_day) ? (item.times_of_day as string[]).map(hhmm) : [];
  if (item.schedule_kind === "interval") {
    return { kind: "interval", everyMinutes: Number(item.interval_minutes), from: hhmm(item.window_start), to: hhmm(item.window_end), days };
  }
  if (item.schedule_kind === "once") return { kind: "once", date: String(item.on_date).slice(0, 10), times };
  return { kind: "times", times, days };
}

export type PlanView = {
  patient: Row | null;
  plan: Row | null;
  items: Row[];
  medicines: Row[];
  reviews: PlanReview[];
};

async function ensurePlan(db: Db, ctx: CareCtx, patient: Row, preset: PresetKey | null): Promise<Row> {
  const plans = await db.select("care_plans", { household_id: ctx.householdId, patient_id: patient.id }, { column: "created_at" });
  if (plans[0]) return plans[0];
  return db.insert("care_plans", {
    household_id: ctx.householdId,
    patient_id: patient.id,
    name: preset ? PRESETS[preset].name : "Daily plan",
    preset,
  });
}

export async function loadPlan(db: Db, ctx: CareCtx): Promise<PlanView> {
  const patient = await currentPatient(db, ctx);
  if (!patient) return { patient: null, plan: null, items: [], medicines: [], reviews: [] };
  const where = { household_id: ctx.householdId, patient_id: patient.id };
  const [plans, items, medicines] = await Promise.all([
    db.select("care_plans", where, { column: "created_at" }),
    db.select("care_plan_items", where, { column: "created_at" }),
    db.select("medications", where, { column: "brand_name" }),
  ]);
  const byId = new Map(medicines.map((m) => [m.id, m]));
  const reviews: PlanReview[] = [];
  for (const item of items) {
    const med = item.medication_id ? byId.get(item.medication_id) : undefined;
    const change = med ? medicineChange(item.medication_snapshot, med) : null;
    if (med && change) reviews.push({ itemId: String(item.id), itemTitle: String(item.title), medicineName: String(med.brand_name), ...change });
  }
  return { patient, plan: plans[0] ?? null, items, medicines, reviews };
}

/** Presets fill an empty plan. Medication slots arrive as inactive placeholders to be linked. */
export async function applyPreset(raw: unknown, db: Db, ctx: CareCtx): Promise<ServiceResult> {
  if (!canEditCare(ctx.role)) return FORBIDDEN;
  const parsed = presetSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: "Choose a preset." } };
  return guarded(async () => {
    const patient = await currentPatient(db, ctx);
    if (!patient) return NO_PATIENT;
    const plan = await ensurePlan(db, ctx, patient, parsed.data.preset);
    const existing = await db.select("care_plan_items", { household_id: ctx.householdId, care_plan_id: plan.id });
    if (existing.length > 0) return { status: 409, body: { error: PLAN_HAS_ITEMS } };

    for (const item of PRESETS[parsed.data.preset].items) {
      await db.insert("care_plan_items", {
        household_id: ctx.householdId,
        patient_id: patient.id,
        care_plan_id: plan.id,
        item_type: item.itemType,
        title: item.title,
        severity: item.severity,
        ...scheduleColumns(item.schedule),
        is_placeholder: item.placeholder === true,
        active: item.placeholder !== true,
        medication_id: null,
      });
    }
    return { status: 201, body: { ok: true } };
  });
}

/** Checks that the medicine exists in this household, for this patient. */
async function linkedMedicine(db: Db, ctx: CareCtx, patient: Row, medicationId: string | undefined): Promise<Row | null> {
  if (!medicationId) return null;
  const rows = await db.select("medications", { id: medicationId, household_id: ctx.householdId, patient_id: patient.id });
  return rows[0] ?? null;
}

function itemColumns(item: ReturnType<typeof planItemSchema.parse>, med: Row | null): Row {
  return {
    item_type: item.itemType,
    title: item.title,
    severity: item.severity,
    details: orNull(item.details),
    ...scheduleColumns(item.schedule),
    medication_id: med ? med.id : null,
    // Linking a medicine records what the plan agreed to; later vault edits are compared with this.
    medication_snapshot: med ? snapshotOf(med) : null,
    is_placeholder: false,
    active: true,
  };
}

export async function createPlanItem(raw: unknown, db: Db, ctx: CareCtx): Promise<ServiceResult> {
  if (!canEditCare(ctx.role)) return FORBIDDEN;
  const parsed = planItemSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: firstIssue(parsed.error) } };
  return guarded(async () => {
    const patient = await currentPatient(db, ctx);
    if (!patient) return NO_PATIENT;
    const med = await linkedMedicine(db, ctx, patient, parsed.data.medicationId);
    if (parsed.data.itemType === "medication" && !med) return { status: 400, body: { error: MEDICATION_LINK_REQUIRED } };
    const plan = await ensurePlan(db, ctx, patient, null);
    const row = await db.insert("care_plan_items", {
      ...itemColumns(parsed.data, med),
      household_id: ctx.householdId,
      patient_id: patient.id,
      care_plan_id: plan.id,
    });
    return { status: 201, body: { id: row.id } };
  });
}

export async function updatePlanItem(id: string, raw: unknown, db: Db, ctx: CareCtx): Promise<ServiceResult> {
  if (!canEditCare(ctx.role)) return FORBIDDEN;
  if (!uuid.safeParse(id).success) return NOT_FOUND;
  const parsed = planItemSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: firstIssue(parsed.error) } };
  return guarded(async () => {
    const [item] = await db.select("care_plan_items", { id, household_id: ctx.householdId });
    if (!item) return NOT_FOUND;
    const [patient] = await db.select("patients", { id: item.patient_id, household_id: ctx.householdId });
    if (!patient) return NOT_FOUND;
    const med = await linkedMedicine(db, ctx, patient, parsed.data.medicationId);
    if (parsed.data.itemType === "medication" && !med) return { status: 400, body: { error: MEDICATION_LINK_REQUIRED } };
    const rows = await db.update("care_plan_items", { id, household_id: ctx.householdId }, itemColumns(parsed.data, med));
    return rows.length === 0 ? NOT_FOUND : { status: 200, body: { ok: true } };
  });
}

export async function deletePlanItem(id: string, db: Db, ctx: CareCtx): Promise<ServiceResult> {
  if (!canEditCare(ctx.role)) return FORBIDDEN;
  if (!uuid.safeParse(id).success) return NOT_FOUND;
  return guarded(async () => {
    const n = await db.remove("care_plan_items", { id, household_id: ctx.householdId });
    return n === 0 ? NOT_FOUND : { status: 200, body: { ok: true } };
  });
}

/**
 * "Apply this change to the reminders?" A person chooses:
 *   apply: the item takes the medicine's new times (and stops if the medicine stopped)
 *   keep:  the item stays as it is; the change is noted as seen
 * Either way the decision is explicit and audited. Nothing happens without it.
 */
export async function decideReview(itemId: string, raw: unknown, db: Db, ctx: CareCtx): Promise<ServiceResult> {
  if (!canEditCare(ctx.role)) return FORBIDDEN;
  if (!uuid.safeParse(itemId).success) return NOT_FOUND;
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: "Choose apply or keep." } };
  return guarded(async () => {
    const [item] = await db.select("care_plan_items", { id: itemId, household_id: ctx.householdId });
    if (!item || !item.medication_id) return NOT_FOUND;
    const [med] = await db.select("medications", { id: item.medication_id, household_id: ctx.householdId });
    if (!med) return NOT_FOUND;
    const change = medicineChange(item.medication_snapshot, med);
    if (!change) return { status: 409, body: { error: "There is no change to review." } };

    const patch: Row = { medication_snapshot: change.current };
    if (parsed.data.decision === "apply") {
      if (change.proposal.times) {
        patch.times_of_day = change.proposal.times;
        if (item.schedule_kind !== "times") Object.assign(patch, { schedule_kind: "times", on_date: null });
      }
      if (change.proposal.deactivate) patch.active = false;
    }
    await db.update("care_plan_items", { id: itemId, household_id: ctx.householdId }, patch);
    return { status: 200, body: { ok: true } };
  });
}
