import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MfaVerifyForm } from "@/components/auth/mfa-forms";
import { PageShell } from "@/components/ui/form";
import { requirePageAccess } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Enter your code · Nurra" };

export default async function MfaVerifyPage() {
  const { aal } = await requirePageAccess({ needProfile: false, skipMfa: true, nextPath: "/mfa/verify" });
  if (aal.next !== "aal2") redirect("/mfa/enroll");
  if (aal.current === "aal2") redirect("/app/today");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const factor = data?.totp.find((f) => f.status === "verified");
  if (!factor) redirect("/mfa/enroll");

  return (
    <PageShell title="Enter your code" intro="Open your authenticator app and enter the 6-digit code for Nurra.">
      <MfaVerifyForm factorId={factor.id} />
    </PageShell>
  );
}
