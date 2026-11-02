import { rejectCrossSite, respond } from "@/lib/auth/http";
import { careApi } from "@/lib/care/server";
import { activate } from "@/lib/care/services/onboarding";

export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const care = await careApi();
  if (!care.ok) return care.response;
  return respond(await activate(care.db, care.ctx));
}
