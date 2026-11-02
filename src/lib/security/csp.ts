// Content-Security-Policy for pages. Set per request by the proxy, because it carries a nonce.

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

export type CspOptions = {
  nonce: string;
  /** Development needs 'unsafe-eval' (React debugging) and inline styles (dev overlay). */
  dev: boolean;
  /** NEXT_PUBLIC_SUPABASE_URL. Its origin (https and wss) is the only outside API allowed. */
  supabaseUrl?: string;
};

export function buildCsp({ nonce, dev, supabaseUrl }: CspOptions): string {
  let supabase: string[] = [];
  if (supabaseUrl) {
    try {
      const url = new URL(supabaseUrl);
      supabase = [url.origin, `wss://${url.host}`];
    } catch {
      supabase = [];
    }
  }

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic': scripts loaded by our nonce'd scripts (Turnstile) are trusted; nothing else.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", TURNSTILE_ORIGIN, ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": dev ? ["'self'", "'unsafe-inline'"] : ["'self'", `'nonce-${nonce}'`],
    "img-src": ["'self'", "data:", "blob:"],
    // Fonts are self-hosted by next/font. No font CDNs.
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...supabase, TURNSTILE_ORIGIN, ...(dev ? ["ws://localhost:*"] : [])],
    "frame-src": [TURNSTILE_ORIGIN],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "media-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Strict CSP for API responses (JSON only): nothing may load, nothing may frame it. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";
