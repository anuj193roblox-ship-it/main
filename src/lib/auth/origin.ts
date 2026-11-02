// CSRF protection for route handlers that change state: the request must come from our own origin.

/**
 * True when a state-changing request comes from this site.
 * Browsers always send Origin on POST. A missing or foreign Origin is rejected, and so is a
 * Sec-Fetch-Site other than "same-origin" when the browser sends one.
 */
export function isSameOriginRequest(request: Request, extraAllowedOrigins: string[] = []): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;

  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;

  let own: string;
  try {
    own = new URL(request.url).origin;
  } catch {
    return false;
  }
  return origin === own || extraAllowedOrigins.includes(origin);
}
