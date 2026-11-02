// Escalation settings (CARE-4) and engine timers (REM-7). Pure: no server imports, so the plan screen
// can use the same schema and defaults.
import { z } from "zod";

export const SEVERITIES = ["critical", "important", "normal"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** The voice call step (REM-8) is built in a later stage. Until then it never runs. */
export const VOICE_CALL_AVAILABLE = false;

const minutes = (min: number, max: number) => z.number().int().min(min).max(max);

/**
 * One severity. Minutes (seconds with fast demo timers). Each step counts from the step before it:
 * re-prompt after the prompt, voice call and family alert after the re-prompt, secondary after the
 * family alert. Missed counts from the due time. null turns a step off.
 */
export const severityConfigSchema = z
  .object({
    reprompt_after: minutes(1, 120),
    voice_call: z.object({ enabled: z.boolean(), after: minutes(1, 120) }),
    family_after: minutes(1, 240).nullable(),
    secondary_after: minutes(1, 240).nullable(),
    missed_after: minutes(5, 720),
  })
  .refine((c) => c.secondary_after === null || c.family_after !== null, {
    message: "The second contact is only alerted after the first.",
    path: ["secondary_after"],
  })
  .refine((c) => c.missed_after > c.reprompt_after, {
    message: "Missed must come after the re-prompt.",
    path: ["missed_after"],
  });
export type SeverityConfig = z.infer<typeof severityConfigSchema>;

export const escalationConfigSchema = z.object({
  critical: severityConfigSchema,
  important: severityConfigSchema,
  normal: severityConfigSchema,
});
export type EscalationConfig = z.infer<typeof escalationConfigSchema>;

/** Same values as the column default in 0005_reminders.sql. */
export const DEFAULT_ESCALATION: EscalationConfig = {
  critical: { reprompt_after: 5, voice_call: { enabled: false, after: 5 }, family_after: 10, secondary_after: 15, missed_after: 60 },
  important: { reprompt_after: 10, voice_call: { enabled: false, after: 10 }, family_after: 20, secondary_after: 30, missed_after: 90 },
  normal: { reprompt_after: 15, voice_call: { enabled: false, after: 15 }, family_after: null, secondary_after: null, missed_after: 120 },
};

/** Reads a stored config. A severity that is missing or invalid falls back to its default. */
export function parseEscalation(raw: unknown): EscalationConfig {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_ESCALATION };
  for (const s of SEVERITIES) {
    const parsed = severityConfigSchema.safeParse(source[s]);
    if (parsed.success) out[s] = parsed.data;
  }
  return out;
}

export function severityOf(value: unknown): Severity {
  return value === "critical" || value === "important" ? value : "normal";
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

type Env = Record<string, string | undefined>;

const ON = new Set(["true", "1", "yes", "on"]);

/** DEMO_FAST_TIMERS=true: minutes become seconds (REM-7). */
export function fastTimers(env: Env = process.env): boolean {
  return ON.has((env.DEMO_FAST_TIMERS ?? "").trim().toLowerCase());
}

/** Length of one configured "minute" in milliseconds. */
export function timerUnitMs(env: Env = process.env): number {
  return fastTimers(env) ? 1000 : 60_000;
}

export const FAST_TIMERS_IN_PRODUCTION = "DEMO_FAST_TIMERS is on. Nurra does not start in production with demo timers. Remove it or set it to false.";

/** Called at startup (next.config and instrumentation). Throws so a production server never starts with demo timers. */
export function assertStartupConfig(env: Env = process.env): void {
  if (env.NODE_ENV === "production" && fastTimers(env)) throw new Error(FAST_TIMERS_IN_PRODUCTION);
}
