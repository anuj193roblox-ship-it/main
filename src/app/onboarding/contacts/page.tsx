import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { type ContactInitial, ContactsForm } from "@/components/onboarding/forms";
import { Stepper } from "@/components/onboarding/stepper";
import { str } from "@/lib/care/context";
import type { Row } from "@/lib/care/db";
import { carePage } from "@/lib/care/server";
import { loadOnboarding } from "@/lib/care/services/onboarding";

export const metadata: Metadata = { title: "Set up · Nurra" };

function toInitial(c: Row | undefined): ContactInitial | null {
  if (!c) return null;
  const channels = Array.isArray(c.channels) ? (c.channels as string[]).filter((x): x is "whatsapp" | "call" => x === "whatsapp" || x === "call") : [];
  return { name: str(c.name), phone: str(c.phone), relationship: str(c.relationship), channels, whatsappAgreed: Boolean(c.whatsapp_opt_in_at) };
}

export default async function OnboardingContactsPage() {
  const { ctx, db } = await carePage("/onboarding/contacts");
  const { patient, contacts } = await loadOnboarding(db, ctx);
  if (!patient) redirect("/onboarding/patient");
  return (
    <>
      <Stepper current={2} />
      <div className="space-y-1">
        <h1 className="text-[28px] leading-9 font-bold">Who should Nurra tell?</h1>
        <p className="text-ink-muted">The primary contact hears first. The secondary contact hears if the primary does not answer.</p>
      </div>
      <ContactsForm primary={toInitial(contacts.find((c) => c.priority === "primary"))} secondary={toInitial(contacts.find((c) => c.priority === "secondary"))} />
    </>
  );
}
