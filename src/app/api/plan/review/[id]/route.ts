import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { careApi } from "@/lib/care/server";
import { decideReview } from "@/lib/care/services/plan";

type Params = { params: Promise<{ id: string }> };

/** "Apply this change to the reminders?" decision for one plan item: { decision: "apply" | "keep" }. */
export async function POST(request: Request, { params }: Params) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const care = await careApi();
  if (!care.ok) return care.response;
  const { id } = await params;
  return respond(await decideReview(id, await readJsonBody(request), care.db, care.ctx));
}
