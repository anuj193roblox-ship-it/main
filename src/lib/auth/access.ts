// Who may see what. Pure decisions, used by pages (redirects) and route handlers (401/403).
import { loginPath } from "./next-path";

export type Role = "family" | "clinician" | "admin";
export type Aal = "aal1" | "aal2" | null;

export type Profile = { householdId: string; role: Role };

export type SessionState =
  | { user: null }
  | {
      user: { id: string; email: string | null; emailVerified: boolean };
      /** The inactivity cookie is genuine, ours and under 30 minutes old. */
      activityValid: boolean;
      profile: Profile | null;
      /** currentLevel: this session; nextLevel: aal2 when the user has a verified TOTP factor. */
      aal: { current: Aal; next: Aal };
    };

export type SignedInState = Exclude<SessionState, { user: null }>;

export type AccessOptions = {
  requireMfa: boolean;
  /** Pages under /app need a household; /app/start and the MFA pages do not. */
  needProfile: boolean;
  /** Skip the MFA step (the MFA pages themselves). */
  skipMfa?: boolean;
  /** Where to come back to after logging in. */
  nextPath?: string;
};

export type AccessDecision =
  | { ok: true; state: SignedInState }
  | { ok: false; redirectTo: string; status: 401 | 403; reason: string };

export function mfaRole(role: Role): boolean {
  return role === "admin" || role === "clinician";
}

export function decideAccess(state: SessionState, opts: AccessOptions): AccessDecision {
  if (!state.user) {
    return { ok: false, redirectTo: loginPath(opts.nextPath), status: 401, reason: "signed_out" };
  }
  if (!state.activityValid) {
    return { ok: false, redirectTo: loginPath(opts.nextPath, "timeout"), status: 401, reason: "inactive" };
  }
  if (!state.user.emailVerified) {
    return { ok: false, redirectTo: "/verify-email", status: 403, reason: "email_unverified" };
  }
  if (!opts.skipMfa) {
    const hasFactor = state.aal.next === "aal2";
    // Anyone with a verified factor must use it. Clinicians and admins must have one when required.
    if (hasFactor && state.aal.current !== "aal2") {
      return { ok: false, redirectTo: "/mfa/verify", status: 403, reason: "mfa_verify" };
    }
    if (!hasFactor && opts.requireMfa && state.profile && mfaRole(state.profile.role)) {
      return { ok: false, redirectTo: "/mfa/enroll", status: 403, reason: "mfa_enroll" };
    }
  }
  if (opts.needProfile && !state.profile) {
    return { ok: false, redirectTo: "/app/start", status: 403, reason: "no_household" };
  }
  return { ok: true, state: state as SignedInState };
}

/** Generic API error bodies: they say what to do, never what exists. */
export const API_ACCESS_MESSAGES: Record<string, string> = {
  signed_out: "Sign in to continue.",
  inactive: "You were signed out after 30 minutes without activity. Sign in again.",
  email_unverified: "Verify your email to continue.",
  mfa_verify: "Enter your sign-in code to continue.",
  mfa_enroll: "Set up two-step sign-in to continue.",
  no_household: "Join or start a household to continue.",
};
