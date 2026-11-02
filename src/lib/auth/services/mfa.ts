import type { AuditLogger } from "../audit";
import { checkLimits, RATE_RULES, type RateLimiter, rateKey, tooManyMessage } from "../rate-limit";
import { firstIssue, mfaVerifySchema } from "../schemas";
import { rateLimited, type ServiceResult, SOMETHING_WRONG } from "./result";

export const MFA_CODE_WRONG = "That code did not work. Check the time on your phone and try the newest code.";

export type MfaVerifyDeps = {
  /** The factor belongs to the signed-in user. Returns its status, or null if it is not theirs. */
  factorStatus(factorId: string): Promise<"verified" | "unverified" | null>;
  /** Supabase mfa.challengeAndVerify. True on success; the session becomes aal2. */
  challengeAndVerify(factorId: string, code: string): Promise<boolean>;
  limiter: RateLimiter;
  audit: AuditLogger;
};

export async function verifyMfa(
  raw: unknown,
  ctx: { userId: string; householdId: string | null },
  deps: MfaVerifyDeps,
): Promise<ServiceResult> {
  const parsed = mfaVerifySchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: firstIssue(parsed.error) } };

  try {
    const limit = await checkLimits(deps.limiter, [{ key: await rateKey("mfa", ctx.userId), rule: RATE_RULES.mfaUser }]);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds, tooManyMessage(limit.retryAfterSeconds));
  } catch {
    return { status: 503, body: { error: SOMETHING_WRONG } };
  }

  const status = await deps.factorStatus(parsed.data.factorId);
  if (!status) return { status: 400, body: { error: MFA_CODE_WRONG } };

  const ok = await deps.challengeAndVerify(parsed.data.factorId, parsed.data.code);
  const who = { actorId: ctx.userId, householdId: ctx.householdId };
  if (!ok) {
    await deps.audit({ action: "auth.mfa_failure", ...who });
    return { status: 400, body: { error: MFA_CODE_WRONG } };
  }
  // First successful code turns on two-step sign-in: that is an MFA change worth recording.
  await deps.audit({ action: status === "unverified" ? "auth.mfa_enrolled" : "auth.mfa_verified", ...who });
  return { status: 200, body: { next: "/app/today" } };
}
