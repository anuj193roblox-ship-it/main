// Reminder card and confirmation (PAT-4, REM-6). Code decides: a dose counts as taken only after a
// tap or an exact clear affirmative. Confirming twice changes nothing. A confirmed reminder is
// never shown again.
import { z } from "zod";
import type { ServiceResult } from "@/lib/auth/services/result";
import { str } from "@/lib/care/context";
import type { Db, Row } from "@/lib/care/db";
import { advanceReminder, confirmReminder } from "@/lib/reminders/engine";
import { isClearAffirmative } from "../affirmatives";
import type { DeviceContext } from "../device";
import { confirmedLine, notYetLine, promptLine, repromptLine } from "../scripts";
import { toMillis } from "../time";

const OPEN = new Set(["scheduled", "prompted", "escalating", "refused"]);
const NOT_PAIRED: ServiceResult = { status: 403, body: { error: "This device cannot do that." } };
const NO_REMINDER: ServiceResult = { status: 404, body: { error: "That reminder is no longer here." } };

export const answerSchema = z.object({
  answer: z.enum(["taken", "not_yet"]),
  source: z.enum(["tap", "voice"]).default("tap"),
  transcript: z.string().max(500).optional(),
});

async function reminderFor(db: Db, device: DeviceContext, id: string): Promise<Row | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db.select("reminders", { id, patient_id: device.patientId, household_id: device.householdId });
  return row ?? null;
}

async function preferredName(db: Db, device: DeviceContext): Promise<string> {
  const [p] = await db.select("patients", { id: device.patientId, household_id: device.householdId });
  return str(p?.preferred_name) || "friend";
}

/**
 * Marks a reminder taken by the patient. Idempotent. Returns whether it is (now) confirmed.
 * Goes through confirm_reminder, which locks the row: a confirmation racing a tick always wins, stops
 * every later step, and queues a "resolved" alert if the family was already told (REM-5).
 */
export async function markTaken(db: Db, device: DeviceContext, reminder: Row, source: "tap" | "voice", now: Date): Promise<boolean> {
  if (reminder.status === "confirmed") return true;
  if (!OPEN.has(String(reminder.status))) return false;
  const outcome = await confirmReminder(db, {
    reminderId: String(reminder.id),
    patientId: device.patientId,
    householdId: device.householdId,
    by: "patient",
    userId: null,
    source,
    now,
  });
  return outcome === "confirmed" || outcome === "already";
}

export async function answerReminder(id: string, raw: unknown, db: Db, device: DeviceContext, now: Date = new Date()): Promise<ServiceResult> {
  if (!device.scopes.includes("confirm")) return NOT_PAIRED;
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: "That answer was not clear." } };
  const reminder = await reminderFor(db, device, id);
  if (!reminder) return NO_REMINDER;
  const name = await preferredName(db, device);

  if (parsed.data.answer === "not_yet") {
    if (reminder.status === "confirmed") return { status: 200, body: { confirmed: true, alreadyConfirmed: true, say: confirmedLine(name) } };
    await db.insert("events", {
      household_id: device.householdId,
      patient_id: device.patientId,
      kind: "dose_not_yet",
      severity: "info",
      payload: { reminder_id: reminder.id },
    });
    return { status: 200, body: { confirmed: false, say: notYetLine(name) } };
  }

  // Spoken "taken" counts only for an exact clear affirmative. "Maybe" stays unconfirmed.
  if (parsed.data.source === "voice" && !isClearAffirmative(parsed.data.transcript ?? "")) {
    return { status: 200, body: { confirmed: false, say: `I did not hear a clear yes, ${name}. You can tap "Yes, I took them".` } };
  }
  const already = reminder.status === "confirmed";
  const ok = await markTaken(db, device, reminder, parsed.data.source, now);
  return ok
    ? { status: 200, body: { confirmed: true, alreadyConfirmed: already, say: confirmedLine(name) } }
    : { status: 409, body: { error: "This reminder can no longer be confirmed here." } };
}

export type DueReminder = { id: string; title: string; dueTime: string; stage: "prompt" | "reprompt" };

/** Shown on the patient screen: prompted by step 0, or escalating after the re-prompt (REM-3). */
const SHOWN = new Set(["prompted", "escalating"]);

/** The oldest reminder the engine has prompted. Confirmed, missed and resolved reminders never come back. */
export async function dueReminder(db: Db, device: DeviceContext, now: Date): Promise<(DueReminder & { itemType: string }) | null> {
  const rows = await db.select("reminders", { patient_id: device.patientId, household_id: device.householdId }, { column: "due_at" });
  const open = rows.find((r) => SHOWN.has(String(r.status)) && toMillis(r.due_at) <= now.getTime());
  if (!open) return null;
  let title = "Your reminder";
  let itemType = "";
  if (open.care_plan_item_id) {
    const [item] = await db.select("care_plan_items", { id: open.care_plan_item_id, household_id: device.householdId });
    if (item) {
      title = str(item.title);
      itemType = str(item.item_type);
    }
  }
  return { id: str(open.id), title, itemType, dueTime: str(open.due_at), stage: open.status === "escalating" ? "reprompt" : "prompt" };
}

export type CurrentReminder = DueReminder & { say: string };

/** GET /api/patient/current: this device's patient only. The screen speaks `say` once per id and stage. */
export async function currentReminder(db: Db, device: DeviceContext, now: Date = new Date()): Promise<ServiceResult> {
  const due = await dueReminder(db, device, now);
  if (!due) return { status: 200, body: { reminder: null } };
  const name = await preferredName(db, device);
  const say = due.stage === "prompt" ? promptLine(name, due.title, due.itemType) : repromptLine(name);
  const reminder: CurrentReminder = { id: due.id, title: due.title, dueTime: due.dueTime, stage: due.stage, say };
  return { status: 200, body: { reminder } };
}

/**
 * Demo only (NEXT_PUBLIC_DEMO_MODE): a reminder due now from the first plan item. It runs through the
 * real state machine: created as scheduled, then step 0 is applied by the engine at once, and the tick
 * does the rest (with DEMO_FAST_TIMERS, minutes are seconds).
 */
export async function createDemoReminder(db: Db, device: DeviceContext, demoMode: boolean, now: Date = new Date(), unitMs = 60_000): Promise<ServiceResult> {
  if (!demoMode) return { status: 404, body: { error: "Not available." } };
  const items = await db.select("care_plan_items", { patient_id: device.patientId, household_id: device.householdId, active: true }, { column: "created_at" });
  const first = items
    .filter((i) => i.is_placeholder !== true)
    .sort((a, b) => String((a.times_of_day as string[] | undefined)?.[0] ?? a.window_start ?? "99").localeCompare(String((b.times_of_day as string[] | undefined)?.[0] ?? b.window_start ?? "99")))[0];
  if (!first) return { status: 409, body: { error: "Add an item to the care plan first." } };
  const due = now.toISOString();
  const row = await db.insert("reminders", {
    household_id: device.householdId,
    patient_id: device.patientId,
    care_plan_item_id: first.id,
    due_at: due,
    status: "scheduled",
    next_action_at: due,
  });
  await advanceReminder(db, row, now, unitMs);
  return { status: 201, body: { id: row.id } };
}
