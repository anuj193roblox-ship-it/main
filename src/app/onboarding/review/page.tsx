import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActivateButton, LANGUAGE_OPTIONS } from "@/components/onboarding/forms";
import { Stepper } from "@/components/onboarding/stepper";
import { StatusChip } from "@/components/status-chip";
import { str } from "@/lib/care/context";
import { formatDay } from "@/lib/care/format";
import { carePage } from "@/lib/care/server";
import { loadOnboarding } from "@/lib/care/services/onboarding";

export const metadata: Metadata = { title: "Set up · Nurra" };

function Section({ title, edit, children }: { title: string; edit: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-card border border-line bg-primary-tint p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl leading-7 font-semibold">{title}</h2>
        <Link href={edit} className="inline-flex min-h-12 items-center text-primary underline">
          Change
        </Link>
      </div>
      {children}
    </section>
  );
}

export default async function OnboardingReviewPage() {
  const { ctx, db } = await carePage("/onboarding/review");
  const { patient, conditions, consent, contacts } = await loadOnboarding(db, ctx);
  if (!patient) redirect("/onboarding/patient");
  const primary = contacts.find((c) => c.priority === "primary");
  const secondary = contacts.find((c) => c.priority === "secondary");
  const language = LANGUAGE_OPTIONS.find((l) => l.value === patient.language)?.label ?? str(patient.language);

  return (
    <>
      <Stepper current={3} />
      <h1 className="text-[28px] leading-9 font-bold">Check and turn on</h1>

      <Section title="Person" edit="/onboarding/patient">
        <p className="text-lg font-semibold">{str(patient.full_name)}</p>
        <p>
          Called {str(patient.preferred_name)}, born {str(patient.birth_year)}. Speaks {language}. Time zone {str(patient.timezone)}.
        </p>
        <p className="text-ink-muted">{conditions.length ? `Conditions: ${conditions.map((c) => str(c.name)).join(", ")}` : "No conditions added yet."}</p>
      </Section>

      <Section title="Consent" edit="/onboarding/consent">
        {consent ? (
          <>
            <StatusChip tone="ok" icon="check-circle" word="Recorded" />
            <p>
              Given by {str(consent.given_by)} ({consent.basis === "guardian" ? "guardian" : "the person themselves"}) on {formatDay(consent.given_at)}.
            </p>
          </>
        ) : (
          <StatusChip tone="warn" icon="alert-triangle" word="Not recorded yet" />
        )}
      </Section>

      <Section title="Contacts" edit="/onboarding/contacts">
        {primary ? (
          <ul className="space-y-2">
            {[primary, secondary].filter(Boolean).map((c) => (
              <li key={str(c!.id)}>
                <p className="font-semibold">
                  {c!.priority === "primary" ? "Primary" : "Secondary"}: {str(c!.name)}
                  {c!.relationship ? `, ${str(c!.relationship)}` : ""}
                </p>
                <p className="text-ink-muted">{str(c!.phone)}</p>
                {c!.whatsapp_opt_in_at ? (
                  <StatusChip tone="ok" icon="check-circle" word="Agreed to WhatsApp" />
                ) : (
                  <StatusChip tone="neutral" icon="clock" word="No WhatsApp agreement" />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <StatusChip tone="warn" icon="alert-triangle" word="No primary contact yet" />
        )}
      </Section>

      <ActivateButton />
    </>
  );
}
