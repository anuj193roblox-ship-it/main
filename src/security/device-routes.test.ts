// Stage S4 routes. A device token and a family session are separate worlds:
//   - every state-changing route rejects cross-site requests first
//   - device routes need a valid device token; a family session alone gets nothing
//   - family routes need a family session; a device token alone gets nothing
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_ACCESS_MESSAGES } from "@/lib/auth/access";
import { DEVICE_COOKIE } from "@/lib/patient/device";
import { NOT_PAIRED } from "@/lib/patient/server";

const VALID = "valid-device-token-0123456789abcdef";
const REVOKED = "revoked-device-token-0123456789abcd";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const state: { cookies: Record<string, string>; familyUser: boolean; dataCalls: string[]; modelCalls: number } = {
  cookies: {},
  familyUser: false,
  dataCalls: [],
  modelCalls: 0,
};

// The service-role client, faked with just the device_tokens table. Any other table is a data access.
const tokens = [
  { id: "d1", token_hash: sha(VALID), patient_id: "p1", household_id: "h1", scope: ["checkin", "confirm"], expires_at: "2999-01-01T00:00:00+00:00", revoked_at: null },
  { id: "d2", token_hash: sha(REVOKED), patient_id: "p1", household_id: "h1", scope: ["checkin", "confirm"], expires_at: "2999-01-01T00:00:00+00:00", revoked_at: "2026-01-01T00:00:00+00:00" },
];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "device_tokens") state.dataCalls.push(table);
      const rows = table === "device_tokens" ? tokens : [];
      const result = (w: Record<string, unknown>) => ({
        data: rows.filter((r) => Object.entries(w).every(([k, v]) => (r as Record<string, unknown>)[k] === v)),
        error: null,
      });
      return {
        select: () => ({ match: (w: Record<string, unknown>) => Object.assign(Promise.resolve(result(w)), { order: () => Promise.resolve(result(w)) }) }),
        update: () => ({ match: (w: Record<string, unknown>) => ({ select: () => Promise.resolve(result(w)) }) }),
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: {}, error: null }) }) }),
      };
    },
    rpc: async () => {
      state.dataCalls.push("rpc");
      return { data: [], error: null };
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  AUTH_COOKIE_OPTIONS: {},
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () =>
        state.familyUser
          ? { data: { user: { id: "u1", email: "f@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" } }, error: null }
          : { data: { user: null }, error: { message: "no session" } },
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }) },
    },
    from: (t: string) => {
      state.dataCalls.push(`session:${t}`);
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { household_id: "h1", role: "family" }, error: null }) }) }) };
    },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookies[name] ? { name, value: state.cookies[name] } : undefined),
    set: () => undefined,
    delete: () => undefined,
    getAll: () => [],
  }),
}));
vi.mock("@/lib/patient/model-anthropic", () => ({
  createAnthropicModel: () => ({
    reply: async () => {
      state.modelCalls++;
      throw new Error("must not be called");
    },
  }),
}));

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ROUTES: { name: string; params: Record<string, string>; load: () => Promise<Handler> }[] = [
  { name: "POST /api/checkin", params: {}, load: async () => (await import("@/app/api/checkin/route")).POST as unknown as Handler },
  { name: "POST /api/reminders/:id/confirm", params: { id: ID }, load: async () => (await import("@/app/api/reminders/[id]/confirm/route")).POST as unknown as Handler },
  { name: "POST /api/patient/call-family", params: {}, load: async () => (await import("@/app/api/patient/call-family/route")).POST as unknown as Handler },
  { name: "POST /api/patient/demo-reminder", params: {}, load: async () => (await import("@/app/api/patient/demo-reminder/route")).POST as unknown as Handler },
];
const OTHER_S4_ROUTES: typeof DEVICE_ROUTES = [
  { name: "POST /api/device/pair", params: {}, load: async () => (await import("@/app/api/device/pair/route")).POST as unknown as Handler },
  { name: "POST /api/devices/pairing", params: {}, load: async () => (await import("@/app/api/devices/pairing/route")).POST as unknown as Handler },
  { name: "POST /api/devices/:id/revoke", params: { id: ID }, load: async () => (await import("@/app/api/devices/[id]/revoke/route")).POST as unknown as Handler },
];
const FAMILY_ROUTES: typeof DEVICE_ROUTES = [
  { name: "POST /api/devices/pairing", params: {}, load: OTHER_S4_ROUTES[1].load },
  { name: "POST /api/devices/:id/revoke", params: { id: ID }, load: OTHER_S4_ROUTES[2].load },
  { name: "POST /api/vault/medications", params: { kind: "medications" }, load: async () => (await import("@/app/api/vault/[kind]/route")).POST as unknown as Handler },
  { name: "POST /api/plan/items", params: {}, load: async () => (await import("@/app/api/plan/items/route")).POST as unknown as Handler },
  { name: "POST /api/onboarding/activate", params: {}, load: async () => (await import("@/app/api/onboarding/activate/route")).POST as unknown as Handler },
  { name: "POST /api/invites", params: {}, load: async () => (await import("@/app/api/invites/route")).POST as unknown as Handler },
];

function call(h: (typeof DEVICE_ROUTES)[number], origin: string | null, body: unknown = { text: "chest pain", answer: "taken" }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return h.load().then((fn) => fn(new Request("http://localhost:3000/api/x", { method: "POST", headers, body: JSON.stringify(body) }), { params: Promise.resolve(h.params) }));
}

beforeEach(() => {
  state.cookies = {};
  state.familyUser = false;
  state.dataCalls = [];
  state.modelCalls = 0;
});

describe("S4 routes reject cross-site requests first", () => {
  it.each([...DEVICE_ROUTES, ...OTHER_S4_ROUTES].map((h) => [h.name, h] as const))("%s", async (_n, h) => {
    state.cookies[DEVICE_COOKIE] = VALID;
    state.familyUser = true;
    for (const origin of ["https://evil.example", null]) {
      const res = await call(h, origin);
      expect(res.status).toBe(403);
    }
    expect(state.dataCalls).toEqual([]);
    expect(state.modelCalls).toBe(0);
  });
});

describe("device routes need a valid device token", () => {
  it.each(DEVICE_ROUTES.map((h) => [h.name, h] as const))("%s: no token, a revoked token, a made-up token, or only a family session get 401", async (_n, h) => {
    for (const setup of [
      () => {},
      () => (state.cookies[DEVICE_COOKIE] = REVOKED),
      () => (state.cookies[DEVICE_COOKIE] = "x".repeat(40)),
      () => (state.familyUser = true),
    ]) {
      state.cookies = {};
      state.familyUser = false;
      setup();
      const res = await call(h, "http://localhost:3000");
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: NOT_PAIRED });
      expect(res.headers.get("cache-control")).toContain("no-store");
    }
    expect(state.dataCalls).toEqual([]);
    expect(state.modelCalls).toBe(0);
  });
});

describe("a device token never works on family routes", () => {
  it.each(FAMILY_ROUTES.map((h) => [h.name, h] as const))("%s with only a valid device token gets 401", async (_n, h) => {
    state.cookies[DEVICE_COOKIE] = VALID;
    const res = await call(h, "http://localhost:3000", { role: "clinician" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: API_ACCESS_MESSAGES.signed_out });
    expect(state.dataCalls.filter((c) => c !== "rpc")).toEqual([]);
  });
});
