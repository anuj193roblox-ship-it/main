import Link from "next/link";
import { PairForm } from "@/components/patient/pair-form";
import { currentDevice } from "@/lib/patient/server";

/** Pair this device with a 6-digit code from the family app. */
export default async function PairPage() {
  const paired = await currentDevice();
  return (
    <main className="mx-auto w-full max-w-[640px] flex-1 space-y-6 px-5 py-8 text-ink">
      <h1 className="text-[40px] leading-[48px] font-bold">Set up this device</h1>
      {paired ? (
        <>
          <p>This device is already paired.</p>
          <Link
            href="/patient"
            className="flex min-h-[72px] w-full items-center justify-center rounded-patient-button bg-primary-pressed px-6 text-[28px] font-semibold text-white"
          >
            Open Nurra
          </Link>
        </>
      ) : (
        <>
          <p>In the family app, open More, then Patient devices, and create a code. Type it here.</p>
          <PairForm />
        </>
      )}
    </main>
  );
}
