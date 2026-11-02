import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { type Db, supabaseDb } from "@/lib/care/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateDevice, DEVICE_COOKIE, DEVICE_TOKEN_TTL_MS, type DeviceContext } from "./device";

export const NOT_PAIRED = "This device is not paired. Ask your family to pair it again.";

/**
 * Server data access for patient devices. The service role bypasses RLS, so every query in the
 * patient services is scoped by the patient and household taken from the device token.
 */
export function serverDb(): Db {
  return supabaseDb(createAdminClient());
}

export function patientConfig(env: Record<string, string | undefined> = process.env) {
  const cap = Number.parseInt(env.CHECKIN_DAILY_MODEL_CAP ?? "", 10);
  return {
    alertsDeliveryEnabled: env.ALERTS_DELIVERY_ENABLED === "true",
    dailyCap: Number.isFinite(cap) && cap > 0 ? cap : 300,
    demoMode: env.NEXT_PUBLIC_DEMO_MODE === "true",
  };
}

/** The paired device for this browser, or null. Never a family session. */
export async function currentDevice(db: Db = serverDb()): Promise<DeviceContext | null> {
  const store = await cookies();
  return authenticateDevice(db, store.get(DEVICE_COOKIE)?.value);
}

/** For device route handlers, after the Origin check. */
export async function deviceApi(): Promise<{ ok: true; device: DeviceContext; db: Db } | { ok: false; response: NextResponse }> {
  const db = serverDb();
  const device = await currentDevice(db);
  if (!device) return { ok: false, response: NextResponse.json({ error: NOT_PAIRED }, { status: 401, headers: { "Cache-Control": "no-store" } }) };
  return { ok: true, device, db };
}

/** httpOnly, Secure (production), SameSite=Strict, 90 days. */
export async function setDeviceCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(DEVICE_TOKEN_TTL_MS / 1000),
  });
}
