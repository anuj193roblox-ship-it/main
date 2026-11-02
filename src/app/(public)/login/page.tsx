import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/forms";
import { Notice, PageShell } from "@/components/ui/form";
import { decideAccess } from "@/lib/auth/access";
import { safeNextPath } from "@/lib/auth/next-path";
import { authConfig } from "@/lib/auth/server-config";
import { getSessionState } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Log in · Nurra" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const REASONS: Record<string, string> = {
  timeout: "You were signed out after 30 minutes without activity.",
  link: "That link has expired or was already used. Ask for a new one.",
};

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const reason = typeof params.reason === "string" ? REASONS[params.reason] : undefined;

  // Already signed in and active: go straight on.
  const state = await getSessionState();
  if (decideAccess(state, { requireMfa: false, needProfile: false, skipMfa: true }).ok) redirect(next);

  return (
    <PageShell title="Log in">
      {reason && <Notice tone="info">{reason}</Notice>}
      <LoginForm siteKey={authConfig().turnstileSiteKey} next={next} />
      <div className="space-y-2">
        <p>
          <Link href="/forgot-password" className="text-primary underline">
            Forgot your password?
          </Link>
        </p>
        <p className="text-ink-muted">
          New to Nurra?{" "}
          <Link href="/signup" className="text-primary underline">
            Create an account
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
