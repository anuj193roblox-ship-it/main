import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConsentForm } from "@/components/onboarding/forms";
import { Stepper } from "@/components/onboarding/stepper";
import { formatDay } from "@/lib/care/format";
import { str } from "@/lib/care/context";
import { carePage } from "@/lib/care/server";
import { loadOnboarding } from "@/lib/care/services/onboarding";

export const metadata: Metadata = { title: "Set up · Nurra" };

export default async function OnboardingConsentPage() {
  const { ctx, db } = await carePage("/onboarding/consent");
  const { patient, consent } = await loadOnboarding(db, ctx);
  if (!patient) redirect("/onboarding/patient");
  return (
    <>
      <Stepper current={1} />
      <div className="space-y-1">
        <h1 className="text-[28px] leading-9 font-bold">Consent</h1>
        <p className="text-ink-muted">Nurra needs consent before it starts. Read the text below with them.</p>
      </div>
      <ConsentForm
        recorded={consent ? { basis: str(consent.basis), givenBy: str(consent.given_by), givenAt: formatDay(consent.given_at) } : null}
      />
    </>
  );
}
