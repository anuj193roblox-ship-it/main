// Patient check-in (PAT-2 to PAT-10). Code decides, the model only talks:
//   1. red-flag words are checked BEFORE any model call; a match skips the model entirely
//   2. a clear "yes" to the reminder on screen confirms it in code (the model is never asked)
//   3. otherwise the model writes a reply as JSON, which is validated, then checked again in code
//   4. intents (refuse, unclear twice) and the model's escalate flag become alerts in code
// Only transcript text is stored. Audio is never received, stored or logged.
import { z } from "zod";
import { checkLimits, type RateLimiter, rateKey } from "@/lib/auth/rate-limit";
import type { ServiceResult } from "@/lib/auth/services/result";
import { hhmm, str } from "@/lib/care/context";
import type { Db, Row } from "@/lib/care/db";
import { isClearAffirmative } from "../affirmatives";
import type { DeviceContext } from "../device";
import { type ModelClient, type ModelReply, modelReplySchema } from "../model";
import { checkReply } from "../output-guard";
import { buildUserContent, type PromptContext, SYSTEM_PROMPT } from "../prompt";
import { detectRedFlag } from "../red-flags";
import { capReachedLine, confirmedLine, fallbackLine, redFlagLine, refusalLine, unsafeReplacementLine, yesNoLine } from "../scripts";
import { localParts, toMillis } from "../time";
import { markTaken } from "./reminders";

export const MAX_PATIENT_TEXT = 500;
export const CHECKIN_DEVICE_RULE = { limit: 30, windowSeconds: 5 * 60 };

export const checkinSchema = z.object({
  text: z.string().trim().min(1, "Say or type something first.").max(MAX_PATIENT_TEXT, "That is a lot at once. Shall we take it bit by bit?"),
  source: z.enum(["voice", "typed"]).default("typed"),
  reminderId: z.uuid().optional(),
});

export type CheckinDeps = {
  db: Db;
  model: ModelClient;
  limiter: RateLimiter;
  /** Model calls per patient per 24 hours (CHECKIN_DAILY_MODEL_CAP, default 300). */
  dailyCap: number;
  /** false until Stage S6 sends WhatsApp alerts: the red-flag line must not claim anyone is told. */
  alertsDeliveryEnabled: boolean;
  now?: () => Date;
};

export type CheckinBody = {
  say: string;
  intent: ModelReply["intent"];
  mood: ModelReply["mood"] | null;
  redFlag: boolean;
  reminderConfirmed: boolean;
  offerYesNo: boolean;
  callContact: { name: string; phone: string } | null;
};

type Alert = { severity: "warning" | "urgent"; kind: string; summary: string };

// Alert summaries go to the family later (S6). They never contain the patient's words.
const ALERTS: Record<string, Alert> = {
  red_flag: { severity: "urgent", kind: "red_flag", summary: "Words that may mean an emergency were heard during a check-in." },
  model_fallback: { severity: "warning", kind: "model_fallback", summary: "Nurra could not form a reply and used a safe standard answer." },
  refusal: { severity: "warning", kind: "refusal", summary: "A reminder or suggestion was refused during a check-in." },
  unclear: { severity: "warning", kind: "unclear_speech", summary: "Nurra could not understand two replies in a row." },
  needs_attention: { severity: "warning", kind: "needs_attention", summary: "Nurra noticed something the family may want to check on." },
  blocked_reply: { severity: "warning", kind: "unsafe_reply_blocked", summary: "A reply about medicines or health was replaced with a safe standard answer." },
};

async function getOrCreateConversation(db: Db, device: DeviceContext, timezone: string, now: Date): Promise<Row> {
  const where = { patient_id: device.patientId, household_id: device.householdId };
  const today = localParts(now, timezone).isoDate;
  const existing = (await db.select("conversations", where, { column: "started_at", ascending: false }))[0];
  if (existing && localParts(new Date(toMillis(existing.started_at)), timezone).isoDate === today) return existing;
  return db.insert("conversations", { ...where, started_at: now.toISOString() });
}

