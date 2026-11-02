import { cookies } from "next/headers";
import { isRecoveryValid } from "@/lib/auth/activity";
import { serverDeps } from "@/lib/auth/deps";
import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { resetPassword } from "@/lib/auth/services/password";
import { requireApiAccess } from "@/lib/auth/session";
import { RECOVERY_COOKIE } from "@/lib/auth/session-timing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;

  // The session comes from the reset link (/auth/confirm). MFA is enforced by Supabase itself
  // (insufficient_aal) for users who have a factor.
  const access = await requireApiAccess({ needProfile: false, skipMfa: true });
  if (!access.ok) return access.response;
  const { user, profile } = access.state;

  const body = await readJsonBody(request);
  const deps = serverDeps("/api/auth/reset-password");
  const supabase = await createSupabaseServerClient();
  const store = await cookies();

  const result = await resetPassword(body, {
    audit: deps.audit,
    userId: user.id,
    householdId: profile?.householdId ?? null,
    recoveryValid: await isRecoveryValid(store.get(RECOVERY_COOKIE)?.value, user.id, Date.now(), deps.config.sessionSecret),
    async updatePassword(password) {
      const { error } = await supabase.auth.updateUser({ password });
      return { errorCode: error?.code ?? null };
    },
    async signOutOtherSessions() {
      await supabase.auth.signOut({ scope: "others" });
    },
  });

  // The reset link works once.
  if (result.status === 200) store.delete({ name: RECOVERY_COOKIE, path: "/" });
  return respond(result);
}
