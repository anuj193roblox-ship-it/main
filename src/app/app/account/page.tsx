import type { Metadata } from "next";
import Link from "next/link";
import { CreateInviteForm, LogoutButton } from "@/components/auth/forms";
import { StatusChip } from "@/components/status-chip";
import { requirePageAccess } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Account · Nurra" };

const ROLE_WORDS = { admin: "Household owner", clinician: "Clinician", family: "Family member" } as const;

export default async function AccountPage() {
  const { user, profile, aal } = await requirePageAccess({ needProfile: true, nextPath: "/app/account" });
  const mfaOn = aal.next === "aal2";

  return (
    <main className="mx-auto w-full max-w-[420px] flex-1 space-y-8 px-6 py-8">
      <h1 className="text-[28px] leading-9 font-bold">Account</h1>

      <section className="space-y-2 rounded-card border border-line bg-primary-tint p-4" aria-labelledby="you">
        <h2 id="you" className="text-xl leading-7 font-semibold">
          You
        </h2>
        <p className="break-all">{user.email}</p>
        <p className="text-ink-muted">{profile ? ROLE_WORDS[profile.role] : null}</p>
      </section>

      <section className="space-y-3" aria-labelledby="mfa">
        <h2 id="mfa" className="text-xl leading-7 font-semibold">
          Two-step sign-in
        </h2>
        {mfaOn ? (
          <StatusChip tone="ok" icon="check-circle" word="On" />
        ) : (
          <>
            <StatusChip tone="neutral" icon="clock" word="Off" />
            <p className="text-ink-muted">Adds a code from your phone each time you log in.</p>
            <Link
              href="/mfa/enroll"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-input bg-primary px-4 font-medium text-white hover:bg-primary-pressed"
            >
              Set up two-step sign-in
            </Link>
          </>
        )}
      </section>

      {profile?.role === "admin" && (
        <section className="space-y-3" aria-labelledby="invite">
          <h2 id="invite" className="text-xl leading-7 font-semibold">
            Invite someone
          </h2>
          <p className="text-ink-muted">Family members and clinicians join your household with a one-time link.</p>
          <CreateInviteForm />
        </section>
      )}

      <LogoutButton />
    </main>
  );
}
