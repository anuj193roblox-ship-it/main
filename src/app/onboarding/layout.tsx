import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountMenu } from "@/components/auth/account-menu";
import { InactivityGuard } from "@/components/auth/inactivity-guard";
import { requirePageAccess } from "@/lib/auth/session";
import { canOnboard } from "@/lib/care/context";

// Setup for a new person. Family and the household owner only; clinicians join existing households.
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requirePageAccess({ needProfile: true, nextPath: "/onboarding/patient" });
  if (!profile || !canOnboard(profile.role)) redirect("/app/today");
  return (
    <>
      <header className="flex items-center justify-between border-b border-line px-4 py-2">
        <Link href="/app/today" className="inline-flex min-h-12 items-center font-medium text-primary underline">
          Finish later
        </Link>
        <AccountMenu />
      </header>
      <main className="mx-auto w-full max-w-[560px] flex-1 space-y-6 px-4 py-6">{children}</main>
      <InactivityGuard />
    </>
  );
}
