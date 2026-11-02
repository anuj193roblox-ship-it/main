import { serverDeps } from "@/lib/auth/deps";
import { rejectCrossSite, respond } from "@/lib/auth/http";
import { careApi } from "@/lib/care/server";
import { serverDb } from "@/lib/patient/server";
import { revokeDevice } from "@/lib/patient/services/pairing";

type Params = { params: Promise<{ id: string }> };

/** Family: revoke a paired patient device in their own household. */
export async function POST(request: Request, { params }: Params) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const care = await careApi();
  if (!care.ok) return care.response;
  const { id } = await params;
  return respond(await revokeDevice(id, serverDb(), care.ctx, { audit: serverDeps("/api/devices/revoke").audit }));
}
