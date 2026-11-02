// The failure seen in development: migration 0002 not applied, so Supabase answers the
// check_rate_limit call with PGRST202 and login says "Something went wrong on our side".
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryAuditLogger } from "./audit";
import { createTurnstilePolicy } from "./captcha";
import { AuthConfigError, readAuthConfig } from "./config";
import { AuthStepError, formatAuthStepLog, logAuthStep, safeCode } from "./dev-log";
import { createDbRateLimiter } from "./rate-limit";
import { SOMETHING_WRONG } from "./services/result";
import { login } from "./services/login";

/** A Supabase client whose RPCs fail the way an unapplied migration does. */
/**
 * A fake Supabase client. rpc() answers like PostgREST; from("invites") is the probe that tells
 * "0002 never ran" from "0002 ran but the API cache is stale". selectOptions records how it was read.
 */
function fakeClient(opts: {
  rpc: { status: number; error: { code: string; message: string } | null; data?: unknown };
  invitesTable: boolean;
  calls?: string[];
  selectOptions?: unknown[];
}) {
  return {
    rpc: async (fn: string) => {
      opts.calls?.push(fn);
      return { data: opts.rpc.data ?? null, error: opts.rpc.error, status: opts.rpc.status };
    },
    from: (table: string) => ({
      select: (_cols: string, options?: unknown) => {
        opts.selectOptions?.push(options);
        return {
          limit: async () =>
            table === "invites" && opts.invitesTable
              ? { data: [], error: null, status: 200 }
              : { data: null, error: { code: "PGRST205", message: "Could not find the table" }, status: 404 },
        };
      },
    }),
  } as unknown as SupabaseClient;
}

const PGRST202 = { status: 404, error: { code: "PGRST202", message: "Could not find the function public.check_rate_limit in the schema cache" } };

function missingFunctionClient(calls: string[]) {
  return fakeClient({ rpc: PGRST202, invitesTable: false, calls });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rate-limit function missing (PGRST202)", () => {
  it("the database limiter throws a rate-limit step error carrying only the code", async () => {
    const calls: string[] = [];
    const failures: string[] = [];
    const limiter = createDbRateLimiter(missingFunctionClient(calls), (code) => failures.push(code));
    const err = await limiter.hit("key", { limit: 5, windowSeconds: 60 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthStepError);
    expect(err).toMatchObject({ step: "rate-limit", code: "PGRST202" });
    expect(failures).toEqual(["PGRST202"]);
    expect(calls).toEqual(["check_rate_limit"]);
  });

  it("login fails closed with the generic message and never tries the password", async () => {
    let signInCalled = false;
    const failures: string[] = [];
    const res = await login(
      { email: "meera.family@example.com", password: "whatever password", captchaToken: "tok" },
      { ip: "1.2.3.4" },
      {
        limiter: createDbRateLimiter(missingFunctionClient([]), (code) => failures.push(code)),
        captcha: { forwardToSupabase: false, verify: async () => true },
        audit: createMemoryAuditLogger(),
        householdOf: async () => null,
        minMs: 0,
        signInWithPassword: async () => {
          signInCalled = true;
          return { userId: "u1" };
        },
      },
    );
    expect(res).toEqual({ status: 503, body: { error: SOMETHING_WRONG } });
    expect(signInCalled).toBe(false);
    expect(failures).toEqual(["PGRST202"]);
  });

  it("tells 'migration never ran' apart from 'API cache is stale'", async () => {
    const failures: [string, string | undefined][] = [];
    const run = (invitesTable: boolean) =>
      createDbRateLimiter(fakeClient({ rpc: PGRST202, invitesTable }), (code, detail) => failures.push([code, detail]))
        .hit("k", { limit: 1, windowSeconds: 1 })
        .catch(() => undefined);
    await run(false);
    await run(true);
    expect(failures).toEqual([
      ["PGRST202", "migration-0002-missing"],
      ["PGRST202", "schema-cache-stale"],
    ]);
  });

  it("the probe is a real read, not a HEAD request (supabase-js reports a HEAD 404 as success)", async () => {
    const selectOptions: unknown[] = [];
    await createDbRateLimiter(fakeClient({ rpc: PGRST202, invitesTable: false, selectOptions }))
      .hit("k", { limit: 1, windowSeconds: 1 })
      .catch(() => undefined);
    expect(selectOptions).toEqual([undefined]);
  });

  it("a wrong service-role key and a wrong Supabase URL get their own codes", async () => {
    const failures: string[] = [];
    const run = (status: number, error: { code: string; message: string } | null) =>
      createDbRateLimiter(fakeClient({ rpc: { status, error }, invitesTable: true }), (code) => failures.push(code))
        .hit("k", { limit: 1, windowSeconds: 1 })
        .catch(() => undefined);
    await run(401, { code: "", message: "Invalid API key" });
    await run(0, { code: "", message: "TypeError: fetch failed" });
    expect(failures).toEqual(["invalid-api-key", "network-error"]);
  });

  it("the development log names the step and says what to do, with no personal data", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    logAuthStep("/api/auth/login", "rate-limit", "PGRST202", { detail: "migration-0002-missing", env: "development" });
    expect(warn).toHaveBeenCalledWith(
      "[auth] /api/auth/login: rate-limit failed (PGRST202, migration-0002-missing) - migration 0002 is not in the database: run supabase/migrations/0002_auth.sql in the Supabase SQL editor",
    );
  });
});

describe("development step log", () => {
  it("is silent in production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    logAuthStep("/api/auth/login", "rate-limit", "PGRST202", { env: "production" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops anything that is not a short machine code (emails, tokens, messages)", () => {
    expect(safeCode("meera@example.com")).toBeUndefined();
    expect(safeCode("Could not find the function")).toBeUndefined();
    expect(safeCode("a".repeat(41))).toBeUndefined();
    expect(safeCode(undefined)).toBeUndefined();
    expect(formatAuthStepLog("/api/auth/login", "supabase", "someone@example.com")).toBe("[auth] /api/auth/login: supabase failed");
    expect(formatAuthStepLog("/api/auth/login", "supabase", "invalid_credentials")).toBe("[auth] /api/auth/login: supabase failed (invalid_credentials)");
  });

  it("Turnstile failures report Cloudflare's error code, never the token or secret", async () => {
    const codes: string[] = [];
    const policy = createTurnstilePolicy(
      "the-secret",
      false,
      (async () => new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-secret"] }))) as unknown as typeof fetch,
      (code) => codes.push(code),
    );
    expect(await policy.verify("the-token", "1.2.3.4")).toBe(false);
    expect(codes).toEqual(["invalid-input-secret"]);
    expect(formatAuthStepLog("/api/auth/login", "turnstile", codes[0])).not.toMatch(/the-secret|the-token/);
  });

  it("a missing session secret in production is reported by name only", () => {
    let error: unknown;
    try {
      readAuthConfig({
        NODE_ENV: "production",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "s",
        TURNSTILE_SECRET_KEY: "k",
        NEXT_PUBLIC_SITE_URL: "https://nurra.example",
        AUTH_SESSION_SECRET: "too-short-value",
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AuthConfigError);
    expect((error as AuthConfigError).settings).toEqual(["AUTH_SESSION_SECRET"]);
    expect(formatAuthStepLog("/api/auth/login", "session-secret", "AUTH_SESSION_SECRET")).not.toContain("too-short-value");
  });
});

describe("migration 0002", () => {
  it("tells the Supabase API to reload its schema, so the new functions are found at once", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/0002_auth.sql", "utf8");
    expect(sql.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});
