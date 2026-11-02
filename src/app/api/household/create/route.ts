import { serverDeps } from "@/lib/auth/deps";
import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { createHousehold } from "@/lib/auth/services/household";
import { requireApiAccess } from "@/lib/auth/session";

/** First sign-up: creates a new household with this user as admin. */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;

  const access = await requireApiAccess({ needProfile: false });
  if (!access.ok) return access.response;

  const body = await readJsonBody(request);
  const deps = serverDeps("/api/household/create");

  const result = await createHousehold(body, { userId: access.state.user.id }, {
    limiter: deps.limiter,
    async createHousehold(userId, displayName, householdName) {
      const { data, error } = await deps.admin.rpc("create_household_for_user", {
        p_user: userId,
        p_display_name: displayName,
        p_household_name: householdName,
      });
      return error || !data ? null : (data as string);
    },
  });
  return respond(result);
}
