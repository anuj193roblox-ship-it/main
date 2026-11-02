/**
 * Best-effort client IP for rate limiting. On Vercel these headers are set by the platform.
 * Elsewhere they can be spoofed, which is why every limit also has a per-account or per-email key.
 */
export function getClientIp(headers: Headers): string {
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}
