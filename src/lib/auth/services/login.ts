import type { AuditLogger } from "../audit";
import { type CaptchaPolicy, passesCaptcha } from "../captcha";
import { safeNextPath } from "../next-path";
import { checkLimits, RATE_RULES, type RateLimiter, rateKey, tooManyMessage } from "../rate-limit";
import { loginSchema } from "../schemas";
import { withMinDuration } from "../timing";
import { CAPTCHA_FAILED, rateLimited, type ServiceResult, SOMETHING_WRONG } from "./result";

/** One message for every credential failure: unknown email, wrong password, unverified email. */
export const GENERIC_LOGIN_ERROR = "Email or password is not right, or the email is not verified yet.";

export type LoginDeps = {
  /** null or { errorCode } for a failed sign-in. Supabase error codes such as captcha_failed pass through. */
  signInWithPassword(email: string, password: string, captchaToken?: string): Promise<{ userId: string } | { errorCode: string } | null>;
  householdOf(userId: string): Promise<string | null>;
  limiter: RateLimiter;
  captcha: CaptchaPolicy;
  audit: AuditLogger;
  minMs: number;
};

export type LoginResult = ServiceResult & { userId?: string };

export function login(raw: unknown, ctx: { ip: string }, deps: LoginDeps): Promise<LoginResult> {
  // Every outcome takes at least minMs, so timing does not reveal whether the email exists.
  return withMinDuration(deps.minMs, () => attempt(raw, ctx, deps));
}

async function attempt(raw: unknown, ctx: { ip: string }, deps: LoginDeps): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: "Enter your email and password." } };
  const { email, password, captchaToken, next } = parsed.data;

  const accountKey = await rateKey("login:account", email);
  try {
    const limit = await checkLimits(deps.limiter, [
      { key: await rateKey("login:ip", ctx.ip), rule: RATE_RULES.loginIp },
      { key: accountKey, rule: RATE_RULES.loginAccount },
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

  const result = await deps.signInWithPassword(email, password, deps.captcha.forwardToSupabase ? captchaToken : undefined);
  // Supabase rejected the CAPTCHA token before looking at the account, so saying so reveals nothing.
  if (result && "errorCode" in result && result.errorCode === "captcha_failed") {
    return { status: 400, body: { error: CAPTCHA_FAILED } };
  }
  if (!result || !("userId" in result)) {
    await deps.audit({ action: "auth.login_failure" });
    return { status: 401, body: { error: GENERIC_LOGIN_ERROR } };
  }

  await deps.limiter.reset(accountKey).catch(() => undefined);
  await deps.audit({ action: "auth.login_success", actorId: result.userId, householdId: await deps.householdOf(result.userId) });
  return { status: 200, body: { next: safeNextPath(next) }, userId: result.userId };
}
