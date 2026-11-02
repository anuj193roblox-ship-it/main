import type { Metadata } from "next";
import { PatientForm } from "@/components/onboarding/forms";
import { Stepper } from "@/components/onboarding/stepper";
import { str } from "@/lib/care/context";
import { carePage } from "@/lib/care/server";
import { loadOnboarding } from "@/lib/care/services/onboarding";

export const metadata: Metadata = { title: "Set up · Nurra" };

export default async function OnboardingPatientPage() {
  const { ctx, db } = await carePage("/onboarding/patient");
  const { patient, conditions } = await loadOnboarding(db, ctx);
  return (
    <>
      <Stepper current={0} />
      <div className="space-y-1">
        <h1 className="text-[28px] leading-9 font-bold">Who are you caring for?</h1>
        <p className="text-ink-muted">This takes about three minutes. You can change it later.</p>
      </div>
      <PatientForm
        initial={{
          fullName: str(patient?.full_name),
          preferredName: str(patient?.preferred_name),
          birthYear: patient ? str(patient.birth_year) : "",
          language: str(patient?.language) || "en",
          timezone: str(patient?.timezone) || "Asia/Kolkata",
          conditions: conditions.map((c) => str(c.name)),
        }}
      />
    </>
  );
}
