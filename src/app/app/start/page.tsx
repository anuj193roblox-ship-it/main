import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClaimDemoForm, StartHouseholdForm } from "@/components/auth/forms";
import { Notice } from "@/components/ui/form";
import { serverDeps } from "@/lib/auth/deps";
import { requirePageAccess } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Get started · Nurra" };

const DEMO_HOUSEHOLD = "00000000-0000-4000-8000-000000000001";

/** In demo mode, offer the seeded household while nobody owns it (docs/S2_NOTES.md). */
async function demoClaimable(): Promise<boolean> {
  const { config, admin } = serverDeps("/app/start");
  if (!config.demoMode) return false;
  const { data: household } = await admin.from("households").select("id").eq("id", DEMO_HOUSEHOLD).maybeSingle();
  if (!household) return false;
  const { count } = await admin.from("users").select("id", { count: "exact", head: true }).eq("household_id", DEMO_HOUSEHOLD);
  return count === 0;
}

export default async function StartPage() {
  const state = await requirePageAccess({ needProfile: false, nextPath: "/app/start" });
  if (state.profile) redirect("/app/today");
  const showDemo = await demoClaimable();

  return (
    <main className="mx-auto w-full max-w-[420px] flex-1 space-y-8 px-6 py-8">
      <div className="space-y-2">
        <h1 className="text-[28px] leading-9 font-bold">Get started</h1>
        <p className="text-ink-muted">Start a household for the person you care for. You will be its owner.</p>
      </div>
      <StartHouseholdForm />
      <Notice tone="info">Joining someone else&apos;s household? Open the invite link they sent you.</Notice>
      {showDemo && (
        <section className="space-y-3 border-t border-line pt-6" aria-labelledby="demo-title">
          <h2 id="demo-title" className="text-xl leading-7 font-semibold">
            Demo household
          </h2>
          <p className="text-ink-muted">Nobody owns the demo household yet. The first person to claim it becomes its owner.</p>
          <ClaimDemoForm />
        </section>
      )}
    </main>
  );
}
