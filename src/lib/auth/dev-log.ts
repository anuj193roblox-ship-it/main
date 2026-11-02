// Development-only diagnostics for auth failures. Users always see the generic message; this tells
// the developer which step failed. It never logs secrets, tokens, emails, IPs or request bodies:
// only a fixed step name, the route, and an error code that matches a strict pattern.

export type AuthStep = "session-secret" | "rate-limit" | "supabase" | "turnstile";

const SAFE_CODE = /^[A-Za-z0-9_.-]{1,40}$/;

/** Keeps only short machine codes such as "PGRST202" or "invalid-input-secret". */
export function safeCode(code: unknown): string | undefined {
  return typeof code === "string" && SAFE_CODE.test(code) ? code : undefined;
}

/** What to do about well-known failures. Fixed text only. A detail hint wins over a code hint. */
const HINTS: Record<string, string> = {
  "migration-0002-missing": "migration 0002 is not in the database: run supabase/migrations/0002_auth.sql in the Supabase SQL editor",
  "schema-cache-stale": "0002 is in the database but the Supabase API has not reloaded: run  notify pgrst, 'reload schema';  in the SQL editor",
  PGRST202: "function not found: run supabase/migrations/0002_auth.sql in the Supabase SQL editor",
  PGRST205: "table not found: run the migrations in supabase/migrations in order",
  "42501": "permission denied: check the grants at the end of 0002_auth.sql",
  "invalid-api-key": "the service-role key in .env.local does not belong to the project in NEXT_PUBLIC_SUPABASE_URL",
  "network-error": "NEXT_PUBLIC_SUPABASE_URL is wrong or unreachable",
  "invalid-input-secret": "TURNSTILE_SECRET_KEY is wrong for this site key",
  "timeout-or-duplicate": "the Turnstile token was already used or expired",
  AUTH_SESSION_SECRET: "set AUTH_SESSION_SECRET to at least 32 random characters",
  captcha_failed:
    "Supabase Auth has CAPTCHA protection on. Either turn it off (Auth > Attack protection) or set SUPABASE_VERIFIES_CAPTCHA=true with the Turnstile site key that matches the secret saved in Supabase",
  "missing-or-malformed": "this setting is missing or not in the expected format (check .env.local)",
};

export function formatAuthStepLog(route: string, step: AuthStep, code?: unknown, detail?: unknown): string {
  const c = safeCode(code);
  const d = safeCode(detail);
  const hint = (d && HINTS[d]) || (c && HINTS[c]);
  const label = [c, d].filter(Boolean).join(", ");
  return `[auth] ${route}: ${step} failed${label ? ` (${label})` : ""}${hint ? ` - ${hint}` : ""}`;
}

export function logAuthStep(
  route: string,
  step: AuthStep,
  code?: unknown,
  opts: { detail?: unknown; env?: string } = {},
): void {
  if ((opts.env ?? process.env.NODE_ENV) === "production") return;
  console.warn(formatAuthStepLog(route, step, code, opts.detail));
}

/** Error from a failed step, carrying only a safe code. */
export class AuthStepError extends Error {
  constructor(
    readonly step: AuthStep,
    readonly code?: string,
  ) {
    super(`${step} failed`);
  }
}
