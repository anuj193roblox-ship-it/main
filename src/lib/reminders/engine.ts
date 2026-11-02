// The tick (REM-2): generate reminders, then move each due reminder one step along the ladder.
// Runs with the service-role Db. Every write goes through a database function that locks the
// reminder row and uses (reminder_id, step) as the idempotency key, so two ticks (in a row or at the
// same moment) can never make a duplicate step, alert or prompt. Returns counts only.
import { str } from "@/lib/care/context";
import type { Db, Row } from "@/lib/care/db";
import { localParts, toMillis } from "@/lib/patient/time";
import { parseEscalation, severityOf } from "./config";
import { decide, type DoneSteps } from "./schedule";

export type TickCounts = {
  generated: number;
  withdrawn: number;
  claimed: number;
  prompts: number;
  reprompts: number;
  familyAlerts: number;
  secondaryAlerts: number;
  failedSteps: number;
  missed: number;
  errors: number;
};

export function emptyCounts(): TickCounts {
  return { generated: 0, withdrawn: 0, claimed: 0, prompts: 0, reprompts: 0, familyAlerts: 0, secondaryAlerts: 0, failedSteps: 0, missed: 0, errors: 0 };
}

export type TickOptions = {
  now: Date;
  /** One configured minute in ms (1000 with fast demo timers). */
  unitMs: number;
  batchSize?: number;
  leaseSeconds?: number;
  maxBatches?: number;
  horizonHours?: number;
  lookbackMinutes?: number;
};

export async function runTick(db: Db, options: TickOptions): Promise<TickCounts> {
  const { now, unitMs, batchSize = 50, leaseSeconds = 30, maxBatches = 20, horizonHours = 24, lookbackMinutes = 10 } = options;
  const counts = emptyCounts();
  const iso = now.toISOString();

  const [gen] = await db.rpc("generate_reminders", { p_now: iso, p_horizon_hours: horizonHours, p_lookback_minutes: lookbackMinutes });
  counts.generated = Number(gen?.generated ?? 0);
  counts.withdrawn = Number(gen?.withdrawn ?? 0);

  for (let batch = 0; batch < maxBatches; batch++) {
    const claimed = await db.rpc("claim_due_reminders", { p_now: iso, p_limit: batchSize, p_lease_seconds: leaseSeconds });
    counts.claimed += claimed.length;
    for (const reminder of claimed) {
      try {
        await advanceReminder(db, reminder, now, unitMs, counts);
      } catch {
        // The lease runs out and a later tick tries again. Nothing about the row is logged.
        counts.errors += 1;
      }
    }
    if (claimed.length < batchSize) break;
  }
  return counts;
}

const FAMILY_KINDS = { 3: "reminder_not_confirmed", 4: "reminder_not_confirmed_secondary" } as const;

