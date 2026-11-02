// Request bodies for onboarding, Vault Lite and the care plan. Every route validates with these.
// z.object strips unknown keys: household_id, patient_id, verified_by and the like can never be set
// from a request body.
import { z } from "zod";

const text = (max: number, label = "This") => z.string().trim().max(max, `${label} is too long.`);
const optionalText = (max: number, label?: string) => text(max, label).optional().default("");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-02.")
  .refine((d) => !Number.isNaN(Date.parse(d)), "Use a real date.");
const optionalDate = z.union([date, z.literal("")]).optional().default("");
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 08:00.");

export const LANGUAGES = ["en", "hi", "kn"] as const;
export const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York"] as const;

// ---- Onboarding ----------------------------------------------------------------------------

const thisYear = new Date().getFullYear();

export const patientSchema = z.object({
  fullName: text(120, "Full name").min(1, "Enter their full name."),
  preferredName: text(60, "Preferred name").min(1, "Enter what they like to be called."),
  birthYear: z.coerce.number().int("Enter a year like 1946.").min(1900, "Enter a year like 1946.").max(thisYear, "Enter a year like 1946."),
  language: z.enum(LANGUAGES, "Choose a language."),
  timezone: z.enum(TIMEZONES, "Choose a time zone.").default("Asia/Kolkata"),
  conditions: z.array(text(200).min(1)).max(10, "Add up to 10 conditions here. You can add more in the vault.").default([]),
});

// Bump whenever the consent wording changes. b: added the browser speech recognition line (S4).
export const CONSENT_TEXT_VERSION = "draft-2026-11b";

export const consentSchema = z.object({
  basis: z.enum(["self", "guardian"], "Choose who is giving consent."),
  givenBy: text(120, "Name").min(1, "Enter the name of the person giving consent."),
  evidenceNote: text(1000, "The note").min(1, "Say how consent was given, for example: said yes at home on 2 November."),
  agreed: z.literal(true, "Confirm that consent was given."),
});

export const contactSchema = z.object({
  name: text(120, "Name").min(1, "Enter a name."),
  // Length and format are checked by normalizePhone(), which gives a clear message.
  phone: z.string().max(200),
  relationship: optionalText(60, "Relation"),
  channels: z.array(z.enum(["whatsapp", "call"])).min(1, "Choose at least one way to reach them.").max(2),
  whatsappAgreed: z.boolean().default(false),
});

export const contactsSchema = z.object({
  primary: contactSchema,
  secondary: contactSchema.optional(),
});

// ---- Vault -----------------------------------------------------------------------------------

export const conditionSchema = z.object({
  name: text(200, "Name").min(1, "Enter the condition."),
  since: optionalDate,
  treatingDoctor: optionalText(120, "Doctor"),
  notes: optionalText(1000, "Notes"),
});

export const medicationSchema = z
  .object({
    brandName: text(200, "Name").min(1, "Enter the name on the pack."),
    genericName: optionalText(200),
    ingredient: optionalText(200),
    strength: optionalText(60),
    dose: optionalText(60),
    frequency: optionalText(120),
    timing: z.array(timeOfDay).max(8, "Add up to 8 times.").default([]),
    withFood: z.enum(["before", "with", "after", "any", ""]).default(""),
    purpose: optionalText(200),
    prescriber: optionalText(120),
    startDate: optionalDate,
    stopDate: optionalDate,
    status: z.enum(["active", "stopped"]).default("active"),
  })
  .refine((m) => !m.startDate || !m.stopDate || m.stopDate >= m.startDate, {
    message: "The stop date cannot be before the start date.",
    path: ["stopDate"],
  });

export const allergySchema = z.object({
  substance: text(200, "Substance").min(1, "Enter what they are allergic to."),
  reaction: optionalText(300, "Reaction"),
  severity: z.enum(["mild", "moderate", "severe"]).default("moderate"),
});

export const VAULT_KINDS = ["conditions", "medications", "allergies"] as const;
export type VaultKind = (typeof VAULT_KINDS)[number];

// ---- Care plan -------------------------------------------------------------------------------

export const ITEM_TYPES = ["medication", "meal", "water", "exercise", "sleep", "appointment", "checkin_question", "reading"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const SEVERITIES = ["normal", "important", "critical"] as const;

const days = z
  .array(z.number().int().min(0).max(6))
  .min(1, "Choose at least one day.")
  .max(7)
  .refine((d) => new Set(d).size === d.length, "Each day once.");
const times = z.array(timeOfDay).min(1, "Add at least one time.").max(12, "Add up to 12 times.");

export const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("times"), times, days }),
  z
    .object({ kind: z.literal("interval"), everyMinutes: z.number().int().min(15).max(240), from: timeOfDay, to: timeOfDay, days })
    .refine((s) => s.from < s.to, { message: "The end time must be after the start time.", path: ["to"] }),
  z.object({ kind: z.literal("once"), date, times }),
]);
export type Schedule = z.infer<typeof scheduleSchema>;

export const MEDICATION_LINK_REQUIRED = "Choose a medicine from the vault for this item.";

export const planItemSchema = z
  .object({
    itemType: z.enum(ITEM_TYPES),
    title: text(120, "Title").min(1, "Enter a short title."),
    severity: z.enum(SEVERITIES).default("normal"),
    details: optionalText(500, "Details"),
    schedule: scheduleSchema,
    medicationId: z.uuid().optional(),
  })
  .superRefine((item, ctx) => {
    if (item.itemType === "medication" && !item.medicationId) {
      ctx.addIssue({ code: "custom", message: MEDICATION_LINK_REQUIRED, path: ["medicationId"] });
    }
    if (item.itemType !== "medication" && item.medicationId) {
      ctx.addIssue({ code: "custom", message: "Only medicine items link to the vault.", path: ["medicationId"] });
    }
    if (item.schedule.kind === "interval" && item.itemType !== "water") {
      ctx.addIssue({ code: "custom", message: "Repeating every few minutes is only for water.", path: ["schedule"] });
    }
  });

export const presetSchema = z.object({ preset: z.enum(["dementia", "diabetes", "post_surgery"]) });
export const reviewSchema = z.object({ decision: z.enum(["apply", "keep"]) });

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}
