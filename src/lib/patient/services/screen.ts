// What the patient screen needs, scoped to the device's own patient.
import { z } from "zod";
import type { ServiceResult } from "@/lib/auth/services/result";
import { str } from "@/lib/care/context";
import type { Db } from "@/lib/care/db";
import type { DeviceContext } from "../device";
import { dueReminder } from "./reminders";

export type PatientScreenData = {
  preferredName: string;
  language: "en" | "hi" | "kn";
  timezone: string;
  contact: { name: string; phone: string } | null;
  reminder: { id: string; title: string; dueTime: string } | null;
};

export async function loadPatientScreen(db: Db, device: DeviceContext, now: Date = new Date()): Promise<PatientScreenData | null> {
  const [patient] = await db.select("patients", { id: device.patientId, household_id: device.householdId });
  if (!patient) return null;
  const contacts = await db.select("contacts", { patient_id: device.patientId, household_id: device.householdId });
  const primary = contacts.find((c) => c.priority === "primary" && c.phone);
  const due = await dueReminder(db, device, now);
  const lang = str(patient.language);
  return {
    preferredName: str(patient.preferred_name) || "friend",
    language: lang === "hi" || lang === "kn" ? lang : "en",
    timezone: str(patient.timezone) || "Asia/Kolkata",
    contact: primary ? { name: str(primary.name), phone: str(primary.phone) } : null,
    reminder: due ? { id: due.id, title: due.title, dueTime: due.dueTime } : null,
  };
}

/** "Call my family" tap: logged as an event. The call itself is the phone's tel: link. */
export async function logCallFamily(db: Db, device: DeviceContext, raw: unknown): Promise<ServiceResult> {
  const parsed = z.object({ reason: z.enum(["button", "red_flag"]).default("button") }).safeParse(raw ?? {});
  await db.insert("events", {
    household_id: device.householdId,
    patient_id: device.patientId,
    kind: "call_family",
    severity: "info",
    payload: { reason: parsed.success ? parsed.data.reason : "button" },
  });
  return { status: 200, body: { ok: true } };
}
