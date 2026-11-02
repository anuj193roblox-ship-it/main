import { rejectCrossSite, respond } from "@/lib/auth/http";
import { NOT_FOUND } from "@/lib/care/context";
import { careApi } from "@/lib/care/server";
import { approveMedicine, verifyMedicine } from "@/lib/care/services/vault";

type Params = { params: Promise<{ kind: string; id: string; action: string }> };

/** POST /api/vault/medications/:id/approve and /verify. */
export async function POST(request: Request, { params }: Params) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const care = await careApi();
  if (!care.ok) return care.response;
  const { kind, id, action } = await params;
  if (kind !== "medications") return respond(NOT_FOUND);
  if (action === "approve") return respond(await approveMedicine(id, care.db, care.ctx));
  if (action === "verify") return respond(await verifyMedicine(id, care.db, care.ctx));
  return respond(NOT_FOUND);
}
