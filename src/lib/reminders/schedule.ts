// The escalation ladder (REM-3) as a pure function of time. The database functions make each step
// atomic and idempotent; this file only decides what is due. Tested with a fake clock.
//
//   step 0  prompt            at the due time                         -> prompted
//   step 1  calmer re-prompt  reprompt_after after the prompt         -> escalating
//   step 2  voice call        voice_call.after after the re-prompt    (off until a later stage)
//   step 3  family alert      family_after after the re-prompt        (primary contact, amber)
//   step 4  secondary alert   secondary_after after the family alert  (secondary contact, red)
//   missed                    missed_after after the due time; steps not reached by then never run.
import { type SeverityConfig, VOICE_CALL_AVAILABLE } from "./config";

export type StepAction = "prompt" | "reprompt" | "voice_call" | "family_alert" | "secondary_alert";
export const STEP_ACTIONS: Record<number, StepAction> = { 0: "prompt", 1: "reprompt", 2: "voice_call", 3: "family_alert", 4: "secondary_alert" };

/** Steps already in escalation_steps: step number -> executed at (ms). */
export type DoneSteps = ReadonlyMap<number, number>;

export type Decision =
  | { kind: "step"; step: number; action: StepAction; status: "prompted" | "escalating"; nextActionAt: number }
  | { kind: "missed" }
  | { kind: "wait"; nextActionAt: number };

type Planned = { step: number; at: number };

/** When each step not yet done is due, given the steps that are. */
export function plannedSteps(dueAt: number, done: DoneSteps, config: SeverityConfig, unitMs: number): Planned[] {
  const out: Planned[] = [];
  const at0 = dueAt;
  out.push({ step: 0, at: at0 });
  const anchor0 = done.get(0) ?? at0;
  const at1 = anchor0 + config.reprompt_after * unitMs;
  out.push({ step: 1, at: at1 });
  const anchor1 = done.get(1) ?? at1;
  if (VOICE_CALL_AVAILABLE && config.voice_call.enabled) out.push({ step: 2, at: anchor1 + config.voice_call.after * unitMs });
  if (config.family_after !== null) {
    const at3 = anchor1 + config.family_after * unitMs;
    out.push({ step: 3, at: at3 });
    if (config.secondary_after !== null) out.push({ step: 4, at: (done.get(3) ?? at3) + config.secondary_after * unitMs });
  }
  return out.filter((p) => !done.has(p.step)).sort((a, b) => a.at - b.at || a.step - b.step);
}

export function missedAt(dueAt: number, config: SeverityConfig, unitMs: number): number {
  return dueAt + config.missed_after * unitMs;
}

/** What to do now. Never returns a step that was done, and never a step at or after the missed time. */
export function decide(input: { dueAt: number; done: DoneSteps; config: SeverityConfig; unitMs: number; now: number }): Decision {
  const { dueAt, done, config, unitMs, now } = input;
  const missed = missedAt(dueAt, config, unitMs);
  if (now >= missed) return { kind: "missed" };

  const pending = plannedSteps(dueAt, done, config, unitMs).filter((p) => p.at < missed);
  const first = pending[0];
  if (!first || first.at > now) return { kind: "wait", nextActionAt: Math.min(first?.at ?? missed, missed) };

  const after = new Map(done);
  after.set(first.step, now);
  const next = plannedSteps(dueAt, after, config, unitMs).filter((p) => p.at < missed)[0];
  return {
    kind: "step",
    step: first.step,
    action: STEP_ACTIONS[first.step],
    status: first.step === 0 ? "prompted" : "escalating",
    nextActionAt: Math.min(next?.at ?? missed, missed),
  };
}
