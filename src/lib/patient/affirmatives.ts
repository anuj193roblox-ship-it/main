// Spoken confirmation of a dose (REM-6): only an exact match from this short list counts.
// "Maybe", "I think so", "probably" and anything not on the list stay unconfirmed.
import { normalizeSpeech } from "./text";

export const CLEAR_AFFIRMATIVES = new Set([
  "yes",
  "yes i did",
  "yes i took them",
  "yes i took it",
  "yes i have",
  "yes i have taken them",
  "i took them",
  "i took it",
  "i have taken them",
  "i have taken it",
  "taken",
  "done",
  "haan",
  "haa",
  "han",
  "ji haan",
  "haan le li",
  "haan le liya",
  "le li",
  "le liya",
  "le liye",
  "kha li",
  "kha liya",
  "houdu",
  "हाँ",
  "हां",
  "जी हाँ",
  "ले ली",
  "ले लिया",
]);

/** True only when the whole transcript is one of the clear affirmatives. */
export function isClearAffirmative(transcript: string): boolean {
  return CLEAR_AFFIRMATIVES.has(normalizeSpeech(transcript));
}
