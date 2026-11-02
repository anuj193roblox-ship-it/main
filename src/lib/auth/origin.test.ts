import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "./origin";

const post = (headers: Record<string, string>) =>
  new Request("http://localhost:3000/api/auth/login", { method: "POST", headers });

describe("Origin check for state-changing requests", () => {
  it("allows a same-origin POST", () => {
    expect(isSameOriginRequest(post({ origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginRequest(post({ origin: "http://localhost:3000" }))).toBe(true);
  });

  it("rejects a cross-site POST", () => {
    expect(isSameOriginRequest(post({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOriginRequest(post({ origin: "https://evil.example" }))).toBe(false);
  });

  it("rejects a same-site but different-origin POST (a sibling subdomain)", () => {
    expect(isSameOriginRequest(post({ origin: "http://localhost:3000", "sec-fetch-site": "same-site" }))).toBe(false);
    expect(isSameOriginRequest(post({ origin: "http://localhost:4000" }))).toBe(false);
  });

  it("rejects a missing or opaque Origin", () => {
    expect(isSameOriginRequest(post({}))).toBe(false);
    expect(isSameOriginRequest(post({ origin: "null" }))).toBe(false);
  });

  it("accepts the configured site URL when the app sits behind a proxy", () => {
    expect(isSameOriginRequest(post({ origin: "https://nurra.example" }), ["https://nurra.example"])).toBe(true);
  });
});
