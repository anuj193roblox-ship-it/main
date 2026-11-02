import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { serverDeps } from "@/lib/auth/deps";
import { markRecovery, touchActivity } from "@/lib/auth/http";
import { loginPath, safeNextPath } from "@/lib/auth/next-path";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ALLOWED_TYPES: EmailOtpType[] = ["email", "signup", "recovery"];

/**
 * Landing point for the links in Supabase's emails (see the email templates in the setup notes).
 * Works across devices: it uses the one-time token_hash, not a browser-bound code.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const fail = () => NextResponse.redirect(new URL(loginPath(undefined, "link"), request.url), 303);

  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type) || tokenHash.length > 512) return fail();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.user) return fail();

  const deps = serverDeps("/auth/confirm");
  await touchActivity(data.user.id);
  const who = { actorId: data.user.id, householdId: await deps.householdOf(data.user.id) };

  if (type === "recovery") {
    await markRecovery(data.user.id);
    await deps.audit({ action: "auth.password_reset_link_used", ...who });
    return NextResponse.redirect(new URL("/reset-password", request.url), 303);
  }

  await deps.audit({ action: "auth.email_verified", ...who });
  return NextResponse.redirect(new URL(safeNextPath(params.get("next"), deps.config.siteUrl), request.url), 303);
}
