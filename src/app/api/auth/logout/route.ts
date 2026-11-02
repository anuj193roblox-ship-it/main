import { NextResponse } from "next/server";
import { serverDeps } from "@/lib/auth/deps";
import { clearAppCookies, readJsonBody, rejectCrossSite } from "@/lib/auth/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Ends the session on the server (refresh token revoked) and clears every auth cookie. */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;

  const body = (await readJsonBody(request)) as { reason?: unknown } | null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  await supabase.auth.signOut({ scope: "local" });
  await clearAppCookies();

  if (data.user) {
    const deps = serverDeps("/api/auth/logout");
    await deps.audit({
      action: body?.reason === "timeout" ? "auth.session_timeout" : "auth.logout",
      actorId: data.user.id,
      householdId: await deps.householdOf(data.user.id),
    });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