/** One step for one reminder (or a wait, or missed). Safe to call twice: the database decides. */
export async function advanceReminder(db: Db, reminder: Row, now: Date, unitMs: number, counts: TickCounts = emptyCounts()): Promise<TickCounts> {
  const household = str(reminder.household_id);
  const patientId = str(reminder.patient_id);
  const [item] = reminder.care_plan_item_id ? await db.select("care_plan_items", { id: reminder.care_plan_item_id, household_id: household }) : [];
  const [plan] = item ? await db.select("care_plans", { id: item.care_plan_id, household_id: household }) : [];
  const config = parseEscalation(plan?.escalation_config)[severityOf(item?.severity)];
  const steps = await db.select("escalation_steps", { reminder_id: reminder.id, household_id: household });
  const done: DoneSteps = new Map(steps.map((s) => [Number(s.step), toMillis(s.executed_at)]));
  const dueAt = toMillis(reminder.due_at);
  const decision = decide({ dueAt, done, config, unitMs, now: now.getTime() });

  const apply = async (args: {
    step: number | null;
    action?: string;
    stepStatus?: "done" | "failed" | "skipped";
    detail?: string;
    status: string | null;
    next: number | null;
    alert?: Row | null;
    event?: Row | null;
  }) => {
    const [row] = await db.rpc("apply_reminder_step", {
      p_reminder: reminder.id,
      p_step: args.step,
      p_action: args.action ?? null,
      p_step_status: args.stepStatus ?? null,
      p_detail: args.detail ?? null,
      p_reminder_status: args.status,
      p_next_action_at: args.next === null ? null : new Date(args.next).toISOString(),
      p_alert: args.alert ?? null,
      p_event: args.event ?? null,
      p_now: now.toISOString(),
    });
    return row?.applied === true;
  };

  if (decision.kind === "wait") {
    await apply({ step: null, status: null, next: decision.nextActionAt });
    return counts;
  }
  if (decision.kind === "missed") {
    const ok = await apply({
      step: null,
      status: "missed",
      next: null,
      event: { kind: "reminder_missed", severity: "warning", payload: { reminder_id: reminder.id } },
    });
    if (ok) counts.missed += 1;
    return counts;
  }

  const { step, action, status, nextActionAt } = decision;
  if (step === 0 || step === 1) {
    if (await apply({ step, action, status, next: nextActionAt })) counts[step === 0 ? "prompts" : "reprompts"] += 1;
    return counts;
  }
  if (step === 2) {
    // Not reachable while the voice call is off; recorded as skipped if it ever is.
    await apply({ step, action, stepStatus: "skipped", detail: "not_available", status, next: nextActionAt });
    return counts;
  }

  // Steps 3 and 4: an alert row for the right contact, queued. Sending is Stage S6.
  const priority = step === 3 ? "primary" : "secondary";
  const contacts = await db.select("contacts", { patient_id: patientId, household_id: household, priority }, { column: "created_at" });
  const contact = contacts[0];
  if (!contact) {
    const ok = await apply({
      step,
      action,
      stepStatus: "failed",
      detail: "no_contact",
      status,
      next: nextActionAt,
      event: { kind: "escalation_step_failed", severity: "warning", payload: { reminder_id: reminder.id, step, reason: "no_contact" } },
    });
    if (ok) counts.failedSteps += 1;
    return counts;
  }

  const [patient] = await db.select("patients", { id: patientId, household_id: household });
  const title = item ? str(item.title) : "Reminder";
  const due = localParts(new Date(dueAt), str(patient?.timezone) || "Asia/Kolkata").hhmm;
  const summary = step === 3 ? `Not confirmed yet: ${title}, due ${due}.` : `Still not confirmed: ${title}, due ${due}. The first contact has not answered.`;
  const ok = await apply({
    step,
    action,
    status,
    next: nextActionAt,
    alert: { contact_id: contact.id, severity: step === 3 ? "warning" : "urgent", kind: FAMILY_KINDS[step as 3 | 4], summary },
  });
  if (ok) counts[step === 3 ? "familyAlerts" : "secondaryAlerts"] += 1;
  return counts;
}

/** REM-5/REM-6: confirm through the database, so a confirmation racing a step always wins. */
export async function confirmReminder(
  db: Db,
  input: { reminderId: string; patientId: string; householdId: string; by: "patient" | "family"; userId: string | null; source: string; now: Date },
): Promise<"confirmed" | "already" | "not_open" | "not_found"> {
  const [row] = await db.rpc("confirm_reminder", {
    p_reminder: input.reminderId,
    p_patient: input.patientId,
    p_household: input.householdId,
    p_by: input.by,
    p_user: input.userId,
    p_source: input.source,
    p_now: input.now.toISOString(),
  });
  const outcome = str(row?.outcome);
  return outcome === "confirmed" || outcome === "already" || outcome === "not_open" ? outcome : "not_found";
}

/** A family member acknowledges an alert: the reminder is resolved and later steps stop. Stage S6 calls this from the API. */
export async function acknowledgeAlert(db: Db, input: { alertId: string; householdId: string; userId: string; now: Date }): Promise<boolean> {
  const [row] = await db.rpc("acknowledge_alert", {
    p_alert: input.alertId,
    p_household: input.householdId,
    p_user: input.userId,
    p_now: input.now.toISOString(),
  });
  return row?.acknowledged === true;
}
