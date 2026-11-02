// Patient device credentials (ONB-4). The patient never has an account: a family member creates a
// 6-digit code, and the device exchanges it once for a random device token. Only hashes are stored.
import type { Db, Row } from "@/lib/care/db";
import { randomToken, sha256Hex } from "@/lib/auth/tokens";

export const DEVICE_COOKIE = "nurra_device";
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const DEVICE_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const DEVICE_SCOPES = ["checkin", "confirm"] as const;
export type DeviceScope = (typeof DEVICE_SCOPES)[number];

/** A uniformly random 6-digit code (000000-999999), without modulo bias. */
export function randomPairingCode(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return String(n % 1_000_000).padStart(6, "0");
}

/**
 * Codes have only a million values, so a plain hash could be reversed from a leaked table.
 * They are hashed with a server secret (HMAC) instead.
 */
export async function hashPairingCode(code: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`pairing:${code}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Device tokens are 32 random bytes: a plain SHA-256 is enough to store them. */
export function newDeviceToken(): string {
  return randomToken();
}
export const hashDeviceToken = sha256Hex;

export type DeviceContext = {
  deviceId: string;
  patientId: string;
  householdId: string;
  scopes: DeviceScope[];
};

/**
 * Looks up a device token. Revoked, expired or unknown tokens give null. The patient and household
 * come from the token row only, never from the request.
 */
export async function authenticateDevice(db: Db, token: string | undefined | null, now: Date = new Date()): Promise<DeviceContext | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const rows = await db.select("device_tokens", { token_hash: await hashDeviceToken(token) });
  const row: Row | undefined = rows[0];
  if (!row || row.revoked_at) return null;
  if (Date.parse(String(row.expires_at)) <= now.getTime()) return null;
  const scopes = (Array.isArray(row.scope) ? row.scope : []).filter((s): s is DeviceScope => DEVICE_SCOPES.includes(s as DeviceScope));
  await db.update("device_tokens", { id: row.id }, { last_used_at: now.toISOString() });
  return { deviceId: String(row.id), patientId: String(row.patient_id), householdId: String(row.household_id), scopes };
}
