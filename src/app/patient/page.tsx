import { redirect } from "next/navigation";
import { PatientScreen } from "@/components/patient/patient-screen";
import { currentDevice, patientConfig, serverDb } from "@/lib/patient/server";
import { loadPatientScreen } from "@/lib/patient/services/screen";

/** Patient mode (PAT-1 to PAT-10). Only a paired device token gets here. */
export default async function PatientPage() {
  const db = serverDb();
  const device = await currentDevice(db);
  if (!device) redirect("/patient/pair");
  const data = await loadPatientScreen(db, device);
  if (!data) redirect("/patient/pair");
  return (
    <PatientScreen
      preferredName={data.preferredName}
      language={data.language}
      timezone={data.timezone}
      contact={data.contact}
      reminder={data.reminder ? { id: data.reminder.id, title: data.reminder.title } : null}
      demoMode={patientConfig().demoMode}
    />
  );
}
