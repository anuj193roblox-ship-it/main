import type { Role } from "../access";
import type { AuditLogger } from "../audit";
import { checkLimits, RATE_RULES, type RateLimiter, rateKey, tooManyMessage } from "../rate-limit";
import { acceptInviteSchema, createInviteSchema, firstIssue } from "../schemas";
import { rateLimited, type ServiceResult, SOMETHING_WRONG } from "./result";

/** One answer for unknown, used, expired, tampered or otherwise unusable invites. */
export const INVITE_UNUSABLE = "This invite cannot be used. Ask the person who invited you for a new one.";

export type CreateInviteDeps = {
  insertInvite(row: { householdId: string; role: "family" | "clinician"; tokenHash: string; createdBy: string }): Promise<{ id: string } | null>;
  randomToken(): string;
  hash(token: string): Promise<string>;
  limiter: RateLimiter;
  audit: AuditLogger;
  siteUrl: string;
};

/**
 * Only a household admin can invite, and only into their own household: the household comes from
 * the session, never from the request body.
 */
export async function createInvite(
  raw: unknown,
  ctx: { userId: string; householdId: string; role: Role },
  deps: CreateInviteDeps,
): Promise<ServiceResult> {
  if (ctx.role !== "admin") return { status: 403, body: { error: "Only the household owner can invite people." } };

  const parsed = createInviteSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: "Choose family or clinician." } };

  try {
    const limit = await checkLimits(deps.limiter, [
      { key: await rateKey("invite:create", ctx.userId), rule: RATE_RULES.inviteCreateUser },
    ]);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds, tooManyMessage(limit.retryAfterSeconds));
  } catch {
    return { status: 503, body: { error: SOMETHING_WRONG } };
  }

  const token = deps.randomToken();
  const row = await deps.insertInvite({
    householdId: ctx.householdId,
    role: parsed.data.role,
    tokenHash: await deps.hash(token),
    createdBy: ctx.userId,
  });
  if (!row) return { status: 500, body: { error: SOMETHING_WRONG } };

  await deps.audit({ action: "auth.invite_created", actorId: ctx.userId, householdId: ctx.householdId, recordId: row.id });
  // The token is shown once, here. Only its hash is stored.
  return { status: 201, body: { link: `${deps.siteUrl}/invite/${token}`, role: parsed.data.role, expiresInHours: 24 } };
}

export type AcceptInviteDeps = {
  /** accept_invite(): atomic, single-use. Returns null for every kind of failure. */
  acceptInvite(tokenHash: string, userId: string, displayName: string): Promise<{ householdId: string; role: Role } | null>;
  hash(token: string): Promise<string>;
  limiter: RateLimiter;
  audit: AuditLogger;
};

export async function acceptInvite(
  raw: unknown,
  ctx: { userId: string; ip: string },
  deps: AcceptInviteDeps,
): Promise<ServiceResult> {
  try {
    const limit = await checkLimits(deps.limiter, [
      { key: await rateKey("invite:accept:ip", ctx.ip), rule: RATE_RULES.inviteAcceptIp },
      { key: await rateKey("invite:accept:user", ctx.userId), rule: RATE_RULES.inviteAcceptUser },
    ]);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds, tooManyMessage(limit.retryAfterSeconds));
  } catch {
    return { status: 503, body: { error: SOMETHING_WRONG } };
  }

  const parsed = acceptInviteSchema.safeParse(raw);
  if (!parsed.success) {
    const nameProblem = parsed.error.issues.find((i) => i.path[0] === "displayName");
    if (nameProblem) return { status: 400, body: { error: firstIssue(parsed.error) } };
    await deps.audit({ action: "auth.invite_rejected", actorId: ctx.userId });
    return { status: 400, body: { error: INVITE_UNUSABLE } };
  }

  const joined = await deps.acceptInvite(await deps.hash(parsed.data.token), ctx.userId, parsed.data.displayName);
  if (!joined) {
    await deps.audit({ action: "auth.invite_rejected", actorId: ctx.userId });
    return { status: 400, body: { error: INVITE_UNUSABLE } };
  }
  // accept_invite() writes the invite_used and role audit rows itself.
  return { status: 200, body: { next: "/app/today" } };
}
