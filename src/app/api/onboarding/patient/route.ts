import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { careApi } from "@/lib/care/server";
import { savePatient } from "@/lib/care/services/onboarding";

export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const care = await careApi();
  if (!care.ok) return care.response;
  return respond(await savePatient(await readJsonBody(request), care.db, care.ctx));
}
