import { describe, expect, it } from "vitest";
import { createMemoryAuditLogger } from "../audit";
import type { CaptchaPolicy } from "../captcha";
import { createMemoryRateLimiter, RATE_RULES } from "../rate-limit";
import { RESET_SENT, requestEmailLink } from "./password";
import { SIGNUP_SENT, signup, type SignupDeps } from "./signup";

const pass: CaptchaPolicy = { forwardToSupabase: false, verify: async () => true };
const existing = new Set(["anita@example.com"]);

type Call = { email: string; password: string; redirect: string; captcha?: string; args: number };

function deps(over: Partial<SignupDeps> = {}) {
  const calls: Call[] = [];
  const d: SignupDeps = {
    // Mimics Supabase: an existing email gets an error code, a new one does not.
    async signUp(...args: Parameters<SignupDeps["signUp"]>) {
      const [email, password, redirect, captcha] = args;
      calls.push({ email, password, redirect, captcha, args: args.length });
      return { errorCode: existing.has(email) ? "user_already_exists" : null };
    },
    limiter: createMemoryRateLimiter(),
    captcha: pass,
    audit: createMemoryAuditLogger(),
    siteUrl: "https://nurra.example",
    minMs: 0,
    ...over,
  };
  return { d, calls };
}

const good = { password: "a long enough password", captchaToken: "tok" };

describe("sign-up never reveals whether an email exists", () => {
  it("existing and new emails get the same status and body", async () => {
    const { d } = deps();
    const taken = await signup({ ...good, email: "anita@example.com" }, { ip: "1.1.1.1" }, d);
    const fresh = await signup({ ...good, email: "new.person@example.com" }, { ip: "1.1.1.1" }, d);
    expect(taken).toEqual(fresh);
    expect(fresh).toEqual({ status: 200, body: { message: SIGNUP_SENT } });
  });

  it("the timing is padded the same way for both", async () => {
    const { d } = deps({ minMs: 150 });
    const t = async (email: string) => {
      const s = performance.now();
      await signup({ ...good, email }, { ip: "2.2.2.2" }, d);
      return performance.now() - s;
    };
    const a = await t("anita@example.com");
    const b = await t("someone.else@example.com");
    expect(a).toBeGreaterThanOrEqual(145);
    expect(Math.abs(a - b)).toBeLessThan(40);
  });

  it("a password shorter than 12 characters is refused before anything is sent", async () => {
    const { d, calls } = deps();
    const res = await signup({ ...good, email: "x@example.com", password: "elevenchars" }, { ip: "1.1.1.1" }, d);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Use at least 12 characters.");
    expect(calls).toHaveLength(0);
  });
});

describe("sign-up ignores role and household from the client", () => {
  it("drops role, household_id and metadata: only email and password reach Supabase", async () => {
    const { d, calls } = deps();
    const res = await signup(
      {
        ...good,
        email: "sneaky@example.com",
        role: "clinician",
        household_id: "00000000-0000-4000-8000-000000000001",
        householdId: "00000000-0000-4000-8000-000000000001",
        data: { role: "admin" },
        options: { data: { role: "clinician" } },
      },
      { ip: "1.1.1.1" },
      d,
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      email: "sneaky@example.com",
      password: "a long enough password",
      redirect: "https://nurra.example/app/today",
      captcha: undefined,
      args: 4,
    });
    expect(JSON.stringify(calls)).not.toMatch(/clinician|admin|household/);
  });

  it("an invite in the body only changes where the email link lands", async () => {
    const { d, calls } = deps();
    const invite = "B".repeat(43);
    await signup({ ...good, email: "invited@example.com", invite }, { ip: "1.1.1.1" }, d);
    expect(calls[0].redirect).toBe(`https://nurra.example/invite/${invite}`);
  });
});

describe("sign-up and reset are rate limited per IP and per email", () => {
  it("blocks the 4th sign-up for one email within an hour", async () => {
    const { d } = deps();
    for (let i = 0; i < RATE_RULES.signupEmail.limit; i++) {
      expect((await signup({ ...good, email: "repeat@example.com" }, { ip: `3.3.3.${i}` }, d)).status).toBe(200);
    }
    expect((await signup({ ...good, email: "repeat@example.com" }, { ip: "3.3.3.99" }, d)).status).toBe(429);
  });

  it("forgot-password answers the same for known and unknown emails", async () => {
    const sent: string[] = [];
    const linkDeps = {
      send: async (email: string) => {
        sent.push(email);
        if (!existing.has(email)) throw new Error("user not found");
      },
      limiter: createMemoryRateLimiter(),
      captcha: pass,
      audit: createMemoryAuditLogger(),
      siteUrl: "https://nurra.example",
      minMs: 0,
    };
    const known = await requestEmailLink("reset", { email: "anita@example.com", captchaToken: "t" }, { ip: "1.1.1.1" }, linkDeps);
    const unknown = await requestEmailLink("reset", { email: "ghost@example.com", captchaToken: "t" }, { ip: "1.1.1.1" }, linkDeps);
    expect(known).toEqual(unknown);
    expect(known.body.message).toBe(RESET_SENT);
    expect(sent).toEqual(["anita@example.com", "ghost@example.com"]);
  });
});
