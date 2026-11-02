// Supabase Auth with CAPTCHA protection on rejects requests with captcha_failed BEFORE it looks at
// the account. That must be reported as "complete the check", identically for every email, and
// never hidden behind "check your email" (which would leave a new user waiting for nothing).
import { describe, expect, it } from "vitest";
import { createMemoryAuditLogger } from "../audit";
import type { CaptchaPolicy } from "../captcha";
import { createMemoryRateLimiter } from "../rate-limit";
import { login } from "./login";
import { requestEmailLink } from "./password";
import { CAPTCHA_FAILED } from "./result";
import { signup } from "./signup";

const pass: CaptchaPolicy = { forwardToSupabase: false, verify: async () => true };
const base = { limiter: createMemoryRateLimiter(), captcha: pass, audit: createMemoryAuditLogger(), minMs: 0 };

describe("Supabase rejects the CAPTCHA (captcha_failed)", () => {
  it("login says to complete the check, the same for a real and a made-up email", async () => {
    const deps = { ...base, householdOf: async () => null, signInWithPassword: async () => ({ errorCode: "captcha_failed" }) };
    const real = await login({ email: "anita@example.com", password: "x", captchaToken: "t" }, { ip: "1.1.1.1" }, deps);
    const fake = await login({ email: "ghost@example.com", password: "x", captchaToken: "t" }, { ip: "1.1.1.1" }, deps);
    expect(real).toEqual({ status: 400, body: { error: CAPTCHA_FAILED } });
    expect(fake).toEqual(real);
  });

  it("other Supabase errors at login stay the generic credentials answer", async () => {
    const deps = { ...base, householdOf: async () => null, signInWithPassword: async () => ({ errorCode: "invalid_credentials" }) };
    const res = await login({ email: "anita@example.com", password: "x", captchaToken: "t" }, { ip: "1.1.1.2" }, deps);
    expect(res.status).toBe(401);
  });

  it("sign-up does not pretend an email was sent", async () => {
    const res = await signup(
      { email: "new@example.com", password: "a long enough password", captchaToken: "t" },
      { ip: "1.1.1.3" },
      { ...base, siteUrl: "https://nurra.example", signUp: async () => ({ errorCode: "captcha_failed" }) },
    );
    expect(res).toEqual({ status: 400, body: { error: CAPTCHA_FAILED } });
  });

  it("forgot-password and resend say to complete the check", async () => {
    for (const kind of ["reset", "verify"] as const) {
      const res = await requestEmailLink(kind, { email: "anita@example.com", captchaToken: "t" }, { ip: "1.1.1.4" }, {
        ...base,
        limiter: createMemoryRateLimiter(),
        siteUrl: "https://nurra.example",
        send: async () => ({ errorCode: "captcha_failed" }),
      });
      expect(res).toEqual({ status: 400, body: { error: CAPTCHA_FAILED } });
    }
  });
});
