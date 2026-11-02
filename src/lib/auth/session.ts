import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { type AccessOptions, type Aal, API_ACCESS_MESSAGES, decideAccess, type Role, type SessionState, type SignedInState } from "./access";
import { isActivityValid, isRecoveryValid } from "./activity";
import { authConfig } from "./server-config";
import { ACTIVITY_COOKIE, RECOVERY_COOKIE } from "./session-timing";

const ROLES: readonly Role[] = ["family", "clinician", "admin"];

/**
 * The signed-in user as the server sees it. getUser() checks the token with Supabase Auth, the role
 * comes from public.users (read through RLS), never from user metadata or the client.
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { user: null };
  const user = data.user;

  const store = await cookies();
  const activityValid = await isActivityValid(store.get(ACTIVITY_COOKIE)?.value, user.id, Date.now(), authConfig().sessionSecret);

  const { data: row } = await supabase.from("users").select("household_id, role").eq("id", user.id).maybeSingle();
  const role = row && ROLES.includes(row.role as Role) ? (row.role as Role) : null;
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  return {
    user: { id: user.id, email: user.email ?? null, emailVerified: Boolean(user.email_confirmed_at) },
    activityValid,
    profile: row && role ? { householdId: row.household_id as string, role } : null,
    aal: { current: toAal(aal?.currentLevel), next: toAal(aal?.nextLevel) },
  };
});

function toAal(level: string | null | undefined): Aal {
  return level === "aal1" || level === "aal2" ? level : null;
}

/** True when this browser opened a password-reset link for this user in the last 15 minutes. */
export async function hasValidRecovery(userId: string): Promise<boolean> {
  const store = await cookies();
  return isRecoveryValid(store.get(RECOVERY_COOKIE)?.value, userId, Date.now(), authConfig().sessionSecret);
}

type PageOptions = Omit<AccessOptions, "requireMfa">;

/** For pages: returns the signed-in state or redirects. Call it in every protected page. */
export async function requirePageAccess(opts: PageOptions): Promise<SignedInState> {
  const decision = decideAccess(await getSessionState(), { ...opts, requireMfa: authConfig().requireMfa });
  if (!decision.ok) redirect(decision.redirectTo);
  return decision.state;
}

/** For route handlers: the signed-in state, or a 401/403 response that carries no data. */
export async function requireApiAccess(
  opts: Omit<PageOptions, "nextPath">,
): Promise<{ ok: true; state: SignedInState } | { ok: false; response: NextResponse }> {
  const decision = decideAccess(await getSessionState(), { ...opts, requireMfa: authConfig().requireMfa });
  if (decision.ok) return decision;
  return {
    ok: false,
    response: NextResponse.json(
      { error: API_ACCESS_MESSAGES[decision.reason] ?? API_ACCESS_MESSAGES.signed_out },
      { status: decision.status, headers: { "Cache-Control": "no-store" } },
    ),
  };
}
