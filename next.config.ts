import type { NextConfig } from "next";

// Security headers on every response (spec PLAT-3). The page Content-Security-Policy carries a
// per-request nonce, so it is set in src/proxy.ts; API responses get a deny-all CSP here.
export const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone for Nurra's voice (our own origin only). Never the camera.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const noStore = [{ key: "Cache-Control", value: "private, no-store, max-age=0" }];

// Signed-in and token-bearing pages must never be stored by browsers or shared caches.
export const noStorePaths = ["/app", "/app/:path*", "/onboarding/:path*", "/patient", "/patient/:path*", "/mfa/:path*", "/auth/:path*", "/reset-password", "/invite/:path*", "/api/:path*"];

const nextConfig: NextConfig = {
  // Must stay off: private pages must never be cached on the server (AGENTS.md).
  cacheComponents: false,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }] },
      ...noStorePaths.map((source) => ({ source, headers: noStore })),
    ];
  },
};

export default nextConfig;
