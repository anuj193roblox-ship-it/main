import { describe, expect, it } from "vitest";
import { decideAccess, type Role, type SessionState } from "./access";

function signedIn(over: Partial<{ verified: boolean; active: boolean; role: Role | null; current: "aal1" | "aal2"; next: "aal1" | "aal2" }> = {}): SessionState {
  const o = { verified: true, active: true, role: "family" as Role | null, current: "aal1" as const, next: "aal1" as const, ...over };
  return {
    user: { id: "u1", email: null, emailVerified: o.verified },
    activityValid: o.active,
    profile: o.role ? { householdId: "h1", role: o.role } : null,
    aal: { current: o.current, next: o.next },
  };
}

const page = { requireMfa: true, needProfile: true, nextPath: "/app/today" };

describe("who may enter /app", () => {
  it("signed out goes to /login?next=/app/today", () => {
    expect(decideAccess({ user: null }, page)).toMatchObject({ ok: false, redirectTo: "/login?next=%2Fapp%2Ftoday", status: 401 });
  });

  it("an expired inactivity cookie counts as signed out, with a reason", () => {
    expect(decideAccess(signedIn({ active: false }), page)).toMatchObject({ ok: false, redirectTo: "/login?next=%2Fapp%2Ftoday&reason=timeout" });
  });

  it("an unverified email sees nothing", () => {
    expect(decideAccess(signedIn({ verified: false }), page)).toMatchObject({ ok: false, redirectTo: "/verify-email", status: 403 });
  });

  it("no household yet goes to /app/start", () => {
    expect(decideAccess(signedIn({ role: null }), page)).toMatchObject({ ok: false, redirectTo: "/app/start" });
  });

  it.each(["admin", "clinician"] as const)("%s without a factor must enrol when MFA is required", (role) => {
    expect(decideAccess(signedIn({ role }), page)).toMatchObject({ ok: false, redirectTo: "/mfa/enroll" });
  });

  it.each(["admin", "clinician"] as const)("%s with a factor must enter a code", (role) => {
    expect(decideAccess(signedIn({ role, next: "aal2" }), page)).toMatchObject({ ok: false, redirectTo: "/mfa/verify" });
  });

  it("admin with a verified code is in", () => {
    expect(decideAccess(signedIn({ role: "admin", current: "aal2", next: "aal2" }), page).ok).toBe(true);
  });

  it("family does not need MFA, but must use it once they turn it on", () => {
    expect(decideAccess(signedIn({ role: "family" }), page).ok).toBe(true);
    expect(decideAccess(signedIn({ role: "family", next: "aal2" }), page)).toMatchObject({ redirectTo: "/mfa/verify" });
  });

  it("REQUIRE_MFA=false lets admin in without a factor", () => {
    expect(decideAccess(signedIn({ role: "admin" }), { ...page, requireMfa: false }).ok).toBe(true);
  });
});
