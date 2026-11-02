/** Lowercase, Unicode-normalised, punctuation removed, single spaces. Devanagari is kept. */
export function normalizeSpeech(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
