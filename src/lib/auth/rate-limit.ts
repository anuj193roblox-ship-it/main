// Sliding-window rate limits backed by Postgres (migration 0002). No extra services.
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthStepError } from "./dev-log";
import { sha256Hex } from "./tokens";

export type RateRule = { limit: number; windowSeconds: number };
export type RateResult = { allowed: boolean; retryAfterSeconds: number };

export interface RateLimiter {
  hit(key: string, rule: RateRule): Promise<RateResult>;
  reset(key: string): Promise<void>;
}

export const RATE_RULES = {
  loginIp: { limit: 20, windowSeconds: 15 * 60 },
  loginAccount: { limit: 5, windowSeconds: 15 * 60 },
  signupIp: { limit: 5, windowSeconds: 60 * 60 },
  signupEmail: { limit: 3, windowSeconds: 60 * 60 },
  emailLinkIp: { limit: 5, windowSeconds: 60 * 60 },
  emailLinkEmail: { limit: 3, windowSeconds: 60 * 60 },
  inviteAcceptIp: { limit: 10, windowSeconds: 60 * 60 },
  inviteAcceptUser: { limit: 5, windowSeconds: 60 * 60 },
  inviteCreateUser: { limit: 20, windowSeconds: 60 * 60 },
  householdUser: { limit: 5, windowSeconds: 60 * 60 },
  mfaUser: { limit: 10, windowSeconds: 15 * 60 },
} satisfies Record<string, RateRule>;

/** Keys are hashed, so the database never holds raw emails or IP addresses. */
export function rateKey(kind: string, value: string): Promise<string> {
  return sha256Hex(`${kind}:${value.trim().toLowerCase()}`);
}

/** Checks each limit in order and stops at the first one that blocks. */
export async function checkLimits(
  limiter: RateLimiter,
  checks: { key: string; rule: RateRule }[],
): Promise<RateResult> {
  for (const { key, rule } of checks) {
    const result = await limiter.hit(key, rule);
    if (!result.allowed) return result;
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function tooManyMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

type RpcError = { code?: string } | null;

/**
 * Turns a failed RPC into a short, safe code that says which cause it is:
 *   PGRST202 + "migration-0002-missing"  the function does not exist (0002 not run)
 *   PGRST202 + "schema-cache-stale"      0002 ran, but the Supabase API has not reloaded
 *   invalid-api-key                      the service-role key is wrong for this project
 *   network-error                        the Supabase URL is wrong or unreachable
 */
export async function classifyRpcFailure(
  admin: SupabaseClient,
  error: RpcError,
  status: number,
): Promise<{ code: string; detail?: string }> {
  if (status === 401 || status === 403) return { code: "invalid-api-key" };
  if (status === 0 || (!error?.code && status >= 500)) return { code: status === 0 ? "network-error" : `http-${status}` };
  const code = error?.code || `http-${status}`;
  if (code !== "PGRST202") return { code };
  // Is anything from migration 0002 there? The invites table is created by the same file.
  // A normal GET, not head: supabase-js turns a HEAD 404 (empty body) into a success.
  const probe = await admin.from("invites").select("id").limit(1);
  return { code, detail: probe.error ? "migration-0002-missing" : "schema-cache-stale" };
}

/** Production limiter: the check_rate_limit function, called with the service role. Fails closed. */
export function createDbRateLimiter(admin: SupabaseClient, onFailure?: (code: string, detail?: string) => void): RateLimiter {
  const fail = async (error: RpcError, status: number): Promise<never> => {
    const { code, detail } = await classifyRpcFailure(admin, error, status).catch(() => ({ code: "rpc-error", detail: undefined }));
    onFailure?.(code, detail);
    throw new AuthStepError("rate-limit", code);
  };
  return {
    async hit(key, rule) {
      const { data, error, status } = await admin.rpc("check_rate_limit", {
        p_key: key,
        p_limit: rule.limit,
        p_window_seconds: rule.windowSeconds,
      });
      if (error) return fail(error, status);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        onFailure?.("no-row");
        throw new AuthStepError("rate-limit", "no-row");
      }
      return { allowed: Boolean(row.allowed), retryAfterSeconds: Number(row.retry_after_seconds) || 0 };
    },
    async reset(key) {
      const { error, status } = await admin.rpc("reset_rate_limit", { p_key: key });
      if (error) await fail(error, status);
    },
  };
}

/** Same sliding-window rules in memory, for tests. */
export function createMemoryRateLimiter(now: () => number = () => Date.now()): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    async hit(key, rule) {
      const t = now();
      const windowStart = t - rule.windowSeconds * 1000;
      const list = (hits.get(key) ?? []).filter((h) => h > windowStart);
      if (list.length >= rule.limit) {
        hits.set(key, list);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((list[0] + rule.windowSeconds * 1000 - t) / 1000)) };
      }
      list.push(t);
      hits.set(key, list);
      return { allowed: true, retryAfterSeconds: 0 };
    },
    async reset(key) {
      hits.delete(key);
    },
  };
}
