import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { deviceApi } from "@/lib/patient/server";
import { answerReminder } from "@/lib/patient/services/reminders";

type Params = { params: Promise<{ id: string }> };

/** Patient device: answer the reminder card. { answer: "taken" | "not_yet", source: "tap" | "voice", transcript? } */
export async function POST(request: Request, { params }: Params) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const access = await deviceApi();
  if (!access.ok) return access.response;
  const { id } = await params;
  return respond(await answerReminder(id, await readJsonBody(request), access.db, access.device));
}
