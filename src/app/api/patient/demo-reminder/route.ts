import { rejectCrossSite, respond } from "@/lib/auth/http";
import { deviceApi, patientConfig } from "@/lib/patient/server";
import { createDemoReminder } from "@/lib/patient/services/reminders";

/** Demo only (NEXT_PUBLIC_DEMO_MODE=true): a reminder due now, to test the card before Stage S5. */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const access = await deviceApi();
  if (!access.ok) return access.response;
  return respond(await createDemoReminder(access.db, access.device, patientConfig().demoMode));
}
