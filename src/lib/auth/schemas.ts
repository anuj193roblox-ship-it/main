// Request bodies for the auth routes. z.object strips unknown keys, so a client that sends
// "role" or "household_id" simply has them dropped: those values only ever come from the server.
import { z } from "zod";
import { INVITE_TOKEN_PATTERN } from "./next-path";

export const PASSWORD_MIN = 12;

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(254));
const newPassword = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(128, "Use 128 characters or fewer.");
const captchaToken = z.string().min(1, "Complete the check.").max(4096);
const displayName = z.string().trim().min(1, "Enter your name.").max(80, "Use 80 characters or fewer.");
export const inviteToken = z.string().regex(INVITE_TOKEN_PATTERN);

export const loginSchema = z.object({
  email,
  // No policy hints at login: any non-empty password is checked against the account.
  password: z.string().min(1).max(128),
  captchaToken,
  next: z.string().max(300).optional(),
});

export const signupSchema = z.object({
  email,
  password: newPassword,
  captchaToken,
  invite: inviteToken.optional(),
});

export const emailOnlySchema = z.object({ email, captchaToken });

export const resetPasswordSchema = z.object({ password: newPassword });

export const createHouseholdSchema = z.object({
  displayName,
  householdName: z.string().trim().min(1, "Enter a name for the household.").max(120),
});

export const claimDemoSchema = z.object({ displayName });

export const createInviteSchema = z.object({ role: z.enum(["family", "clinician"]) });

export const acceptInviteSchema = z.object({ token: inviteToken, displayName });

export const mfaVerifySchema = z.object({
  factorId: z.uuid(),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
});

/** First validation message, for showing next to a form. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}
