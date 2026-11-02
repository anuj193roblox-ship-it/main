import type { Metadata } from "next";
import Link from "next/link";
import { EmailLinkForm } from "@/components/auth/forms";
import { PageShell } from "@/components/ui/form";
import { authConfig } from "@/lib/auth/server-config";

export const metadata: Metadata = { title: "Reset your password · Nurra" };

export default function ForgotPasswordPage() {
  return (
    <PageShell title="Reset your password" intro="Enter the email you sign in with. We will send a link to choose a new password.">
      <EmailLinkForm siteKey={authConfig().turnstileSiteKey} endpoint="/api/auth/forgot-password" submitLabel="Send reset link" />
      <p>
        <Link href="/login" className="text-primary underline">
          Back to log in
        </Link>
      </p>
    </PageShell>
  );
}