/** Today's plan for the model: titles and times only; medicine items say "Medicines", never a name or dose. */
function todaysPlan(items: Row[], weekday: number, isoDate: string): { plan: PromptContext["plan"]; facts: string[] } {
  const plan: PromptContext["plan"] = [];
  const facts: string[] = [];
  for (const i of items) {
    if (i.active === false || i.is_placeholder === true) continue;
    const title = i.item_type === "medication" ? "Medicines" : str(i.title);
    const days = Array.isArray(i.days_of_week) ? (i.days_of_week as number[]) : [0, 1, 2, 3, 4, 5, 6];
    const times = Array.isArray(i.times_of_day) ? (i.times_of_day as string[]).map(hhmm) : [];
    if (i.schedule_kind === "once") {
      if (str(i.on_date).slice(0, 10) === isoDate) for (const t of times) plan.push({ time: t, title });
    } else if (i.schedule_kind === "interval") {
      if (days.includes(weekday)) plan.push({ time: hhmm(i.window_start), title: `${title}, every ${i.interval_minutes} minutes until ${hhmm(i.window_end)}` });
    } else if (days.includes(weekday)) {
      for (const t of times) plan.push({ time: t, title });
    }
    // Facts with an end date (PAT-3), e.g. "Anita is visiting on Saturday".
    if (i.expires_on && str(i.expires_on).slice(0, 10) >= isoDate && i.item_type !== "medication") facts.push(str(i.title));
  }
  plan.sort((a, b) => a.time.localeCompare(b.time));
  return { plan, facts };
}

