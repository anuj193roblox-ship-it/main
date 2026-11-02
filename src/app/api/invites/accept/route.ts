import type { Role } from "@/lib/auth/access";
import { getClientIp } from "@/lib/auth/client-ip";
import { serverDeps } from "@/lib/auth/deps";
import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { acceptInvite } from "@/lib/auth/services/invites";
import { requireApiAccess } from "@/lib/auth/session";
import { sha256Hex } from "@/lib/auth/tokens";

export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;

  const access = await requireApiAccess({ needProfile: false });
  if (!access.ok) return access.response;

  const body = await readJsonBody(request);
  const deps = serverDeps("/api/invites/accept");

  const result = await acceptInvite(body, { userId: access.state.user.id, ip: getClientIp(request.headers) }, {
    ...deps,
    hash: sha256Hex,
    async acceptInvite(tokenHash, userId, displayName) {
      const { data, error } = await deps.admin.rpc("accept_invite", {
        p_token_hash: tokenHash,
        p_user: userId,
        p_display_name: displayName,
      });
      const row = Array.isArray(data) ? data[0] : null;
      return error || !row ? null : { householdId: row.household_id as string, role: row.role as Role };
    },
  });
  return respond(result);
}
