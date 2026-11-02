import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Medicines · Nurra" };

/** The live medicine grid arrives in Stage S7. */
export default async function MedicinesPage() {
  await requirePageAccess({ needProfile: true, nextPath: "/app/medicines" });
  return (
    <main className="mx-auto w-full max-w-[560px] flex-1 space-y-2 px-4 py-6">
      <h1 className="text-[28px] leading-9 font-bold">Medicines</h1>
      <p className="text-ink-muted">Coming in a later stage. Medicines are listed in the Vault for now.</p>
    </main>
  );
}
