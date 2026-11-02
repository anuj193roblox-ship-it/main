import type { Metadata } from "next";
import Link from "next/link";
import { EmailLinkForm } from "@/components/auth/forms";
import { PageShell } from "@/components/ui/form";
import { authConfig } from "@/lib/auth/server-config";

export const metadata: Metadata = { title: "Verify your email · Nurra" };

export default function VerifyEmailPage() {
  return (
    <PageShell
      title="Verify your email"
      intro="Open the link we emailed you to confirm your address. Nothing in Nurra is visible until you do."
    >
      <div className="space-y-2">
        <h2 className="text-xl leading-7 font-semibold">Need a new link?</h2>
        <EmailLinkForm siteKey={authConfig().turnstileSiteKey} endpoint="/api/auth/resend" submitLabel="Send a new link" />
      </div>
      <p>
        <Link href="/login" className="text-primary underline">
          Back to log in
        </Link>
      </p>
    </PageShell>
  );
}
