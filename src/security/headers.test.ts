import { describe, expect, it } from "vitest";
import { buildCsp } from "@/lib/security/csp";
import nextConfig from "../../next.config";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<HeaderRule[]> {
  return (await nextConfig.headers!()) as HeaderRule[];
}

function headersFor(all: HeaderRule[], source: string): Record<string, string> {
  return Object.fromEntries(all.filter((r) => r.source === source).flatMap((r) => r.headers.map((h) => [h.key, h.value])));
}

describe("security headers (next.config)", () => {
  it("every response gets HSTS, nosniff, Referrer-Policy, Permissions-Policy and framing protection", async () => {
    const h = headersFor(await rules(), "/:path*");
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d{8}; includeSubDomains/);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("microphone=(self)");
    expect(h["Permissions-Policy"]).toContain("camera=()");
    expect(h["X-Frame-Options"]).toBe("DENY");
  });

  it.each(["/app", "/app/:path*", "/onboarding/:path*", "/mfa/:path*", "/auth/:path*", "/reset-password", "/invite/:path*", "/api/:path*"])(
    "%s responses are no-store",
    async (source) => {
      expect(headersFor(await rules(), source)["Cache-Control"]).toContain("no-store");
    },
  );

  it("API responses get a deny-all CSP", async () => {
    expect(headersFor(await rules(), "/api/:path*")["Content-Security-Policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it("does not advertise the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

describe("page CSP (set by the proxy)", () => {
  const csp = buildCsp({ nonce: "abc123", dev: false, supabaseUrl: "https://xyz.supabase.co" });
  const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

  it("allows Supabase, Turnstile and self-hosted fonts only", () => {
    expect(directive("connect-src")).toBe("connect-src 'self' https://xyz.supabase.co wss://xyz.supabase.co https://challenges.cloudflare.com");
    expect(directive("frame-src")).toBe("frame-src https://challenges.cloudflare.com");
    expect(directive("font-src")).toBe("font-src 'self'");
    expect(directive("script-src")).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic' https://challenges.cloudflare.com");
  });

  it("has no unsafe-inline or unsafe-eval in production, and blocks framing and plugins", () => {
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });
});
