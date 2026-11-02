import type { Role } from "@/lib/auth/access";
import type { ServiceResult } from "@/lib/auth/services/result";
import { type Db, DbError, type Row } from "./db";

/** Who is acting. Always from the verified session, never from the request body. */
export type CareCtx = { userId: string; householdId: string; role: Role };

/** Spec CARE-5: family and clinician edit; the household owner (admin) is family too. */
export const canEditCare = (role: Role) => role === "family" || role === "clinician" || role === "admin";
/** Adding a person and giving consent is for the family, not visiting clinicians. */
export const canOnboard = (role: Role) => role === "family" || role === "admin";
export const canApproveMedicine = canEditCare;
export const canVerifyMedicine = (role: Role) => role === "clinician";

export const NOT_FOUND: ServiceResult = { status: 404, body: { error: "That item no longer exists." } };
export const FORBIDDEN: ServiceResult = { status: 403, body: { error: "Your role cannot make this change." } };
export const NO_PATIENT: ServiceResult = { status: 409, body: { error: "Add the person you care for first." } };
export const SAVE_FAILED: ServiceResult = { status: 500, body: { error: "That could not be saved. Try again." } };

/**
 * The person this household is working on. One at a time until "Switch patient" exists:
 * the first active person, otherwise the newest draft.
 */
export async function currentPatient(db: Db, ctx: CareCtx): Promise<Row | null> {
  const rows = await db.select("patients", { household_id: ctx.householdId }, { column: "created_at" });
  return rows.find((r) => r.status === "active") ?? [...rows].reverse().find((r) => r.status === "draft") ?? null;
}

/** The household's draft being onboarded, if any. */
export async function draftPatient(db: Db, ctx: CareCtx): Promise<Row | null> {
  const rows = await db.select("patients", { household_id: ctx.householdId, status: "draft" }, { column: "created_at", ascending: false });
  return rows[0] ?? null;
}

/** Runs a database write and turns unexpected failures into a generic answer (no raw errors). */
export async function guarded(fn: () => Promise<ServiceResult>, map: (e: DbError) => ServiceResult | null = () => null): Promise<ServiceResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DbError) return map(e) ?? SAVE_FAILED;
    throw e;
  }
}

/** "08:00:00" or "8:00" -> "08:00". */
export function hhmm(value: unknown): string {
  const m = typeof value === "string" ? /^(\d{1,2}):(\d{2})/.exec(value) : null;
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

/** null-safe string from a row. */
export function str(value: unknown): string {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

/** Empty strings from forms become null in the database. */
export function orNull(value: string | undefined | null): string | null {
  return value && value.trim().length > 0 ? value.trim() : null;
}
