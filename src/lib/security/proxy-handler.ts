// What proxy.ts does on every page request, with its Supabase calls injected so it can be tested.
import { NextRequest, NextResponse } from "next/server";
import { isActivityValid, signActivity } from "@/lib/auth/activity";
import { loginPath } from "@/lib/auth/next-path";
import { ACTIVITY_COOKIE } from "@/lib/auth/session-timing";
import { randomNonce } from "@/lib/auth/tokens";
import { buildCsp } from "./csp";

export type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

/** A Supabase session bound to one request. Cookie changes are collected, not applied. */
export type ProxyAuth = {
  getUser(): Promise<{ id: string } | null>;
  signOut(): Promise<void>;
  pendingCookies(): CookieToSet[];
};

export type ProxyDeps = {
  createAuth(request: NextRequest): ProxyAuth;
  sessionSecret: string;
  now(): number;
  dev: boolean;
  secureCookies: boolean;
  supabaseUrl?: string;
};

export function isProtectedPath(pathname: string): boolean {
  return ["/app", "/mfa", "/onboarding"].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const NO_STORE = "private, no-store, max-age=0";

export async function handleProxy(request: NextRequest, deps: ProxyDeps): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const nonce = randomNonce();
  const csp = buildCsp({ nonce, dev: deps.dev, supabaseUrl: deps.supabaseUrl });

  // Refresh the session first: refreshed cookies are written into the request, so the page
  // rendered after this sees the new tokens.
  const auth = deps.createAuth(request);
  const user = await auth.getUser();
  const protectedPath = isProtectedPath(pathname);

  const activityCookie = { httpOnly: true, secure: deps.secureCookies, sameSite: "lax" as const, path: "/", maxAge: 12 * 60 * 60 };

  if (protectedPath) {
    if (!user) return redirectTo(request, loginPath(pathname), auth.pendingCookies(), csp);

    const active = await isActivityValid(request.cookies.get(ACTIVITY_COOKIE)?.value, user.id, deps.now(), deps.sessionSecret);
    if (!active) {
      // 30 minutes without activity: end the session on the server, then send to login.
      await auth.signOut();
      const response = redirectTo(request, loginPath(pathname, "timeout"), auth.pendingCookies(), csp);
      response.cookies.set(ACTIVITY_COOKIE, "", { ...activityCookie, maxAge: 0 });
      return response;
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const c of auth.pendingCookies()) response.cookies.set(c.name, c.value, c.options);
  response.headers.set("Content-Security-Policy", csp);

  if (protectedPath && user) {
    response.cookies.set(ACTIVITY_COOKIE, await signActivity(user.id, deps.now(), deps.sessionSecret), activityCookie);
    response.headers.set("Cache-Control", NO_STORE);
  }
  return response;
}

function redirectTo(request: NextRequest, path: string, cookies: CookieToSet[], csp: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url), 307);
  for (const c of cookies) response.cookies.set(c.name, c.value, c.options);
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", NO_STORE);
  return response;
}
