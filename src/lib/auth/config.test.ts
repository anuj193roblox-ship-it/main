import { describe, expect, it, vi } from "vitest";
import { createTurnstilePolicy, TURNSTILE_VERIFY_URL } from "./captcha";
import { AuthConfigError, readAuthConfig, TURNSTILE_TEST_SECRET_KEY, TURNSTILE_TEST_SITE_KEY } from "./config";

const prod = {
  NODE_ENV: "production",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site",
  TURNSTILE_SECRET_KEY: "secret",
  AUTH_SESSION_SECRET: "x".repeat(40),
  NEXT_PUBLIC_SITE_URL: "https://nurra.example/",
};

describe("auth config", () => {
  it("development uses Cloudflare's test keys and does not require MFA by default", () => {
    const c = readAuthConfig({ NODE_ENV: "development" });
    expect(c.turnstileSiteKey).toBe(TURNSTILE_TEST_SITE_KEY);
    expect(c.turnstileSecretKey).toBe(TURNSTILE_TEST_SECRET_KEY);
    expect(c.requireMfa).toBe(false);
  });

  it("production requires MFA by default and REQUIRE_MFA can change it", () => {
    expect(readAuthConfig(prod).requireMfa).toBe(true);
    expect(readAuthConfig({ ...prod, REQUIRE_MFA: "false" }).requireMfa).toBe(false);
    expect(readAuthConfig({ NODE_ENV: "development", REQUIRE_MFA: "true" }).requireMfa).toBe(true);
  });

  it("production fails closed without real keys, and never accepts the test secret", () => {
    expect(() => readAuthConfig({ ...prod, TURNSTILE_SECRET_KEY: "" })).toThrow(AuthConfigError);
    expect(() => readAuthConfig({ ...prod, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY })).toThrow(/test key/);
    expect(() => readAuthConfig({ ...prod, AUTH_SESSION_SECRET: "short" })).toThrow(/AUTH_SESSION_SECRET/);
    expect(() => readAuthConfig({ ...prod, NEXT_PUBLIC_SITE_URL: "" })).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it("error messages name settings but never print their values", () => {
    try {
      readAuthConfig({ ...prod, TURNSTILE_SECRET_KEY: "", AUTH_SESSION_SECRET: "short-secret-value" });
    } catch (e) {
      expect(String(e)).not.toContain("short-secret-value");
    }
  });

  it("the site URL is reduced to its origin", () => {
    expect(readAuthConfig(prod).siteUrl).toBe("https://nurra.example");
  });
});

describe("Turnstile verification", () => {
  it("posts the secret and token to Cloudflare and trusts only success: true", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true }))) as unknown as typeof fetch;
    const policy = createTurnstilePolicy("secret", false, fetchImpl);
    expect(await policy.verify("tok", "1.2.3.4")).toBe(true);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body.get("secret")).toBe("secret");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });

  it("fails closed on a failed check, a bad response or a network error", async () => {
    const no = createTurnstilePolicy("s", false, (async () => new Response(JSON.stringify({ success: false }))) as unknown as typeof fetch);
    const bad = createTurnstilePolicy("s", false, (async () => new Response("oops", { status: 500 })) as unknown as typeof fetch);
    const down = createTurnstilePolicy("s", false, (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch);
    expect(await no.verify("t", "ip")).toBe(false);
    expect(await bad.verify("t", "ip")).toBe(false);
    expect(await down.verify("t", "ip")).toBe(false);
  });
});
