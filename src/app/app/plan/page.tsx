import type { Metadata } from "next";
import Link from "next/link";
import { type MedicineOption, type PlanItemView, PlanScreen, type PresetOption } from "@/components/plan/plan-screen";
import type { ReviewView } from "@/components/plan/review-prompt";
import { str } from "@/lib/care/context";
import { ITEM_TYPE_LABELS } from "@/lib/care/format";
import { isUnverified } from "@/lib/care/medicine-chips";
import { PRESET_LABELS, PRESET_ORDER, PRESETS } from "@/lib/care/presets";
import { carePage } from "@/lib/care/server";
import { loadPlan, scheduleOf } from "@/lib/care/services/plan";

export const metadata: Metadata = { title: "Plan · Nurra" };

function firstTime(item: PlanItemView): string {
  const s = item.schedule;
  return s.kind === "interval" ? s.from : (s.times[0] ?? "99:99");
}

export default async function PlanPage() {
  const { ctx, db } = await carePage("/app/plan");
  const plan = await loadPlan(db, ctx);

  if (!plan.patient) {
    return (
      <main className="mx-auto w-full max-w-[560px] flex-1 space-y-4 px-4 py-6">
        <h1 className="text-[28px] leading-9 font-bold">Plan</h1>
        <p className="text-ink-muted">The care plan holds the day&apos;s routine: medicines, meals, water, activity and sleep.</p>
        <Link href="/onboarding/patient" className="inline-flex min-h-12 w-full items-center justify-center rounded-input bg-primary px-4 font-medium text-white hover:bg-primary-pressed">
          Add the person you care for
        </Link>
      </main>
    );
  }

  const meds = new Map(plan.medicines.map((m) => [m.id, m]));
  const items: PlanItemView[] = plan.items
    .map((i) => {
      const med = i.medication_id ? meds.get(i.medication_id) : undefined;
      return {
        id: str(i.id),
        itemType: str(i.item_type),
        title: str(i.title),
        severity: i.severity === "important" || i.severity === "critical" ? i.severity : "normal",
        details: str(i.details),
        schedule: scheduleOf(i),
        medicationId: med ? str(med.id) : null,
        medicationName: med ? [str(med.brand_name), str(med.strength)].filter(Boolean).join(" ") : "",
        medicationUnverified: med ? isUnverified(med) : false,
        isPlaceholder: i.is_placeholder === true,
        active: i.active !== false,
      } satisfies PlanItemView;
    })
    .sort((a, b) => firstTime(a).localeCompare(firstTime(b)));

  const medicines: MedicineOption[] = plan.medicines.map((m) => ({
    id: str(m.id),
    label: [str(m.brand_name), str(m.strength)].filter(Boolean).join(" "),
    unverified: isUnverified(m),
    stopped: m.status === "stopped",
  }));

  const presets: PresetOption[] = PRESET_ORDER.map((key) => {
    const counts = new Map<string, number>();
    for (const item of PRESETS[key].items) counts.set(item.itemType, (counts.get(item.itemType) ?? 0) + 1);
    const summary = [...counts].map(([t, n]) => `${n} ${(ITEM_TYPE_LABELS[t] ?? t).toLowerCase()}`).join(", ");
    return { key, label: PRESET_LABELS[key], summary };
  });

  const reviews: ReviewView[] = plan.reviews.map((r) => ({
    itemId: r.itemId,
    itemTitle: r.itemTitle,
    medicineName: r.medicineName,
    changes: r.changes,
    proposal: r.proposal,
  }));

  return (
    <main className="mx-auto w-full max-w-[560px] flex-1 space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-[28px] leading-9 font-bold">Plan</h1>
        <p className="text-ink-muted">{str(plan.patient.preferred_name)}&apos;s day.</p>
      </div>
      <PlanScreen items={items} medicines={medicines} reviews={reviews} presets={presets} />
    </main>
  );
}
