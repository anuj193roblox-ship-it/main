import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/forms";
import { Notice, PageShell } from "@/components/ui/form";
import { LINK_EXPIRED } from "@/lib/auth/services/password";
import { getSessionState, hasValidRecovery } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Choose a new password · Nurra" };

export default async function ResetPasswordPage() {
  const state = await getSessionState();
  // Only a session that just came from a reset link (signed cookie, 15 minutes, single use).
  const valid = state.user !== null && (await hasValidRecovery(state.user.id));

  if (!valid) {
    return (
      <PageShell title="Choose a new password">
        <Notice tone="info">{LINK_EXPIRED}</Notice>
        <Link
          href="/forgot-password"
          className="inline-flex min-h-12 w-full items-center justify-center rounded-input bg-primary px-4 font-medium text-white hover:bg-primary-pressed"
        >
          Send a new link
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell title="Choose a new password" intro="After this, every other device signed in to your account is signed out.">
      <ResetPasswordForm />
    </PageShell>
  );
}
