import type { AuditLogger } from "../audit";
import { type CaptchaPolicy, passesCaptcha } from "../captcha";
import { checkLimits, RATE_RULES, type RateLimiter, rateKey, tooManyMessage } from "../rate-limit";
import { emailOnlySchema, firstIssue, resetPasswordSchema } from "../schemas";
import { withMinDuration } from "../timing";
import { CAPTCHA_FAILED, rateLimited, type ServiceResult, SOMETHING_WRONG } from "./result";

export const RESET_SENT =
  "If an account uses that email, a link to reset the password is on its way. The link works once and expires soon.";
export const VERIFY_RESENT = "If that email is waiting to be verified, a new link is on its way.";
export const LINK_EXPIRED = "This link has expired or was already used. Ask for a new one.";

export type EmailLinkDeps = {
  /** Sends the email. Errors are swallowed: the answer never depends on the account. */
  send(email: string, redirectTo: string, captchaToken?: string): Promise<void>;
  limiter: RateLimiter;
  captcha: CaptchaPolicy;
  audit: AuditLogger;
  siteUrl: string;
  minMs: number;
};

/** Forgot password and resend verification share this flow. */
export function requestEmailLink(
  kind: "reset" | "verify",
  raw: unknown,
  ctx: { ip: string },
  deps: EmailLinkDeps,
): Promise<ServiceResult> {
  return withMinDuration(deps.minMs, async () => {
    const parsed = emailOnlySchema.safeParse(raw);
    if (!parsed.success) return { status: 400, body: { error: firstIssue(parsed.error) } };
    const { email, captchaToken } = parsed.data;

    try {
      const limit = await checkLimits(deps.limiter, [
        { key: await rateKey(`${kind}:ip`, ctx.ip), rule: RATE_RULES.emailLinkIp },
        { key: await rateKey(`${kind}:email`, email), rule: RATE_RULES.emailLinkEmail },
      ]);
      if (!limit.allowed) {
        await deps.audit({ action: "auth.rate_limited" });
        return rateLimited(limit.retryAfterSeconds, tooManyMessage(limit.retryAfterSeconds));
      }
    } catch {
      return { status: 503, body: { error: SOMETHING_WRONG } };
    }

    if (!(await passesCaptcha(deps.captcha, captchaToken, ctx.ip))) {
      return { status: 400, body: { error: CAPTCHA_FAILED } };
    }

    const redirectTo = kind === "reset" ? `${deps.siteUrl}/reset-password` : `${deps.siteUrl}/app/today`;
    await deps.send(email, redirectTo, deps.captcha.forwardToSupabase ? captchaToken : undefined).catch(() => undefined);
    await deps.audit({ action: kind === "reset" ? "auth.password_reset_requested" : "auth.verify_email_resent" });
    return { status: 200, body: { message: kind === "reset" ? RESET_SENT : VERIFY_RESENT } };
  });
}

export type ResetDeps = {
  /** The signed reset cookie is valid and belongs to this session's user. */
  recoveryValid: boolean;
  userId: string;
  householdId: string | null;
  /** Supabase updateUser({ password }). Returns its error code, if any. */
  updatePassword(password: string): Promise<{ errorCode: string | null }>;
  /** Revoke every other session of this user. */
  signOutOtherSessions(): Promise<void>;
  audit: AuditLogger;
};

export async function resetPassword(raw: unknown, deps: ResetDeps): Promise<ServiceResult> {
  if (!deps.recoveryValid) return { status: 400, body: { error: LINK_EXPIRED } };

  const parsed = resetPasswordSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: firstIssue(parsed.error) } };

  const { errorCode } = await deps.updatePassword(parsed.data.password);
  if (errorCode === "insufficient_aal") {
    return { status: 403, body: { error: "Enter your sign-in code first.", mfa: true } };
  }
  if (errorCode === "same_password") {
    return { status: 400, body: { error: "Choose a password you have not used for this account." } };
  }
  if (errorCode === "weak_password") {
    return { status: 400, body: { error: "Choose a stronger password. Avoid common or leaked passwords." } };
  }
  if (errorCode) return { status: 500, body: { error: SOMETHING_WRONG } };

  await deps.signOutOtherSessions();
  await deps.audit({ action: "auth.password_changed", actorId: deps.userId, householdId: deps.householdId });
  return { status: 200, body: { message: "Your password has changed. Other devices have been signed out." } };
}
