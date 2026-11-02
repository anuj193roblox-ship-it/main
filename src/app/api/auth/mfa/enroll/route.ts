import { NextResponse } from "next/server";
import { rejectCrossSite } from "@/lib/auth/http";
import { SOMETHING_WRONG } from "@/lib/auth/services/result";
import { requireApiAccess } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const noStore = { "Cache-Control": "no-store" };

/** Starts TOTP enrolment. The factor only counts once a code is verified (/api/auth/mfa/verify). */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;

  const access = await requireApiAccess({ needProfile: false, skipMfa: true });
  if (!access.ok) return access.response;

  const supabase = await createSupabaseServerClient();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return NextResponse.json({ error: SOMETHING_WRONG }, { status: 500, headers: noStore });

  const totp = factors.all.filter((f) => f.factor_type === "totp");
  if (totp.some((f) => f.status === "verified")) {
    return NextResponse.json({ error: "Two-step sign-in is already on for this account." }, { status: 409, headers: noStore });
  }
  // Drop half-finished attempts so the user can start again.
  for (const f of totp) await supabase.auth.mfa.unenroll({ factorId: f.id });

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Nurra" });
  if (error || !data) return NextResponse.json({ error: SOMETHING_WRONG }, { status: 500, headers: noStore });

  return NextResponse.json(
    { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret },
    { status: 200, headers: noStore },
  );
}
