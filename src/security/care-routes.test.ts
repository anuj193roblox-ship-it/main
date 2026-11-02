// Stage S3 route handlers (onboarding, vault, plan): every state-changing handler rejects cross-site
// requests before anything runs, and signed-out, unverified or household-less callers get no data.
// The real session code runs against a fake Supabase Auth; any data access is a test failure.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_ACCESS_MESSAGES } from "@/lib/auth/access";
import { signActivity } from "@/lib/auth/activity";
import { readAuthConfig } from "@/lib/auth/config";
import { ACTIVITY_COOKIE } from "@/lib/auth/session-timing";

const dataCalls: string[] = [];
const fake: {
  user: { id: string; email: string | null; email_confirmed_at: string | null } | null;
  profile: { household_id: string; role: string } | null;
  activity?: string;
  supabaseCalls: number;
} = { user: null, profile: null, supabaseCalls: 0 };

vi.mock("@/lib/supabase/server", () => ({
  AUTH_COOKIE_OPTIONS: {},
  createSupabaseServerClient: async () => {
    fake.supabaseCalls++;
    return {
      auth: {
        getUser: async () => ({ data: { user: fake.user }, error: fake.user ? null : { message: "no session" } }),
        mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }) },
      },
      from: (table: string) => {
        if (table !== "users") dataCalls.push(table);
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fake.profile, error: null }) }) }) };
      },
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

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ID = "11111111-1111-4111-8111-111111111111";

const HANDLERS: { name: string; params: Record<string, string>; load: () => Promise<Handler> }[] = [
  { name: "POST /api/onboarding/patient", params: {}, load: async () => (await import("@/app/api/onboarding/patient/route")).POST as unknown as Handler },
  { name: "POST /api/onboarding/consent", params: {}, load: async () => (await import("@/app/api/onboarding/consent/route")).POST as unknown as Handler },
  { name: "POST /api/onboarding/contacts", params: {}, load: async () => (await import("@/app/api/onboarding/contacts/route")).POST as unknown as Handler },
  { name: "POST /api/onboarding/activate", params: {}, load: async () => (await import("@/app/api/onboarding/activate/route")).POST as unknown as Handler },
  { name: "POST /api/vault/medications", params: { kind: "medications" }, load: async () => (await import("@/app/api/vault/[kind]/route")).POST as unknown as Handler },
  { name: "PATCH /api/vault/medications/:id", params: { kind: "medications", id: ID }, load: async () => (await import("@/app/api/vault/[kind]/[id]/route")).PATCH as unknown as Handler },
  { name: "DELETE /api/vault/conditions/:id", params: { kind: "conditions", id: ID }, load: async () => (await import("@/app/api/vault/[kind]/[id]/route")).DELETE as unknown as Handler },
  { name: "POST /api/vault/medications/:id/approve", params: { kind: "medications", id: ID, action: "approve" }, load: async () => (await import("@/app/api/vault/[kind]/[id]/[action]/route")).POST as unknown as Handler },
  { name: "POST /api/vault/medications/:id/verify", params: { kind: "medications", id: ID, action: "verify" }, load: async () => (await import("@/app/api/vault/[kind]/[id]/[action]/route")).POST as unknown as Handler },
  { name: "POST /api/plan", params: {}, load: async () => (await import("@/app/api/plan/route")).POST as unknown as Handler },
  { name: "POST /api/plan/items", params: {}, load: async () => (await import("@/app/api/plan/items/route")).POST as unknown as Handler },
  { name: "PATCH /api/plan/items/:id", params: { id: ID }, load: async () => (await import("@/app/api/plan/items/[id]/route")).PATCH as unknown as Handler },
  { name: "DELETE /api/plan/items/:id", params: { id: ID }, load: async () => (await import("@/app/api/plan/items/[id]/route")).DELETE as unknown as Handler },
  { name: "POST /api/plan/review/:id", params: { id: ID }, load: async () => (await import("@/app/api/plan/review/[id]/route")).POST as unknown as Handler },
];

function request(name: string, origin: string | null, extra: Record<string, string> = {}) {
  const [method] = name.split(" ");
  const headers: Record<string, string> = { "content-type": "application/json", ...extra };
  if (origin) headers.origin = origin;
  return new Request("http://localhost:3000/api/x", { method, headers, body: JSON.stringify({ household_id: "h-other", role: "admin" }) });
}

async function call(h: (typeof HANDLERS)[number], origin: string | null, extra?: Record<string, string>) {
  const handler = await h.load();
  return handler(request(h.name, origin, extra), { params: Promise.resolve(h.params) });
}

beforeEach(() => {
  dataCalls.length = 0;
  fake.user = null;
  fake.profile = null;
  fake.activity = undefined;
  fake.supabaseCalls = 0;
});

async function signIn(verified: boolean, role: string | null) {
  fake.user = { id: "u1", email: "x@example.com", email_confirmed_at: verified ? "2026-01-01T00:00:00Z" : null };
  fake.profile = role ? { household_id: "h1", role } : null;
  fake.activity = await signActivity("u1", Date.now(), readAuthConfig(process.env).sessionSecret);
}

describe("S3 routes: Origin check comes first", () => {
  it.each(HANDLERS.map((h) => [h.name, h] as const))("%s rejects a cross-site request", async (_name, h) => {
    for (const [origin, extra] of [
      ["https://evil.example", { "sec-fetch-site": "cross-site" }],
      ["https://evil.example", {}],
      [null, {}],
    ] as const) {
      const res = await call(h, origin, extra);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "This request was blocked." });
    }
    expect(fake.supabaseCalls).toBe(0);
    expect(dataCalls).toEqual([]);
  });
});

describe("S3 routes: no data without a verified household member", () => {
  it.each(HANDLERS.map((h) => [h.name, h] as const))("%s: signed out gets 401 and touches no data", async (_name, h) => {
    const res = await call(h, "http://localhost:3000");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: API_ACCESS_MESSAGES.signed_out });
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(dataCalls).toEqual([]);
  });

  it("an unverified email gets 403 on every S3 route", async () => {
    await signIn(false, "family");
    for (const h of HANDLERS) {
      const res = await call(h, "http://localhost:3000");
      expect(res.status, h.name).toBe(403);
    }
    expect(dataCalls).toEqual([]);
  });

  it("a verified user with no household gets 403 on every S3 route", async () => {
    await signIn(true, null);
    for (const h of HANDLERS) {
      const res = await call(h, "http://localhost:3000");
      expect(res.status, h.name).toBe(403);
      expect(await res.json()).toEqual({ error: API_ACCESS_MESSAGES.no_household });
    }
    expect(dataCalls).toEqual([]);
  });
});
