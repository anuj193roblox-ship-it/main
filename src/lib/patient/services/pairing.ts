// Pairing a patient device (ONB-4) and managing paired devices.
import { z } from "zod";
import type { AuditLogger } from "@/lib/auth/audit";
import { checkLimits, type RateLimiter, rateKey, tooManyMessage } from "@/lib/auth/rate-limit";
import { rateLimited, type ServiceResult, SOMETHING_WRONG } from "@/lib/auth/services/result";
import { canOnboard, type CareCtx, currentPatient, FORBIDDEN, NO_PATIENT, NOT_FOUND, str } from "@/lib/care/context";
import { type Db, DbError } from "@/lib/care/db";
import { toMillis } from "../time";
import { DEVICE_TOKEN_TTL_MS, hashDeviceToken, hashPairingCode, newDeviceToken, PAIRING_CODE_TTL_MS, randomPairingCode } from "../device";

export const PAIR_RULES = {
  createUser: { limit: 10, windowSeconds: 60 * 60 },
  pairIp: { limit: 10, windowSeconds: 15 * 60 },
  pairCode: { limit: 5, windowSeconds: 10 * 60 },
};

export const CODE_DID_NOT_WORK = "That code did not work. Ask your family for a new one.";

type PairingDeps = { limiter: RateLimiter; audit: AuditLogger; secret: string; now?: () => Date };

/**
 * Family side: a 6-digit code for the current patient, valid 10 minutes, single use, stored hashed.
 * userDb reads the patient through RLS; serverDb writes the server-only pairing row.
 */
export async function createPairingCode(userDb: Db, serverDb: Db, ctx: CareCtx, deps: PairingDeps): Promise<ServiceResult> {
  if (!canOnboard(ctx.role)) return FORBIDDEN;
  const now = deps.now?.() ?? new Date();
  try {
    const limit = await checkLimits(deps.limiter, [{ key: await rateKey("pair:create", ctx.userId), rule: PAIR_RULES.createUser }]);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds, tooManyMessage(limit.retryAfterSeconds));
  } catch {
    return { status: 503, body: { error: SOMETHING_WRONG } };
  }

  const patient = await currentPatient(userDb, ctx);
  if (!patient) return NO_PATIENT;
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);

  // A clash with another live code is possible (1 in a million per live code); try again.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomPairingCode();
    try {
      const row = await serverDb.insert("device_pairings", {
        household_id: ctx.householdId,
        patient_id: patient.id,
        code_hash: await hashPairingCode(code, deps.secret),
        created_by: ctx.userId,
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      });
      await deps.audit({ action: "device.pairing_code_created", actorId: ctx.userId, householdId: ctx.householdId, recordId: str(row.id) });
      return { status: 201, body: { code, expiresAt: expiresAt.toISOString() } };
    } catch (e) {
      if (e instanceof DbError && e.code === "23505") continue;
      return { status: 500, body: { error: SOMETHING_WRONG } };
    }
  }
  return { status: 500, body: { error: SOMETHING_WRONG } };
}

const pairSchema = z.object({
  code: z.string().transform((s) => s.replace(/\s/g, "")).pipe(z.string().regex(/^\d{6}$/)),
  label: z.string().trim().max(60).optional().default(""),
});

export type PairResult = ServiceResult & { token?: string };

/** Device side: exchange a code for a device token. Every failure looks the same. */
export async function pairDevice(raw: unknown, ctx: { ip: string }, serverDb: Db, deps: PairingDeps): Promise<PairResult> {
  const now = deps.now?.() ?? new Date();
  const parsed = pairSchema.safeParse(raw);
  const code = parsed.success ? parsed.data.code : "invalid";

  try {
    const limit = await checkLimits(deps.limiter, [
      { key: await rateKey("pair:ip", ctx.ip), rule: PAIR_RULES.pairIp },
      { key: await rateKey("pair:code", code), rule: PAIR_RULES.pairCode },
    ]);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds, tooManyMessage(limit.retryAfterSeconds));
  } catch {
    return { status: 503, body: { error: SOMETHING_WRONG } };
  }
  if (!parsed.success) return { status: 400, body: { error: CODE_DID_NOT_WORK } };

  const token = newDeviceToken();
  const rows = await serverDb.rpc("consume_pairing_code", {
    p_code_hash: await hashPairingCode(parsed.data.code, deps.secret),
    p_token_hash: await hashDeviceToken(token),
    p_label: parsed.data.label || "Patient device",
    p_expires_at: new Date(now.getTime() + DEVICE_TOKEN_TTL_MS).toISOString(),
  });
  if (!rows[0]) {
    await deps.audit({ action: "device.pair_failed" });
    return { status: 400, body: { error: CODE_DID_NOT_WORK } };
  }
  return { status: 200, body: { next: "/patient" }, token };
}

export type DeviceView = { id: string; label: string; pairedAt: string; lastUsedAt: string; expiresAt: string; revoked: boolean; expired: boolean };

export async function listDevices(serverDb: Db, ctx: CareCtx, now: Date = new Date()): Promise<DeviceView[]> {
  const rows = await serverDb.select("device_tokens", { household_id: ctx.householdId }, { column: "created_at", ascending: false });
  return rows.map((r) => ({
    id: str(r.id),
    label: str(r.label) || "Patient device",
    pairedAt: str(r.created_at),
    lastUsedAt: str(r.last_used_at),
    expiresAt: str(r.expires_at),
    revoked: Boolean(r.revoked_at),
    expired: toMillis(r.expires_at) <= now.getTime(),
  }));
}

export async function revokeDevice(id: string, serverDb: Db, ctx: CareCtx, deps: Pick<PairingDeps, "audit" | "now">): Promise<ServiceResult> {
  if (!canOnboard(ctx.role)) return FORBIDDEN;
  if (!z.uuid().safeParse(id).success) return NOT_FOUND;
  const [device] = await serverDb.select("device_tokens", { id, household_id: ctx.householdId });
  if (!device) return NOT_FOUND;
  if (!device.revoked_at) {
    await serverDb.update("device_tokens", { id, household_id: ctx.householdId }, { revoked_at: (deps.now?.() ?? new Date()).toISOString() });
    await deps.audit({ action: "device.revoked", actorId: ctx.userId, householdId: ctx.householdId, recordId: id });
  }
  return { status: 200, body: { ok: true } };
}
