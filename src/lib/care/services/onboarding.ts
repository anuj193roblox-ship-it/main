// Onboarding (ONB-1, 2, 3, 5): add the person, record consent, add contacts, review and activate.
import type { ServiceResult } from "@/lib/auth/services/result";
import { canOnboard, type CareCtx, draftPatient, FORBIDDEN, guarded, NO_PATIENT, orNull, str } from "../context";
import type { Db, Row } from "../db";
import { normalizePhone } from "../phone";
import { CONSENT_TEXT_VERSION, consentSchema, contactSchema, contactsSchema, firstIssue, patientSchema } from "../schemas";

export const NEEDS_CONSENT = "Nurra cannot be turned on yet: record consent first.";
export const NEEDS_PRIMARY_CONTACT = "Nurra cannot be turned on yet: add a primary contact with a phone number.";

export type OnboardingState = {
  patient: Row | null;
  conditions: Row[];
  consent: Row | null;
  contacts: Row[];
};

export async function loadOnboarding(db: Db, ctx: CareCtx): Promise<OnboardingState> {
  const patient = await draftPatient(db, ctx);
  if (!patient) return { patient: null, conditions: [], consent: null, contacts: [] };
  const where = { household_id: ctx.householdId, patient_id: patient.id };
  const [conditions, consents, contacts] = await Promise.all([
    db.select("conditions", where, { column: "created_at" }),
    db.select("consents", where, { column: "given_at", ascending: false }),
    db.select("contacts", where),
  ]);
  return { patient, conditions, consent: consents.find((c) => !c.revoked_at) ?? null, contacts };
}

/** Step 1: the person. Creates the draft, or updates it if one is in progress. */
export async function savePatient(raw: unknown, db: Db, ctx: CareCtx): Promise<ServiceResult> {
  if (!canOnboard(ctx.role)) return FORBIDDEN;
  const parsed = patientSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: firstIssue(parsed.error) } };
  const p = parsed.data;

  return guarded(async () => {
    const fields = {
      full_name: p.fullName,
      preferred_name: p.preferredName,
      birth_year: p.birthYear,
      language: p.language,
      timezone: p.timezone,
    };
    const existing = await draftPatient(db, ctx);
    const patient = existing
      ? (await db.update("patients", { id: existing.id, household_id: ctx.householdId }, fields))[0]
      : await db.insert("patients", { ...fields, household_id: ctx.householdId, status: "draft" });
    if (!patient) return NO_PATIENT;

    // Conditions in scope: add the new ones, keep the ones already in the vault.
    const known = new Set(
      (await db.select("conditions", { household_id: ctx.householdId, patient_id: patient.id })).map((c) => str(c.name).toLowerCase()),
    );
    for (const name of p.conditions) {
      if (known.has(name.toLowerCase())) continue;
      known.add(name.toLowerCase());
      await db.insert("conditions", { household_id: ctx.householdId, patient_id: patient.id, name });
    }
    return { status: 200, body: { next: "/onboarding/consent" } };
  });
}

/** Step 2: consent, self or guardian. Stored with who gave it, an evidence note and the text version. */
export async function saveConsent(raw: unknown, db: Db, ctx: CareCtx): Promise<ServiceResult> {
  if (!canOnboard(ctx.role)) return FORBIDDEN;
  const parsed = consentSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: firstIssue(parsed.error) } };

  return guarded(async () => {
    const patient = await draftPatient(db, ctx);
    if (!patient) return NO_PATIENT;
    await db.insert("consents", {
      household_id: ctx.householdId,
      patient_id: patient.id,
      basis: parsed.data.basis,
      given_by: parsed.data.givenBy,
      evidence_note: parsed.data.evidenceNote,
      text_version: CONSENT_TEXT_VERSION,
    });
    return { status: 200, body: { next: "/onboarding/contacts" } };
  });
}

type ContactInput = ReturnType<typeof contactSchema.parse>;

/** Step 3: one primary and (optionally) one secondary contact. Phones are checked on the server. */
export async function saveContacts(raw: unknown, db: Db, ctx: CareCtx, now: () => Date = () => new Date()): Promise<ServiceResult> {
  if (!canOnboard(ctx.role)) return FORBIDDEN;
  const parsed = contactsSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: firstIssue(parsed.error) } };

  const phones: Record<string, string> = {};
  for (const [priority, c] of Object.entries(parsed.data) as [string, ContactInput | undefined][]) {
    if (!c) continue;
    const phone = normalizePhone(c.phone);
    if (!phone.ok) return { status: 400, body: { error: `${priority === "primary" ? "Primary" : "Secondary"} contact: ${phone.error}`, field: `${priority}.phone` } };
    phones[priority] = phone.e164;
  }

  return guarded(
    async () => {
      const patient = await draftPatient(db, ctx);
      if (!patient) return NO_PATIENT;
      const existing = await db.select("contacts", { household_id: ctx.householdId, patient_id: patient.id });

      for (const priority of ["primary", "secondary"] as const) {
        const input = parsed.data[priority];
        const current = existing.find((c) => c.priority === priority);
        if (!input) {
          if (current) await db.remove("contacts", { id: current.id, household_id: ctx.householdId });
          continue;
        }
        // Keep the original agreement time; record a new one only when the box is newly ticked.
        const optIn = input.whatsappAgreed ? (current?.whatsapp_opt_in_at ?? now().toISOString()) : null;
        const fields = {
          name: input.name,
          phone: phones[priority],
          relationship: orNull(input.relationship),
          channels: input.channels,
          whatsapp_opt_in_at: optIn,
        };
        if (current) await db.update("contacts", { id: current.id, household_id: ctx.householdId }, fields);
        else await db.insert("contacts", { ...fields, household_id: ctx.householdId, patient_id: patient.id, priority });
      }
      return { status: 200, body: { next: "/onboarding/review" } };
    },
    (e) => (e.code === "23514" ? { status: 400, body: { error: "Check the phone numbers and try again." } } : null),
  );
}

/** Step 4: activate. The database refuses without consent or a primary contact; we explain why. */
export async function activate(db: Db, ctx: CareCtx): Promise<ServiceResult> {
  if (!canOnboard(ctx.role)) return FORBIDDEN;
  return guarded(
    async () => {
      const patient = await draftPatient(db, ctx);
      if (!patient) return NO_PATIENT;
      const rows = await db.update("patients", { id: patient.id, household_id: ctx.householdId }, { status: "active" });
      if (rows.length === 0) return NO_PATIENT;
      return { status: 200, body: { next: "/app/today" } };
    },
    (e) => {
      if (e.message.includes("nurra_activation_needs_consent")) return { status: 409, body: { error: NEEDS_CONSENT, step: "/onboarding/consent" } };
      if (e.message.includes("nurra_activation_needs_primary_contact")) {
        return { status: 409, body: { error: NEEDS_PRIMARY_CONTACT, step: "/onboarding/contacts" } };
      }
      return null;
    },
  );
}
