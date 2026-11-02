import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { signActivity } from "@/lib/auth/activity";
import { ACTIVITY_COOKIE, INACTIVITY_LIMIT_MS } from "@/lib/auth/session-timing";
import { type CookieToSet, handleProxy, type ProxyDeps } from "./proxy-handler";

const secret = "p".repeat(40);
const NOW = 1_800_000_000_000;

function fakeDeps(user: { id: string } | null, refreshed: CookieToSet[] = []) {
  const calls = { signOut: 0 };
  const pending = [...refreshed];
  const deps: ProxyDeps = {
    createAuth: () => ({
      getUser: async () => user,
      signOut: async () => {
        calls.signOut++;
        pending.push({ name: "sb-test-auth-token", value: "", options: { maxAge: 0, path: "/" } });
      },
      pendingCookies: () => pending,
    }),
    sessionSecret: secret,
    now: () => NOW,
    dev: false,
    secureCookies: true,
    supabaseUrl: "https://abc.supabase.co",
  };
  return { deps, calls };
}

const req = (path: string, cookies: Record<string, string> = {}) => {
  const r = new NextRequest(`http://localhost:3000${path}`);
  for (const [k, v] of Object.entries(cookies)) r.cookies.set(k, v);
  return r;
};

describe("proxy gate for /app", () => {
  it("signed-out requests to /app get a redirect to login and no page", async () => {
    const { deps } = fakeDeps(null);
    const res = await handleProxy(req("/app/today"), deps);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fapp%2Ftoday");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-middleware-next")).toBeNull();
    expect(await res.text()).toBe("");
  });

  it.each(["/app", "/app/secret-thing", "/mfa/verify", "/app/vault", "/app/plan", "/onboarding/patient", "/onboarding/review"])("signed-out %s is redirected with an allowlisted next", async (path) => {
    const { deps } = fakeDeps(null);
    const res = await handleProxy(req(path), deps);
    expect(res.status).toBe(307);
    const next = new URL(res.headers.get("location")!).searchParams.get("next");
    expect(next).toBe(["/app", "/app/secret-thing"].includes(path) ? "/app/today" : path);
  });

  it("30 minutes without activity ends the session on the server and redirects", async () => {
    const { deps, calls } = fakeDeps({ id: "u1" });
    const stale = await signActivity("u1", NOW - INACTIVITY_LIMIT_MS - 1, secret);
    const res = await handleProxy(req("/app/today", { [ACTIVITY_COOKIE]: stale }), deps);
    expect(calls.signOut).toBe(1);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fapp%2Ftoday&reason=timeout");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sb-test-auth-token=;");
    expect(setCookie).toMatch(new RegExp(`${ACTIVITY_COOKIE}=;`));
  });

  it("a missing or forged activity cookie counts as inactive", async () => {
    for (const value of [undefined, "1800000000000.deadbeef", await signActivity("someone-else", NOW, secret)]) {
      const { deps, calls } = fakeDeps({ id: "u1" });
      const res = await handleProxy(req("/app/today", value ? { [ACTIVITY_COOKIE]: value } : {}), deps);
      expect(res.status).toBe(307);
      expect(calls.signOut).toBe(1);
    }
  });

  it("an active signed-in user passes, with no-store and a refreshed httpOnly activity cookie", async () => {
    const { deps } = fakeDeps({ id: "u1" }, [{ name: "sb-test-auth-token", value: "new", options: { httpOnly: true, path: "/" } }]);
    const fresh = await signActivity("u1", NOW - 60_000, secret);
    const res = await handleProxy(req("/app/today", { [ACTIVITY_COOKIE]: fresh }), deps);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sb-test-auth-token=new");
    expect(setCookie).toMatch(new RegExp(`${ACTIVITY_COOKIE}=a%3Au1%3A${NOW}\\.`));
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
  });
});

describe("CSP on every page", () => {
  it("public pages get a nonce CSP and are not redirected", async () => {
    const { deps } = fakeDeps(null);
    const res = await handleProxy(req("/"), deps);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9_-]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("the nonce is new for every request", async () => {
    const { deps } = fakeDeps(null);
    const a = (await handleProxy(req("/login"), deps)).headers.get("content-security-policy");
    const b = (await handleProxy(req("/login"), deps)).headers.get("content-security-policy");
    expect(a).not.toBe(b);
  });
});
