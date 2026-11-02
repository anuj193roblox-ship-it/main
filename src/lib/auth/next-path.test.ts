import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT_PATH, loginPath, safeNextPath } from "./next-path";

const token = "A".repeat(43);

describe("open redirect protection (next=)", () => {
  it.each([
    "https://evil.example",
    "//evil.example",
    "https://evil.example/app/today",
    "//evil.example/app/today",
    "/\\evil.example",
    "\\\\evil.example",
    "/%2f%2fevil.example",
    "javascript:alert(1)",
    "data:text/html,hi",
    "http:evil.example",
    "app/today",
    "/app/today/../../evil",
    "/app/admin",
    "/api/auth/logout",
    "/invite/short",
    `/invite/${token}x`,
    " /app/today",
    "/app/today\n",
    "",
  ])("rejects %j", (input) => {
    expect(safeNextPath(input)).toBe(DEFAULT_NEXT_PATH);
  });

  it.each([
    ["/app/today", "/app/today"],
    ["/app/account", "/app/account"],
    ["/app/start", "/app/start"],
    ["/mfa/verify", "/mfa/verify"],
    ["/reset-password", "/reset-password"],
    [`/invite/${token}`, `/invite/${token}`],
    ["/app/today?tab=x#y", "/app/today"],
  ])("allows %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it("accepts absolute URLs only on our own origin, and only when that origin is given", () => {
    expect(safeNextPath("https://nurra.example/app/account", "https://nurra.example")).toBe("/app/account");
    expect(safeNextPath("https://evil.example/app/account", "https://nurra.example")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("https://nurra.example.evil.example/app/account", "https://nurra.example")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("https://nurra.example/app/account")).toBe(DEFAULT_NEXT_PATH);
  });

  it("non-strings fall back to the default", () => {
    expect(safeNextPath(undefined)).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath(["/app/account"])).toBe(DEFAULT_NEXT_PATH);
  });

  it("loginPath always carries a safe next", () => {
    expect(loginPath("/app/today")).toBe("/login?next=%2Fapp%2Ftoday");
    expect(loginPath("https://evil.example")).toBe("/login?next=%2Fapp%2Ftoday");
    expect(loginPath("/app/today", "timeout")).toBe("/login?next=%2Fapp%2Ftoday&reason=timeout");
  });
});
