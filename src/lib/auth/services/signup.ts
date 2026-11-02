import type { AuditLogger } from "../audit";
import { type CaptchaPolicy, passesCaptcha } from "../captcha";
import { checkLimits, RATE_RULES, type RateLimiter, rateKey, tooManyMessage } from "../rate-limit";
import { firstIssue, signupSchema } from "../schemas";
import { withMinDuration } from "../timing";
import { CAPTCHA_FAILED, rateLimited, type ServiceResult, SOMETHING_WRONG } from "./result";

/** The same answer whether or not the email already has an account. */
export const SIGNUP_SENT = "Check your email for a link to finish signing up. The link works once.";

export type SignupDeps = {
  /**
   * Creates the auth user and sends the verification email. Returns Supabase's error code, if any.
   * Only email and password are passed on: never a role, household or other metadata.
   */
  signUp(email: string, password: string, emailRedirectTo: string, captchaToken?: string): Promise<{ errorCode: string | null }>;
  limiter: RateLimiter;
  captcha: CaptchaPolicy;
  audit: AuditLogger;
  siteUrl: string;
  minMs: number;
};

export function signup(raw: unknown, ctx: { ip: string }, deps: SignupDeps): Promise<ServiceResult> {
  return withMinDuration(deps.minMs, () => attempt(raw, ctx, deps));
}

async function attempt(raw: unknown, ctx: { ip: string }, deps: SignupDeps): Promise<ServiceResult> {
  // Unknown keys such as role or household_id are stripped here and never reach Supabase.
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: firstIssue(parsed.error) } };
  const { email, password, captchaToken, invite } = parsed.data;

  try {
    const limit = await checkLimits(deps.limiter, [
      { key: await rateKey("signup:ip", ctx.ip), rule: RATE_RULES.signupIp },
      { key: await rateKey("signup:email", email), rule: RATE_RULES.signupEmail },
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

  // After verifying, the user lands on the invite (if any) or the app. Household setup happens
  // later, server-side, once the email is verified.
  const destination = invite ? `/invite/${invite}` : "/app/today";
  const { errorCode } = await deps.signUp(
    email,
    password,
    `${deps.siteUrl}${destination}`,
    deps.captcha.forwardToSupabase ? captchaToken : undefined,
  );

  // Supabase rejected the CAPTCHA token: about the check, not the account, so it is safe to say.
  if (errorCode === "captcha_failed") return { status: 400, body: { error: CAPTCHA_FAILED } };
  // A weak or leaked password is about the password, not the account, so it is safe to say.
  if (errorCode === "weak_password") {
    return { status: 400, body: { error: "Choose a stronger password. Avoid common or leaked passwords." } };
  }
  // Every other outcome, including "this email already exists", gets the same answer.
  await deps.audit({ action: "auth.signup_requested" });
  return { status: 200, body: { message: SIGNUP_SENT } };
}
