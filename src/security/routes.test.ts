// Every new route handler: cross-site POSTs are blocked before anything runs, and signed-out
// requests get a 401 with no data. Supabase and the service-role client are replaced by
// tripwires that fail the test if a blocked request ever reaches them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_ACCESS_MESSAGES } from "@/lib/auth/access";
import { signActivity } from "@/lib/auth/activity";
import { readAuthConfig } from "@/lib/auth/config";
import { ACTIVITY_COOKIE } from "@/lib/auth/session-timing";

// "touched" records any use of the service-role path (where household data lives).
const touched: string[] = [];
// What the fake Supabase Auth reports. The real session code (getSessionState, requireApiAccess) runs.
const fake: {
  user: { id: string; email: string | null; email_confirmed_at: string | null } | null;
  profile: { household_id: string; role: string } | null;
  aal: { currentLevel: string; nextLevel: string };
  activity?: string;
  supabaseCalls: number;
} = { user: null, profile: null, aal: { currentLevel: "aal1", nextLevel: "aal1" }, supabaseCalls: 0 };

vi.mock("@/lib/auth/deps", () => ({
  serverDeps: () => {
    touched.push("serverDeps");
    throw new Error("serverDeps must not be reached");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  AUTH_COOKIE_OPTIONS: {},
  createSupabaseServerClient: async () => {
    fake.supabaseCalls++;
    return {
      auth: {
        getUser: async () => ({ data: { user: fake.user }, error: fake.user ? null : { message: "no session" } }),
        signOut: async () => ({ error: null }),
        mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: fake.aal, error: null }) },
      },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fake.profile, error: null }) }) }) }),
    };
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === ACTIVITY_COOKIE && fake.activity ? { name, value: fake.activity } : undefined),
    set: () => undefined,
    delete: () => undefined,
    getAll: () => [],
  }),
}));

async function signInAs(opts: { verified: boolean; role?: string; aal?: { currentLevel: string; nextLevel: string } }) {
  fake.user = { id: "u1", email: "x@example.com", email_confirmed_at: opts.verified ? "2026-01-01T00:00:00Z" : null };
  fake.profile = opts.role ? { household_id: "h1", role: opts.role } : null;
  fake.aal = opts.aal ?? { currentLevel: "aal1", nextLevel: "aal1" };
  fake.activity = await signActivity("u1", Date.now(), readAuthConfig(process.env).sessionSecret);
}

const ROUTES = {
  "/api/auth/login": () => import("@/app/api/auth/login/route"),
  "/api/auth/signup": () => import("@/app/api/auth/signup/route"),
  "/api/auth/forgot-password": () => import("@/app/api/auth/forgot-password/route"),
  "/api/auth/resend": () => import("@/app/api/auth/resend/route"),
  "/api/auth/reset-password": () => import("@/app/api/auth/reset-password/route"),
  "/api/auth/logout": () => import("@/app/api/auth/logout/route"),
  "/api/auth/activity": () => import("@/app/api/auth/activity/route"),
  "/api/auth/mfa/enroll": () => import("@/app/api/auth/mfa/enroll/route"),
  "/api/auth/mfa/verify": () => import("@/app/api/auth/mfa/verify/route"),
  "/api/invites": () => import("@/app/api/invites/route"),
  "/api/invites/accept": () => import("@/app/api/invites/accept/route"),
  "/api/household/create": () => import("@/app/api/household/create/route"),
  "/api/household/claim-demo": () => import("@/app/api/household/claim-demo/route"),
} as const;

// Routes that need a signed-in user.
const SIGNED_IN_ROUTES = [
  "/api/auth/reset-password",
  "/api/auth/activity",
  "/api/auth/mfa/enroll",
  "/api/auth/mfa/verify",
  "/api/invites",
  "/api/invites/accept",
  "/api/household/create",
  "/api/household/claim-demo",
] as const;

function post(path: string, origin: string | null, body: unknown = {}, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...extra };
  if (origin) headers.origin = origin;
  return new Request(`http://localhost:3000${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  touched.length = 0;
  fake.user = null;
  fake.profile = null;
  fake.activity = undefined;
  fake.supabaseCalls = 0;
});

describe("Origin check on every state-changing route", () => {
  it.each(Object.keys(ROUTES))("%s rejects a cross-site POST before doing anything", async (path) => {
    const { POST } = await ROUTES[path as keyof typeof ROUTES]();
    for (const req of [
      post(path, "https://evil.example", { email: "a@b.c" }, { "sec-fetch-site": "cross-site" }),
      post(path, "https://evil.example"),
      post(path, null),
    ]) {
      const res = await POST(req as never);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "This request was blocked." });
    }
    expect(touched).toEqual([]);
    expect(fake.supabaseCalls).toBe(0);
  });
});

describe("signed-out requests to API routes get no data", () => {
  it.each(SIGNED_IN_ROUTES)("%s answers 401 with only a generic message", async (path) => {
    const { POST } = await ROUTES[path]();
    const res = await POST(post(path, "http://localhost:3000", { role: "clinician", token: "x", displayName: "x" }) as never);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: API_ACCESS_MESSAGES.signed_out });
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(touched).toEqual([]);
  });

  it("a signed-in user with an unverified email gets 403 and nothing else", async () => {
    await signInAs({ verified: false });
    for (const path of SIGNED_IN_ROUTES) {
      const { POST } = await ROUTES[path]();
      const res = await POST(post(path, "http://localhost:3000") as never);
      expect(res.status, path).toBe(403);
      expect(await res.json()).toEqual({ error: API_ACCESS_MESSAGES.email_unverified });
    }
    expect(touched).toEqual([]);
  });

  it("an admin who has not done two-step sign-in cannot create invites", async () => {
    await signInAs({ verified: true, role: "admin", aal: { currentLevel: "aal1", nextLevel: "aal2" } });
    const { POST } = await ROUTES["/api/invites"]();
    const res = await POST(post("/api/invites", "http://localhost:3000", { role: "clinician" }) as never);
    expect(res.status).toBe(403);
    expect(touched).toEqual([]);
  });

  it("a signed-in user whose activity cookie expired is treated as signed out", async () => {
    await signInAs({ verified: true, role: "family" });
    fake.activity = undefined;
    const { POST } = await ROUTES["/api/invites/accept"]();
    const res = await POST(post("/api/invites/accept", "http://localhost:3000") as never);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: API_ACCESS_MESSAGES.inactive });
    expect(touched).toEqual([]);
  });

  it("logout while signed out does nothing harmful and returns no data", async () => {
    const { POST } = await ROUTES["/api/auth/logout"]();
    const res = await POST(post("/api/auth/logout", "http://localhost:3000") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
