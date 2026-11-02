import "server-only";
import { type AuthConfig, AuthConfigError, readAuthConfig } from "./config";
import { logAuthStep } from "./dev-log";

let cached: AuthConfig | null = null;
let warnedShortSecret = false;

/** Auth settings for this process. Throws (fails closed) if production settings are missing. */
export function authConfig(route = "auth"): AuthConfig {
  if (cached) return cached;
  try {
    cached = readAuthConfig(process.env);
  } catch (e) {
    if (e instanceof AuthConfigError) {
      for (const name of e.settings) {
        if (name === "AUTH_SESSION_SECRET") logAuthStep(route, "session-secret", name);
        else if (name.includes("TURNSTILE")) logAuthStep(route, "turnstile", name);
      }
    }
    throw e;
  }
  // Development falls back to a built-in secret if AUTH_SESSION_SECRET is set but too short.
  const configured = process.env.AUTH_SESSION_SECRET ?? "";
  if (!warnedShortSecret && configured.length > 0 && configured.length < 32) {
    warnedShortSecret = true;
    logAuthStep(route, "session-secret", "too-short-using-dev-fallback");
  }
  return cached;
}
