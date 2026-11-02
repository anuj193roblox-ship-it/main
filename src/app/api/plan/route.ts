import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { careApi } from "@/lib/care/server";
import { applyPreset } from "@/lib/care/services/plan";

/** Fill an empty plan from a preset. */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const care = await careApi();
  if (!care.ok) return care.response;
  return respond(await applyPreset(await readJsonBody(request), care.db, care.ctx));
}
