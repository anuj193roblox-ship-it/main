// Cloudflare Turnstile server-side verification.

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type CaptchaPolicy = {
  /** True when the token is genuine. Not called when Supabase verifies the token itself. */
  verify(token: string, ip: string): Promise<boolean>;
  /** Forward the token to Supabase Auth instead of verifying here (tokens are single-use). */
  forwardToSupabase: boolean;
};

export function createTurnstilePolicy(
  secretKey: string,
  forwardToSupabase: boolean,
  fetchImpl: typeof fetch = fetch,
  /** Told why a check failed: Cloudflare's error code (e.g. "invalid-input-secret"), never the token. */
  onFailure?: (code: string) => void,
): CaptchaPolicy {
  return {
    forwardToSupabase,
    async verify(token, ip) {
      try {
        const body = new URLSearchParams({ secret: secretKey, response: token });
        if (ip && ip !== "unknown") body.set("remoteip", ip);
        const res = await fetchImpl(TURNSTILE_VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(8000) });
        if (!res.ok) {
          onFailure?.(`http-${res.status}`);
          return false;
        }
        const json = (await res.json()) as { success?: unknown; "error-codes"?: unknown };
        if (json.success === true) return true;
        const codes = Array.isArray(json["error-codes"]) ? json["error-codes"] : [];
        onFailure?.(typeof codes[0] === "string" ? codes[0] : "not-successful");
        return false;
      } catch {
        onFailure?.("network-error");
        return false;
      }
    },
  };
}

/** Runs the policy: true if the request may continue. */
export async function passesCaptcha(policy: CaptchaPolicy, token: string, ip: string): Promise<boolean> {
  return policy.forwardToSupabase ? true : policy.verify(token, ip);
}
