import { describe, expect, it } from "vitest";
import { createMemoryAuditLogger } from "../audit";
import type { CaptchaPolicy } from "../captcha";
import { createMemoryRateLimiter, RATE_RULES } from "../rate-limit";
import { GENERIC_LOGIN_ERROR, login, type LoginDeps } from "./login";

const pass: CaptchaPolicy = { forwardToSupabase: false, verify: async () => true };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ACCOUNTS: Record<string, string> = { "meera.family@example.com": "correct horse battery staple" };

function deps(over: Partial<LoginDeps> = {}, clock = { t: 0 }): LoginDeps & { audit: ReturnType<typeof createMemoryAuditLogger> } {
  const audit = createMemoryAuditLogger();
  return {
    // A realistic auth backend: an unknown email answers fast, a known one spends time hashing.
    async signInWithPassword(email, password) {
      if (!(email in ACCOUNTS)) {
        await sleep(2);
        return null;
      }
      await sleep(80);
      return ACCOUNTS[email] === password ? { userId: "user-1" } : null;
    },
    householdOf: async () => "household-1",
    limiter: createMemoryRateLimiter(() => clock.t),
    captcha: pass,
    minMs: 0,
    ...over,
    audit,
  };
}

const body = (email: string, password: string) => ({ email, password, captchaToken: "tok" });

describe("login: wrong email and wrong password look the same", () => {
  it("returns an identical generic error", async () => {
    const d = deps();
    const wrongEmail = await login(body("nobody@example.com", "whatever password"), { ip: "1.1.1.1" }, d);
    const wrongPassword = await login(body("meera.family@example.com", "not the password"), { ip: "1.1.1.1" }, d);
    expect(wrongEmail.status).toBe(401);
    expect(wrongEmail).toEqual(wrongPassword);
    expect(wrongEmail.body).toEqual({ error: GENERIC_LOGIN_ERROR });
  });

  it("takes about the same time, because every attempt is padded to a minimum", async () => {
    const d = deps({ minMs: 250 });
    const time = async (email: string, password: string) => {
      const start = performance.now();
      await login(body(email, password), { ip: "2.2.2.2" }, d);
      return performance.now() - start;
    };
    const wrongEmail = await time("nobody@example.com", "whatever password");
    const wrongPassword = await time("meera.family@example.com", "not the password");
    expect(wrongEmail).toBeGreaterThanOrEqual(245);
    expect(wrongPassword).toBeGreaterThanOrEqual(245);
    // Without padding these differ by ~78 ms; padded, they are within timer noise.
    expect(Math.abs(wrongEmail - wrongPassword)).toBeLessThan(40);
  });

  it("logs failures without the email or password", async () => {
    const d = deps();
    await login(body("nobody@example.com", "secret-ish password"), { ip: "1.1.1.1" }, d);
    expect(d.audit.events).toEqual([{ action: "auth.login_failure" }]);
    expect(JSON.stringify(d.audit.events)).not.toMatch(/nobody|secret/);
  });

  it("a correct login returns a safe next path and logs success with ids only", async () => {
    const d = deps();
    const ok = await login({ ...body("Meera.Family@example.com ", "correct horse battery staple"), next: "https://evil.example" }, { ip: "1.1.1.1" }, d);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ next: "/app/today" });
    expect(d.audit.events).toEqual([{ action: "auth.login_success", actorId: "user-1", householdId: "household-1" }]);
  });

  it("a failed CAPTCHA stops before the password is checked", async () => {
    let called = false;
    const d = deps({
      captcha: { forwardToSupabase: false, verify: async () => false },
      signInWithPassword: async () => {
        called = true;
        return null;
      },
    });
    const res = await login(body("meera.family@example.com", "x"), { ip: "1.1.1.1" }, d);
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });
});

describe("login rate limits and temporary lockout", () => {
  it("locks one account after 5 attempts from any IP, then recovers after the window", async () => {
    const clock = { t: 0 };
    const d = deps({}, clock);
    for (let i = 0; i < RATE_RULES.loginAccount.limit; i++) {
      expect((await login(body("meera.family@example.com", "wrong"), { ip: `10.0.0.${i}` }, d)).status).toBe(401);
    }
    const locked = await login(body("meera.family@example.com", "correct horse battery staple"), { ip: "10.0.0.99" }, d);
    expect(locked.status).toBe(429);
    expect(locked.headers?.["Retry-After"]).toBe(String(RATE_RULES.loginAccount.windowSeconds));
    expect(String(locked.body.error)).toMatch(/Try again in 15 minutes/);

    clock.t += RATE_RULES.loginAccount.windowSeconds * 1000 + 1;
    expect((await login(body("meera.family@example.com", "correct horse battery staple"), { ip: "10.0.0.99" }, d)).status).toBe(200);
  });

  it("the account lock looks the same for an email that does not exist", async () => {
    const d = deps();
    const lockOf = async (email: string) => {
      for (let i = 0; i < RATE_RULES.loginAccount.limit; i++) await login(body(email, "wrong"), { ip: `11.0.0.${i}` }, d);
      return login(body(email, "wrong"), { ip: "11.0.0.99" }, d);
    };
    const real = await lockOf("meera.family@example.com");
    const fake = await lockOf("ghost@example.com");
    expect(real.status).toBe(429);
    expect(fake).toEqual(real);
  });

  it("limits one IP across many accounts", async () => {
    const d = deps();
    for (let i = 0; i < RATE_RULES.loginIp.limit; i++) {
      expect((await login(body(`person${i}@example.com`, "wrong"), { ip: "9.9.9.9" }, d)).status).toBe(401);
    }
    expect((await login(body("another@example.com", "wrong"), { ip: "9.9.9.9" }, d)).status).toBe(429);
    expect((await login(body("another@example.com", "wrong"), { ip: "8.8.8.8" }, d)).status).toBe(401);
  });

  it("a successful login clears the account counter", async () => {
    const d = deps();
    for (let i = 0; i < RATE_RULES.loginAccount.limit - 1; i++) await login(body("meera.family@example.com", "wrong"), { ip: "7.7.7.7" }, d);
    expect((await login(body("meera.family@example.com", "correct horse battery staple"), { ip: "7.7.7.7" }, d)).status).toBe(200);
    for (let i = 0; i < RATE_RULES.loginAccount.limit; i++) {
      expect((await login(body("meera.family@example.com", "wrong"), { ip: "7.7.7.7" }, d)).status).toBe(401);
    }
  });

  it("fails closed if the rate limiter is down", async () => {
    const d = deps({ limiter: { hit: async () => Promise.reject(new Error("db down")), reset: async () => undefined } });
    expect((await login(body("meera.family@example.com", "correct horse battery staple"), { ip: "1.1.1.1" }, d)).status).toBe(503);
  });
});
