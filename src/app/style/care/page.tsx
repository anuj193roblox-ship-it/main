import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TabBar } from "@/components/app/tab-bar";
import { ConsentText } from "@/components/onboarding/consent-text";
import { ContactsForm, PatientForm } from "@/components/onboarding/forms";
import { Stepper } from "@/components/onboarding/stepper";
import { PlanScreen } from "@/components/plan/plan-screen";
import { VaultScreen } from "@/components/vault/vault-screen";
import { isStylePageEnabled } from "@/lib/demo";

export const metadata: Metadata = { title: "Nurra style page: care screens" };
export const dynamic = "force-dynamic";

/**
 * Design preview of the Stage S3 screens with made-up data, for checking layout at 390 and 360
 * wide without signing in. Hidden in production unless demo mode is on, like /style.
 * Buttons here call the real API and will be refused without a session.
 */
export default function CareStylePage() {
  if (!isStylePageEnabled()) notFound();
  const every = [0, 1, 2, 3, 4, 5, 6];
  return (
    <main className="mx-auto w-full max-w-[560px] space-y-10 px-4 py-6 pb-24">
      <h1 className="text-[28px] leading-9 font-bold">Care screens (preview)</h1>

      <section className="space-y-4">
        <Stepper current={1} />
        <ConsentText basis="guardian" />
      </section>

      <section className="space-y-4">
        <Stepper current={0} />
        <PatientForm initial={{ fullName: "Sample Person", preferredName: "Sam", birthYear: "1946", language: "en", timezone: "Asia/Kolkata", conditions: ["Mild dementia"] }} />
      </section>

      <section className="space-y-4">
        <ContactsForm
          primary={{ name: "Sample Contact", phone: "+919876543210", relationship: "Daughter", channels: ["whatsapp", "call"], whatsappAgreed: true }}
          secondary={null}
        />
      </section>

      <VaultScreen
        conditions={[{ id: "c1", name: "Mild dementia", since: "2024-03-01", treatingDoctor: "Sample Doctor", notes: "<script>alert(1)</script> shown as text" }]}
        medicines={[
          {
            id: "m1", brandName: "Sample tablet", genericName: "Sample generic", ingredient: "sample", strength: "5 mg", dose: "1 tablet", frequency: "Once a day",
            timing: ["08:00"], withFood: "after", purpose: "Blood pressure", prescriber: "Sample Doctor", startDate: "2024-03-01", stopDate: "", status: "active",
            chips: [{ tone: "warn", icon: "alert-triangle", word: "Unverified" }], canApprove: true, canVerify: false,
          },
          {
            id: "m2", brandName: "Another sample", genericName: "", ingredient: "", strength: "10 mg", dose: "1 tablet", frequency: "At night",
            timing: ["21:00"], withFood: "", purpose: "", prescriber: "", startDate: "", stopDate: "", status: "stopped",
            chips: [{ tone: "ok", icon: "check-circle", word: "Verified by Sample Doctor" }, { tone: "neutral", icon: "clock", word: "Stopped" }], canApprove: false, canVerify: false,
          },
        ]}
        allergies={[{ id: "a1", substance: "Penicillin", reaction: "Rash", severity: "severe" }]}
      />

      <PlanScreen
        presets={[{ key: "dementia", label: "Dementia", summary: "2 medicine, 3 meal, 1 water" }]}
        medicines={[{ id: "m1", label: "Sample tablet 5 mg", unverified: true, stopped: false }]}
        reviews={[
          {
            itemId: "i9", itemTitle: "Evening medicines", medicineName: "Sample tablet",
            changes: [{ field: "dose", label: "Dose", before: "1 tablet", after: "2 tablets" }, { field: "timing", label: "Times", before: "20:00", after: "21:00" }],
            proposal: { times: ["21:00"], deactivate: false },
          },
        ]}
        items={[
          { id: "i1", itemType: "medication", title: "Morning medicines", severity: "important", details: "", schedule: { kind: "times", times: ["08:00"], days: every }, medicationId: null, medicationName: "", medicationUnverified: false, isPlaceholder: true, active: false },
          { id: "i2", itemType: "medication", title: "Evening medicines", severity: "critical", details: "", schedule: { kind: "times", times: ["20:00"], days: every }, medicationId: "m1", medicationName: "Sample tablet 5 mg", medicationUnverified: true, isPlaceholder: false, active: true },
          { id: "i3", itemType: "water", title: "A glass of water", severity: "normal", details: "", schedule: { kind: "interval", everyMinutes: 120, from: "09:00", to: "19:00", days: every }, medicationId: null, medicationName: "", medicationUnverified: false, isPlaceholder: false, active: true },
          { id: "i4", itemType: "appointment", title: "Eye check-up", severity: "normal", details: "Bring the old glasses", schedule: { kind: "once", date: "2026-11-20", times: ["10:30"] }, medicationId: null, medicationName: "", medicationUnverified: false, isPlaceholder: false, active: true },
        ]}
      />
      <TabBar />
    </main>
  );
}
