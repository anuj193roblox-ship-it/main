import type { Metadata } from "next";

// No names or health details in the title.
export const metadata: Metadata = { title: "Nurra" };

/**
 * Patient mode: always light (the .theme-light reset wins even in dark mode), warm cream background,
 * Nunito, large text. No family session is used here: only the paired device token.
 */
export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return <div className="theme-light flex flex-1 flex-col bg-patient font-patient text-[28px] leading-10 text-ink">{children}</div>;
}
