import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { SampleDashboard } from "@/components/home/sample-dashboard";
import { getSessionState } from "@/lib/auth/session";
import { homeRedirect } from "@/lib/home";

/**
 * Signed in: straight into the app. Signed out: a sample dashboard with fixed fake data.
 * No real data is read for signed-out visitors.
 */
export default async function Home() {
  const to = homeRedirect(await getSessionState());
  if (to) redirect(to);

  return (
    <main className="mx-auto w-full max-w-[560px] flex-1 space-y-5 px-4 pt-4">
      {/* The Log in button stays fixed in the top-right corner (public layout). */}
      <header className="flex min-h-12 items-center pr-28">
        <Logo variant="full" size={40} />
      </header>
      <div className="space-y-3">
        <h1 className="text-[28px] leading-9 font-bold">A gentle guide for the day, and a quiet word to the family when it matters</h1>
        <Link href="/signup" className="inline-flex min-h-12 items-center rounded-input border border-line-input bg-surface px-4 font-medium text-ink hover:bg-primary-tint">
          Create account
        </Link>
      </div>
      <SampleDashboard />
    </main>
  );
}
