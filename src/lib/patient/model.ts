// The check-in model's reply contract. The model has no tools: it returns this JSON and nothing
// else, and code decides what happens (confirmation, escalation, alerts).
import { z } from "zod";

export const INTENTS = ["confirm_taken", "ask_question", "report_symptom", "refuse", "unclear", "chitchat"] as const;
export const MOODS = ["calm", "anxious", "confused", "low", "ok"] as const;

export const modelReplySchema = z
  .object({
    say: z.string().min(1).max(400),
    intent: z.enum(INTENTS),
    /** Advisory only. A dose is confirmed by a tap or an exact affirmative, never by this. */
    reminder_confirmed: z.boolean(),
    mood: z.enum(MOODS),
    escalate: z.boolean(),
    escalation_reason: z.string().max(200).nullable(),
  })
  .strict();

export type ModelReply = z.infer<typeof modelReplySchema>;

export type ModelInput = { system: string; user: string };

/**
 * Anything that can produce a reply. Returns the parsed JSON (unknown: it is validated by the
 * caller) or throws. Tests pass a fake; production uses the Anthropic client in model-anthropic.ts.
 */
export interface ModelClient {
  reply(input: ModelInput): Promise<unknown>;
}
