import { NextResponse } from "next/server";
import { rejectCrossSite, touchActivity } from "@/lib/auth/http";
import { requireApiAccess } from "@/lib/auth/session";

/** "I am still here": keeps the 30-minute inactivity timer going while the user is active. */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;

  const access = await requireApiAccess({ needProfile: false, skipMfa: true });
  if (!access.ok) return access.response;

  await touchActivity(access.state.user.id);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
