import { serverDeps } from "@/lib/auth/deps";
import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { claimDemoHousehold } from "@/lib/auth/services/household";
import { requireApiAccess } from "@/lib/auth/session";

/** docs/S2_NOTES.md: the first verified user may claim the seeded demo household, in demo mode only. */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;

  const access = await requireApiAccess({ needProfile: false });
  if (!access.ok) return access.response;

  const body = await readJsonBody(request);
  const deps = serverDeps("/api/household/claim-demo");

  const result = await claimDemoHousehold(body, { userId: access.state.user.id }, {
    demoMode: deps.config.demoMode,
    limiter: deps.limiter,
    async claim(userId, displayName) {
      const { data, error } = await deps.admin.rpc("claim_demo_household", { p_user: userId, p_display_name: displayName });
      return !error && data === true;
    },
  });
  return respond(result);
}
