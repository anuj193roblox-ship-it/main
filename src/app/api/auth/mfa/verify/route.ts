import { serverDeps } from "@/lib/auth/deps";
import { readJsonBody, rejectCrossSite, respond, touchActivity } from "@/lib/auth/http";
import { verifyMfa } from "@/lib/auth/services/mfa";
import { requireApiAccess } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;

  const access = await requireApiAccess({ needProfile: false, skipMfa: true });
  if (!access.ok) return access.response;
  const { user, profile } = access.state;

  const body = await readJsonBody(request);
  const deps = serverDeps("/api/auth/mfa/verify");
  const supabase = await createSupabaseServerClient();

  const result = await verifyMfa(body, { userId: user.id, householdId: profile?.householdId ?? null }, {
    limiter: deps.limiter,
    audit: deps.audit,
    async factorStatus(factorId) {
      const { data } = await supabase.auth.mfa.listFactors();
      const factor = data?.all.find((f) => f.id === factorId && f.factor_type === "totp");
      return factor ? (factor.status === "verified" ? "verified" : "unverified") : null;
    },
    async challengeAndVerify(factorId, code) {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      return !error;
    },
  });

  if (result.status === 200) await touchActivity(user.id);
  return respond(result);
}
