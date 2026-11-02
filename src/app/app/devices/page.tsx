import type { Metadata } from "next";
import Link from "next/link";
import { type DeviceRow, DevicesScreen } from "@/components/devices/devices-screen";
import { canOnboard, currentPatient } from "@/lib/care/context";
import { carePage } from "@/lib/care/server";
import { serverDb } from "@/lib/patient/server";
import { listDevices } from "@/lib/patient/services/pairing";

export const metadata: Metadata = { title: "Patient devices · Nurra" };

export default async function DevicesPage() {
  const { ctx, db } = await carePage("/app/devices");
  const patient = await currentPatient(db, ctx);
  const devices: DeviceRow[] = (await listDevices(serverDb(), ctx)).map((d) => ({
    id: d.id,
    label: d.label,
    pairedAt: d.pairedAt,
    lastUsedAt: d.lastUsedAt,
    revoked: d.revoked,
    expired: d.expired,
  }));

  return (
    <main className="mx-auto w-full max-w-[560px] flex-1 space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-[28px] leading-9 font-bold">Patient devices</h1>
        <p className="text-ink-muted">The phone or tablet the person uses with Nurra. No login is needed there: it is paired with a one-time code.</p>
      </div>
      {patient ? (
        <DevicesScreen devices={devices} canManage={canOnboard(ctx.role)} />
      ) : (
        <Link href="/onboarding/patient" className="inline-flex min-h-12 w-full items-center justify-center rounded-input bg-primary px-4 font-medium text-white hover:bg-primary-pressed">
          Add the person you care for first
        </Link>
      )}
    </main>
  );
}
