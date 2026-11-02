import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { careApi } from "@/lib/care/server";
import { deletePlanItem, updatePlanItem } from "@/lib/care/services/plan";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const care = await careApi();
  if (!care.ok) return care.response;
  const { id } = await params;
  return respond(await updatePlanItem(id, await readJsonBody(request), care.db, care.ctx));
}

export async function DELETE(request: Request, { params }: Params) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const care = await careApi();
  if (!care.ok) return care.response;
  const { id } = await params;
  return respond(await deletePlanItem(id, care.db, care.ctx));
}
