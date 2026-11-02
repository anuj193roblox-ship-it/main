// Open-redirect protection: "next" may only be one of these internal paths.

export const DEFAULT_NEXT_PATH = "/app/today";

const ALLOWED_PATHS = new Set([
  "/app/today",
  "/app/account",
  "/app/start",
  "/mfa/enroll",
  "/mfa/verify",
  "/reset-password",
]);

/** Invite tokens are 32 random bytes, base64url: exactly 43 characters. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INVITE_PATH = /^\/invite\/[A-Za-z0-9_-]{43}$/;

/**
 * Returns a safe internal path for a redirect. Anything that is not on the allowlist, points to
 * another origin, or looks odd becomes the default. Query strings and fragments are dropped.
 *
 * @param siteOrigin when given, absolute URLs on exactly this origin are accepted (email links).
 */
export function safeNextPath(input: unknown, siteOrigin?: string): string {
  if (typeof input !== "string" || input.length === 0 || input.length > 300) return DEFAULT_NEXT_PATH;
  // Control characters and backslashes are used to confuse URL parsers ("/\evil.example").
  if (/[\u0000-\u001f\u007f\\]/.test(input)) return DEFAULT_NEXT_PATH;

  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(input);
  if (isAbsolute && !siteOrigin) return DEFAULT_NEXT_PATH;
  if (!isAbsolute && (!input.startsWith("/") || input.startsWith("//"))) return DEFAULT_NEXT_PATH;

  const base = siteOrigin ?? "http://nurra.invalid";
  let url: URL;
  try {
    url = new URL(input, base);
  } catch {
    return DEFAULT_NEXT_PATH;
  }
  if (url.origin !== new URL(base).origin) return DEFAULT_NEXT_PATH;

  const path = url.pathname;
  if (ALLOWED_PATHS.has(path) || INVITE_PATH.test(path)) return path;
  return DEFAULT_NEXT_PATH;
}

/** /login link that returns to a safe path. */
export function loginPath(next: unknown, reason?: "timeout" | "link"): string {
  const params = new URLSearchParams({ next: safeNextPath(next) });
  if (reason) params.set("reason", reason);
  return `/login?${params.toString()}`;
}
