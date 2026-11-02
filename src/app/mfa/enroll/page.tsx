import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MfaEnrollForm } from "@/components/auth/mfa-forms";
import { PageShell } from "@/components/ui/form";
import { mfaRole } from "@/lib/auth/access";
import { authConfig } from "@/lib/auth/server-config";
import { requirePageAccess } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Two-step sign-in · Nurra" };

export default async function MfaEnrollPage() {
  const { aal, profile } = await requirePageAccess({ needProfile: false, skipMfa: true, nextPath: "/mfa/enroll" });
  if (aal.next === "aal2") redirect(aal.current === "aal2" ? "/app/account" : "/mfa/verify");

  const required = authConfig().requireMfa && profile !== null && mfaRole(profile.role);
  return (
    <PageShell
      title="Set up two-step sign-in"
      intro={
        required
          ? "Your role can see medical details, so Nurra asks for a code from your phone as well as your password."
          : "Add a code from your phone as well as your password. It keeps your account safe if your password leaks."
      }
    >
      <MfaEnrollForm />
    </PageShell>
  );
}
