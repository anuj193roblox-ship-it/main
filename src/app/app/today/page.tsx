import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Today · Nurra" };

/** Placeholder for the family dashboard (Stage S7). Shows no patient data. */
export default async function TodayPage() {
  await requirePageAccess({ needProfile: true, nextPath: "/app/today" });
  return (
    <main className="mx-auto w-full max-w-[420px] flex-1 space-y-2 px-6 py-8">
      <h1 className="text-[28px] leading-9 font-bold">Today</h1>
      <p className="text-ink-muted">The day&apos;s updates for your household will appear here.</p>
    </main>
  );
}
