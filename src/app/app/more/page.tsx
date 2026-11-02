import type { Metadata } from "next";
import Link from "next/link";
import { requirePageAccess } from "@/lib/auth/session";

export const metadata: Metadata = { title: "More · Nurra" };

export default async function MorePage() {
  await requirePageAccess({ needProfile: true, nextPath: "/app/more" });
  return (
    <main className="mx-auto w-full max-w-[560px] flex-1 space-y-4 px-4 py-6">
      <h1 className="text-[28px] leading-9 font-bold">More</h1>
      <p className="text-ink-muted">Coming in a later stage.</p>
      <ul className="space-y-3">
        <li>
          <Link href="/app/devices" className="inline-flex min-h-12 items-center text-primary underline">
            Patient devices
          </Link>
        </li>
        <li>
          <Link href="/app/account" className="inline-flex min-h-12 items-center text-primary underline">
            Account settings
          </Link>
        </li>
      </ul>
    </main>
  );
}
