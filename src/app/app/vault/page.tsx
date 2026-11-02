import type { Metadata } from "next";
import Link from "next/link";
import { type AllergyView, type ConditionView, type MedicineView, VaultScreen } from "@/components/vault/vault-screen";
import { canApproveMedicine, canVerifyMedicine, hhmm, str } from "@/lib/care/context";
import { medicineChips } from "@/lib/care/medicine-chips";
import { carePage } from "@/lib/care/server";
import { loadVault } from "@/lib/care/services/vault";

// Generic title: no names or health details in page titles.
export const metadata: Metadata = { title: "Vault · Nurra" };

export default async function VaultPage() {
  const { ctx, db } = await carePage("/app/vault");
  const vault = await loadVault(db, ctx);

  if (!vault.patient) {
    return (
      <main className="mx-auto w-full max-w-[560px] flex-1 space-y-4 px-4 py-6">
        <h1 className="text-[28px] leading-9 font-bold">Vault</h1>
        <p className="text-ink-muted">The vault keeps conditions, medicines and allergies for the person you care for.</p>
        <Link href="/onboarding/patient" className="inline-flex min-h-12 w-full items-center justify-center rounded-input bg-primary px-4 font-medium text-white hover:bg-primary-pressed">
          Add the person you care for
        </Link>
      </main>
    );
  }

  const conditions: ConditionView[] = vault.conditions.map((c) => ({
    id: str(c.id),
    name: str(c.name),
    since: str(c.since).slice(0, 10),
    treatingDoctor: str(c.treating_doctor),
    notes: str(c.notes),
  }));
  const medicines: MedicineView[] = vault.medications.map((m) => ({
    id: str(m.id),
    brandName: str(m.brand_name),
    genericName: str(m.generic_name),
    ingredient: str(m.ingredient),
    strength: str(m.strength),
    dose: str(m.dose),
    frequency: str(m.frequency),
    timing: Array.isArray(m.timing) ? m.timing.map(hhmm) : [],
    withFood: (str(m.with_food) as MedicineView["withFood"]) || "",
    purpose: str(m.purpose),
    prescriber: str(m.prescriber),
    startDate: str(m.start_date).slice(0, 10),
    stopDate: str(m.stop_date).slice(0, 10),
    status: m.status === "stopped" ? "stopped" : "active",
    chips: medicineChips(m, vault.names),
    canApprove: canApproveMedicine(ctx.role) && !m.approved_by && !m.verified_by,
    canVerify: canVerifyMedicine(ctx.role) && !m.verified_by,
  }));
  const allergies: AllergyView[] = vault.allergies.map((a) => ({
    id: str(a.id),
    substance: str(a.substance),
    reaction: str(a.reaction),
    severity: a.severity === "mild" || a.severity === "severe" ? a.severity : "moderate",
  }));

  return (
    <main className="mx-auto w-full max-w-[560px] flex-1 space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-[28px] leading-9 font-bold">Vault</h1>
        <p className="text-ink-muted">For {str(vault.patient.preferred_name)}. Every change is recorded with who made it.</p>
      </div>
      <VaultScreen conditions={conditions} medicines={medicines} allergies={allergies} />
    </main>
  );
}
