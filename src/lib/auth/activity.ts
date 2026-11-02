// Signed timestamps for the inactivity timeout and the password-reset window.
import { INACTIVITY_LIMIT_MS, RECOVERY_WINDOW_MS } from "./session-timing";
import { signValue, verifySignedValue } from "./tokens";

const CLOCK_SKEW_MS = 60 * 1000;

/** Cookie value recording activity at nowMs, bound to one user. */
export function signActivity(userId: string, nowMs: number, secret: string): Promise<string> {
  return signValue(`a:${userId}:${nowMs}`, secret);
}

/** True if the cookie is genuine, belongs to this user and is younger than the inactivity limit. */
export async function isActivityValid(
  value: string | undefined | null,
  userId: string,
  nowMs: number,
  secret: string,
  limitMs = INACTIVITY_LIMIT_MS,
): Promise<boolean> {
  return isFresh(await verifySignedValue(value, secret), "a", userId, nowMs, limitMs);
}

/** Cookie value proving this user opened a password-reset link at nowMs. */
export function signRecovery(userId: string, nowMs: number, secret: string): Promise<string> {
  return signValue(`r:${userId}:${nowMs}`, secret);
}

export async function isRecoveryValid(
  value: string | undefined | null,
  userId: string,
  nowMs: number,
  secret: string,
): Promise<boolean> {
  return isFresh(await verifySignedValue(value, secret), "r", userId, nowMs, RECOVERY_WINDOW_MS);
}

function isFresh(payload: string | null, kind: string, userId: string, nowMs: number, limitMs: number): boolean {
  if (!payload) return false;
  const [k, uid, ts] = payload.split(":");
  const at = Number(ts);
  if (k !== kind || uid !== userId || !Number.isFinite(at)) return false;
  if (at > nowMs + CLOCK_SKEW_MS) return false;
  return nowMs - at < limitMs;
}
