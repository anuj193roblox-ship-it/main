import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { deviceApi } from "@/lib/patient/server";
import { logCallFamily } from "@/lib/patient/services/screen";

/** Patient device: "Call my family" was tapped. The call itself is the phone's tel: link. */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const access = await deviceApi();
  if (!access.ok) return access.response;
  return respond(await logCallFamily(access.db, access.device, await readJsonBody(request)));
}
