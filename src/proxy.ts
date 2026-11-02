// Next 16 proxy (formerly middleware). Runs before every page: CSP nonce, session refresh,
// and the gate for /app and /mfa. Pages check the session again on the server.
import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { authConfig } from "@/lib/auth/server-config";
import { type CookieToSet, handleProxy, type ProxyAuth } from "@/lib/security/proxy-handler";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

function supabaseProxyAuth(request: NextRequest): ProxyAuth {
  const pending = new Map<string, CookieToSet>();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) {
          request.cookies.set(name, value);
          pending.set(name, { name, value, options: { ...options, ...AUTH_COOKIE_OPTIONS } });
        }
      },
    },
  });
  return {
    async getUser() {
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
      const { data, error } = await supabase.auth.getUser();
      return error || !data.user ? null : { id: data.user.id };
    },
    async signOut() {
      await supabase.auth.signOut({ scope: "local" });
    },
    pendingCookies: () => [...pending.values()],
  };
}

export async function proxy(request: NextRequest) {
  const config = authConfig();
  return handleProxy(request, {
    createAuth: supabaseProxyAuth,
    sessionSecret: config.sessionSecret,
    now: () => Date.now(),
    dev: process.env.NODE_ENV !== "production",
    secureCookies: config.isProduction,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
}

export const config = {
  matcher: [
    {
      // Pages only: not API routes, build assets, or files from /public.
      source: "/((?!api/|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
