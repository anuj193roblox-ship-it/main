import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { type ModelClient, modelReplySchema } from "./model";

export const DEFAULT_CHECKIN_MODEL = "claude-sonnet-5-5";

/**
 * Claude for patient check-ins. One non-streaming call, no tools, JSON constrained by structured
 * outputs. Short timeout: a patient is waiting, and any failure becomes a scripted reply.
 */
export function createAnthropicModel(env: Record<string, string | undefined> = process.env): ModelClient {
  const model = env.ANTHROPIC_MODEL_CHECKIN || DEFAULT_CHECKIN_MODEL;
  let client: Anthropic | null = null;

  return {
    async reply({ system, user }) {
      // Created on first use, inside the caller's try: a missing ANTHROPIC_API_KEY becomes the
      // scripted fallback reply, not a crash. Credentials come from the environment; never logged.
      client ??= new Anthropic({ timeout: 20_000, maxRetries: 1 });
      const response = await client.messages.parse({
        model,
        max_tokens: 2000,
        system,
        messages: [{ role: "user", content: user }],
        // Short conversational replies: low effort keeps latency and cost down.
        output_config: { effort: "low", format: zodOutputFormat(modelReplySchema) },
      });
      if (response.stop_reason === "refusal") throw new Error("model declined");
      if (response.stop_reason === "max_tokens") throw new Error("model reply cut off");
      if (response.parsed_output == null) throw new Error("model reply not parseable");
      return response.parsed_output;
    },
  };
}
