import type { Metadata } from "next";
import Link from "next/link";
import { AcceptInviteForm } from "@/components/auth/forms";
import { Notice, PageShell } from "@/components/ui/form";
import { INVITE_TOKEN_PATTERN } from "@/lib/auth/next-path";
import { INVITE_UNUSABLE } from "@/lib/auth/services/invites";
import { getSessionState } from "@/lib/auth/session";

// The token stays out of the title, and Referrer-Policy keeps the path from leaking to other sites.
export const metadata: Metadata = { title: "Invite · Nurra" };

type Props = { params: Promise<{ token: string }> };

const linkButton =
  "inline-flex min-h-12 w-full items-center justify-center rounded-input px-4 font-medium focus:outline-2 focus:outline-offset-2 focus:outline-primary";

export default async function InvitePage({ params }: Props) {
  const { token } = await params;
  // Nothing about the invite (household, role, validity) is shown before it is accepted.
  if (!INVITE_TOKEN_PATTERN.test(token)) {
    return (
      <PageShell title="Join a household">
        <Notice tone="info">{INVITE_UNUSABLE}</Notice>
      </PageShell>
    );
  }

  const state = await getSessionState();
  const here = `/invite/${token}`;

  if (!state.user || !state.activityValid) {
    return (
      <PageShell title="Join a household" intro="Someone has invited you to help care for a family member on Nurra.">
        <Link href={`/login?next=${here}`} className={`${linkButton} bg-primary text-white hover:bg-primary-pressed`}>
          Log in to accept
        </Link>
        <Link href={`/signup?invite=${token}`} className={`${linkButton} border border-line-input bg-surface text-ink hover:bg-primary-tint`}>
          Create an account
        </Link>
      </PageShell>
    );
  }

  if (!state.user.emailVerified) {
    return (
      <PageShell title="Join a household">
        <Notice tone="info">Verify your email first, then open this link again.</Notice>
      </PageShell>
    );
  }

  if (state.profile) {
    return (
      <PageShell title="Join a household">
        <Notice tone="info">This account already belongs to a household. Each account can belong to one household.</Notice>
        <Link href="/app/today" className="text-primary underline">
          Go to Today
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell title="Join a household" intro="Accept the invite to join the household that sent it.">
      <AcceptInviteForm token={token} />
    </PageShell>
  );
}
