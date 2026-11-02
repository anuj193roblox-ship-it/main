import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PatientScreen } from "@/components/patient/patient-screen";
import { isStylePageEnabled } from "@/lib/demo";

export const metadata: Metadata = { title: "Nurra style page: patient mode" };
export const dynamic = "force-dynamic";

/**
 * Design preview of patient mode with made-up data, placed inside a dark-mode container to show
 * that it stays light. Hidden in production unless demo mode is on, like /style. Buttons call the
 * real API and are refused here because this browser is not a paired device.
 */
export default async function PatientStylePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isStylePageEnabled()) notFound();
  const withReminder = (await searchParams).reminder === "1";
  return (
    <div data-theme="dark" className="flex flex-1 flex-col bg-bg">
      <div className="theme-light flex flex-1 flex-col bg-patient font-patient text-[28px] leading-10 text-ink">
        <PatientScreen
          preferredName="Meera"
          language="en"
          timezone="Asia/Kolkata"
          contact={{ name: "Anita", phone: "+910000000001" }}
          reminder={withReminder ? { id: "00000000-0000-4000-8000-000000000000", title: "Morning medicines" } : null}
          demoMode={false}
        />
      </div>
    </div>
  );
}