export async function checkin(raw: unknown, device: DeviceContext, deps: CheckinDeps): Promise<ServiceResult> {
  if (!device.scopes.includes("checkin")) return { status: 403, body: { error: "This device cannot do that." } };
  const parsed = checkinSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: parsed.error.issues[0]?.message ?? "Say or type something first." } };
  const { text, source, reminderId } = parsed.data;
  const now = deps.now?.() ?? new Date();
  const { db } = deps;

  try {
    const limit = await checkLimits(deps.limiter, [{ key: await rateKey("checkin:device", device.deviceId), rule: CHECKIN_DEVICE_RULE }]);
    if (!limit.allowed) return { status: 429, body: { error: "Let us take a short pause and talk again in a minute." }, headers: { "Retry-After": String(limit.retryAfterSeconds) } };
  } catch {
    return { status: 503, body: { error: "I am having trouble right now. Let us try again in a moment." } };
  }

  const where = { household_id: device.householdId, patient_id: device.patientId };
  const [patient] = await db.select("patients", { id: device.patientId, household_id: device.householdId });
  if (!patient) return { status: 404, body: { error: "This device is not set up for anyone yet." } };
  const name = str(patient.preferred_name) || "friend";
  const timezone = str(patient.timezone) || "Asia/Kolkata";
  await db.update("patients", { id: device.patientId, household_id: device.householdId }, { last_seen_at: now.toISOString() });

  const conversation = await getOrCreateConversation(db, device, timezone, now);
  const history = await db.select("messages", { household_id: device.householdId, conversation_id: conversation.id }, { column: "created_at" });
  await db.insert("messages", { household_id: device.householdId, conversation_id: conversation.id, role: "patient", content: text, meta: { source } });

  const contacts = await db.select("contacts", where);
  const primary = contacts.find((c) => c.priority === "primary");
  const callContact = primary?.phone ? { name: str(primary.name), phone: str(primary.phone) } : null;

  const reminder = reminderId ? ((await db.select("reminders", { ...where, id: reminderId }))[0] ?? null) : null;
  let reminderTitle: string | null = null;
  let reminderItemType = "";
  if (reminder?.care_plan_item_id) {
    const [item] = await db.select("care_plan_items", { household_id: device.householdId, id: reminder.care_plan_item_id });
    reminderTitle = item ? str(item.title) : null;
    reminderItemType = item ? str(item.item_type) : "";
  }

  const alertsMade: string[] = [];
  const alert = async (key: keyof typeof ALERTS) => {
    if (alertsMade.includes(key)) return;
    alertsMade.push(key);
    const a = ALERTS[key];
    await db.insert("alerts", { ...where, reminder_id: reminder?.id ?? null, severity: a.severity, kind: a.kind, summary: a.summary, status: "open" });
  };

  const respond = async (body: Omit<CheckinBody, "callContact"> & { callContact?: CheckinBody["callContact"] }, meta: Record<string, unknown>) => {
    await db.insert("messages", {
      household_id: device.householdId,
      conversation_id: conversation.id,
      role: "nurra",
      content: body.say,
      mood: body.mood,
      meta: { intent: body.intent, mood: body.mood, escalate: meta.escalate ?? false, ...meta },
    });
    const full: CheckinBody = { ...body, callContact: body.callContact ?? null };
    return { status: 200, body: full };
  };

  // 1. Red flags: before the model, and instead of it.
  const flag = detectRedFlag(text);
  if (flag.matched) {
    await alert("red_flag");
    await db.insert("events", { ...where, kind: "red_flag", severity: "urgent", payload: { category: flag.id } });
    return respond(
      { say: redFlagLine(callContact?.name ?? null, deps.alertsDeliveryEnabled), intent: "report_symptom", mood: null, redFlag: true, reminderConfirmed: false, offerYesNo: false, callContact },
      { escalate: true, redFlag: flag.id, model: false },
    );
  }

  // 2. A clear "yes" to the reminder on screen: code confirms, no model needed.
  if (reminder && isClearAffirmative(text)) {
    const confirmed = await markTaken(db, device, reminder, "voice", now);
    if (confirmed) {
      return respond({ say: confirmedLine(name), intent: "confirm_taken", mood: "ok", redFlag: false, reminderConfirmed: true, offerYesNo: false }, { model: false });
    }
  }

  // 3. Daily cap on model calls, to protect credits.
  try {
    const cap = await deps.limiter.hit(await rateKey("model:patient", device.patientId), { limit: deps.dailyCap, windowSeconds: 24 * 60 * 60 });
    if (!cap.allowed) {
      return respond({ say: capReachedLine(name), intent: "chitchat", mood: null, redFlag: false, reminderConfirmed: false, offerYesNo: false }, { model: false, capReached: true });
    }
  } catch {
    return respond({ say: fallbackLine(name), intent: "unclear", mood: null, redFlag: false, reminderConfirmed: false, offerYesNo: false }, { model: false, fallback: "limiter" });
  }

  // 4. The model: only what the reply needs.
  const local = localParts(now, timezone);
  const items = await db.select("care_plan_items", where);
  const { plan, facts } = todaysPlan(items, local.weekday, local.isoDate);
  const recent = history.slice(-6).map((m) => ({ role: (m.role === "patient" ? "patient" : "nurra") as "patient" | "nurra", text: str(m.content) }));
  const user = buildUserContent({
    preferredName: name,
    localDateTime: local.label,
    plan,
    facts,
    reminder: reminder ? { title: reminderItemType === "medication" ? "Medicines" : (reminderTitle ?? "Reminder"), time: localParts(new Date(toMillis(reminder.due_at)), timezone).hhmm } : null,
    recent,
    patientSaid: text,
  });

  let reply: ModelReply | null = null;
  try {
    const result = modelReplySchema.safeParse(await deps.model.reply({ system: SYSTEM_PROMPT, user }));
    if (result.success) reply = result.data;
  } catch {
    reply = null;
  }
  if (!reply) {
    await alert("model_fallback");
    return respond({ say: fallbackLine(name), intent: "unclear", mood: null, redFlag: false, reminderConfirmed: false, offerYesNo: false }, { model: true, fallback: "invalid_or_failed" });
  }

  // 5. Check the reply in code. The model's reminder_confirmed is advisory and never confirms anything.
  let say = reply.say;
  const meta: Record<string, unknown> = { model: true, escalate: reply.escalate, modelSaidConfirmed: reply.reminder_confirmed };
  const guard = checkReply(say);
  if (!guard.ok) {
    say = unsafeReplacementLine(name, guard.category);
    meta.outputBlocked = guard.category;
    await alert("blocked_reply");
  }

  let offerYesNo = false;
  if (reply.intent === "refuse") {
    // Logged, not pushed: the reminder is marked refused so the card does not keep coming back.
    await alert("refusal");
    if (reminder && reminder.status !== "confirmed") await db.update("reminders", { ...where, id: reminder.id }, { status: "refused" });
    if (!guard.ok) say = refusalLine(name);
  } else if (reply.intent === "unclear") {
    // The second unclear reply in a row: offer a yes or no question, and tell the family.
    const lastNurra = [...history].reverse().find((m) => m.role === "nurra");
    const lastMeta = (lastNurra?.meta ?? {}) as Record<string, unknown>;
    if (lastMeta.intent === "unclear" && !lastMeta.offeredYesNo) {
      say = yesNoLine(name, reminder ? (reminderItemType === "medication" ? "medicines" : reminderTitle) : null);
      offerYesNo = true;
      meta.offeredYesNo = true;
      await alert("unclear");
    }
  }
  if (reply.escalate) await alert("needs_attention");

  return respond({ say, intent: reply.intent, mood: reply.mood, redFlag: false, reminderConfirmed: false, offerYesNo }, meta);
}
