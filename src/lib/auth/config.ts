// Auth configuration read from the environment. Pure: pass an env object in tests.

/** Cloudflare's documented test keys: they always pass. Development only. */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

const DEV_ACTIVITY_SECRET = "nurra-development-only-activity-secret-not-for-production";

export type AuthConfig = {
  isProduction: boolean;
  /** Enforce TOTP for clinician and admin. REQUIRE_MFA, default true in production, false otherwise. */
  requireMfa: boolean;
  turnstileSiteKey: string;
  turnstileSecretKey: string;
  /**
   * true: Supabase Auth verifies the Turnstile token (dashboard CAPTCHA protection is on), so the app
   * forwards it instead of verifying it itself. A token can only be verified once.
   */
  supabaseVerifiesCaptcha: boolean;
  /** Public origin of the app, used for email links and the Origin check. */
  siteUrl: string;
  /** HMAC key for the inactivity and reset cookies. */
  sessionSecret: string;
  /** Minimum response times that hide whether an account exists. */
  loginMinMs: number;
  signupMinMs: number;
  demoMode: boolean;
};

export class AuthConfigError extends Error {
  /** Setting names only (e.g. "AUTH_SESSION_SECRET"), never values. */
  readonly settings: string[];
  constructor(problems: string[]) {
    super(`Missing or invalid auth settings: ${problems.join(", ")}`);
    this.settings = problems.map((p) => p.split(" ")[0]);
  }
}

type Env = Record<string, string | undefined>;

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function readAuthConfig(env: Env = process.env): AuthConfig {
  const isProduction = env.NODE_ENV === "production";
  const problems: string[] = [];

  let turnstileSiteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  let turnstileSecretKey = env.TURNSTILE_SECRET_KEY ?? "";
  if (!isProduction) {
    turnstileSiteKey ||= TURNSTILE_TEST_SITE_KEY;
    turnstileSecretKey ||= TURNSTILE_TEST_SECRET_KEY;
  } else {
    if (!turnstileSiteKey) problems.push("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
    if (!turnstileSecretKey) problems.push("TURNSTILE_SECRET_KEY");
    if (turnstileSecretKey === TURNSTILE_TEST_SECRET_KEY) problems.push("TURNSTILE_SECRET_KEY (test key in production)");
  }

  let sessionSecret = env.AUTH_SESSION_SECRET ?? "";
  if (sessionSecret.length < 32) {
    if (isProduction) problems.push("AUTH_SESSION_SECRET (at least 32 characters)");
    else sessionSecret = DEV_ACTIVITY_SECRET;
  }

  let siteUrl = env.NEXT_PUBLIC_SITE_URL ?? "";
  if (!siteUrl) {
    if (isProduction) problems.push("NEXT_PUBLIC_SITE_URL");
    else siteUrl = "http://localhost:3000";
  }
  try {
    siteUrl = new URL(siteUrl).origin;
  } catch {
    problems.push("NEXT_PUBLIC_SITE_URL (not a URL)");
  }

  if (problems.length) {
    // Names only, never values.
    throw new AuthConfigError(problems);
  }

  return {
    isProduction,
    requireMfa: flag(env.REQUIRE_MFA, isProduction),
    turnstileSiteKey,
    turnstileSecretKey,
    supabaseVerifiesCaptcha: flag(env.SUPABASE_VERIFIES_CAPTCHA, false),
    siteUrl,
    sessionSecret,
    loginMinMs: isProduction ? 900 : 300,
    signupMinMs: isProduction ? 900 : 300,
    demoMode: env.NEXT_PUBLIC_DEMO_MODE === "true",
  };
}
