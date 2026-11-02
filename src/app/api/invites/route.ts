import { serverDeps } from "@/lib/auth/deps";
import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { createInvite } from "@/lib/auth/services/invites";
import { requireApiAccess } from "@/lib/auth/session";
import { randomToken, sha256Hex } from "@/lib/auth/tokens";

/** Household admin creates a single-use invite link (24 hours) into their own household. */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;

  // needProfile + MFA: only a full member, with two-step sign-in when required, gets this far.
  const access = await requireApiAccess({ needProfile: true });
  if (!access.ok) return access.response;
  const { user, profile } = access.state;
  if (!profile) return respond({ status: 403, body: { error: "Join or start a household to continue." } });

  const body = await readJsonBody(request);
  const deps = serverDeps("/api/invites");

  const result = await createInvite(body, { userId: user.id, householdId: profile.householdId, role: profile.role }, {
    ...deps,
    siteUrl: deps.config.siteUrl,
    randomToken,
    hash: sha256Hex,
    async insertInvite(row) {
      const { data, error } = await deps.admin
        .from("invites")
        .insert({ household_id: row.householdId, role: row.role, token_hash: row.tokenHash, created_by: row.createdBy })
        .select("id")
        .single();
      return error || !data ? null : { id: data.id as string };
    },
  });
  return respond(result);
}
