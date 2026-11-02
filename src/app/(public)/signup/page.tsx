import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "@/components/auth/forms";
import { Notice, PageShell } from "@/components/ui/form";
import { INVITE_TOKEN_PATTERN } from "@/lib/auth/next-path";
import { authConfig } from "@/lib/auth/server-config";

export const metadata: Metadata = { title: "Create an account · Nurra" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SignupPage({ searchParams }: Props) {
  const params = await searchParams;
  const invite = typeof params.invite === "string" && INVITE_TOKEN_PATTERN.test(params.invite) ? params.invite : undefined;

  return (
    <PageShell
      title="Create your account"
      intro="You will get an email to confirm your address before you can see anything in Nurra."
    >
      {invite && <Notice tone="info">After you confirm your email, you can accept the invite you were sent.</Notice>}
      <SignupForm siteKey={authConfig().turnstileSiteKey} invite={invite} />
      <p className="text-ink-muted">
        Already have an account?{" "}
        <Link href={invite ? `/login?next=/invite/${invite}` : "/login"} className="text-primary underline">
          Log in
        </Link>
      </p>
    </PageShell>
  );
}
