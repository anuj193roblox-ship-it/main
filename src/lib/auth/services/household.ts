import { checkLimits, RATE_RULES, type RateLimiter, rateKey, tooManyMessage } from "../rate-limit";
import { claimDemoSchema, createHouseholdSchema, firstIssue } from "../schemas";
import { rateLimited, type ServiceResult, SOMETHING_WRONG } from "./result";

export const ALREADY_IN_HOUSEHOLD = "This account already belongs to a household.";
export const DEMO_UNAVAILABLE = "The demo household is not available.";

type Ctx = { userId: string };

async function limited(limiter: RateLimiter, userId: string): Promise<ServiceResult | null> {
  try {
    const limit = await checkLimits(limiter, [{ key: await rateKey("household", userId), rule: RATE_RULES.householdUser }]);
    return limit.allowed ? null : rateLimited(limit.retryAfterSeconds, tooManyMessage(limit.retryAfterSeconds));
  } catch {
    return { status: 503, body: { error: SOMETHING_WRONG } };
  }
}

export type CreateHouseholdDeps = {
  /** create_household_for_user(): verified email, no existing household, user becomes admin. */
  createHousehold(userId: string, displayName: string, householdName: string): Promise<string | null>;
  limiter: RateLimiter;
};

/** The first sign-up in a new household becomes its admin. Role is decided here, not by the client. */
export async function createHousehold(raw: unknown, ctx: Ctx, deps: CreateHouseholdDeps): Promise<ServiceResult> {
  const parsed = createHouseholdSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: firstIssue(parsed.error) } };
  const blocked = await limited(deps.limiter, ctx.userId);
  if (blocked) return blocked;

  const householdId = await deps.createHousehold(ctx.userId, parsed.data.displayName, parsed.data.householdName);
  if (!householdId) return { status: 409, body: { error: ALREADY_IN_HOUSEHOLD } };
  // Straight on to adding the person they care for (ONB-1).
  return { status: 201, body: { next: "/onboarding/patient" } };
}

export type ClaimDemoDeps = {
  demoMode: boolean;
  /** claim_demo_household(): first verified user only. */
  claim(userId: string, displayName: string): Promise<boolean>;
  limiter: RateLimiter;
};

export async function claimDemoHousehold(raw: unknown, ctx: Ctx, deps: ClaimDemoDeps): Promise<ServiceResult> {
  if (!deps.demoMode) return { status: 404, body: { error: DEMO_UNAVAILABLE } };
  const parsed = claimDemoSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: firstIssue(parsed.error) } };
  const blocked = await limited(deps.limiter, ctx.userId);
  if (blocked) return blocked;

  const ok = await deps.claim(ctx.userId, parsed.data.displayName);
  if (!ok) return { status: 409, body: { error: DEMO_UNAVAILABLE } };
  return { status: 201, body: { next: "/app/today" } };
}
