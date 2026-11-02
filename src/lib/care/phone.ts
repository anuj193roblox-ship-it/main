// Phone numbers are stored in E.164 (+<country><number>). India (+91) is the default.

export const E164 = /^\+[1-9]\d{7,14}$/;

export type PhoneResult = { ok: true; e164: string } | { ok: false; error: string };

const INVALID = "Enter a mobile number, for example 98765 43210 or +91 98765 43210.";

/**
 * Accepts what people type ("98765 43210", "+91-98765-43210", "098765 43210") and returns E.164.
 * Indian numbers must be 10 digits starting with 6 to 9. Other countries need a leading +.
 */
export function normalizePhone(input: unknown): PhoneResult {
  if (typeof input !== "string") return { ok: false, error: INVALID };
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 24) return { ok: false, error: INVALID };
  if (!/^[+\d\s().-]+$/.test(trimmed)) return { ok: false, error: INVALID };

  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  let e164: string;
  if (plus) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+91${digits}`;
  else if (digits.length === 11 && digits.startsWith("0")) e164 = `+91${digits.slice(1)}`;
  else if (digits.length === 12 && digits.startsWith("91")) e164 = `+${digits}`;
  else return { ok: false, error: INVALID };

  if (!E164.test(e164)) return { ok: false, error: INVALID };
  if (e164.startsWith("+91") && !/^\+91[6-9]\d{9}$/.test(e164)) return { ok: false, error: INVALID };
  return { ok: true, e164 };
}
