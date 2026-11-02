import { serverDeps } from "@/lib/auth/deps";
import { rejectCrossSite, respond } from "@/lib/auth/http";
import { careApi } from "@/lib/care/server";
import { serverDb } from "@/lib/patient/server";
import { createPairingCode } from "@/lib/patient/services/pairing";

/** Family: create a 6-digit pairing code for the current patient (10 minutes, single use). */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const care = await careApi();
  if (!care.ok) return care.response;
  const deps = serverDeps("/api/devices/pairing");
  return respond(await createPairingCode(care.db, serverDb(), care.ctx, { limiter: deps.limiter, audit: deps.audit, secret: deps.config.sessionSecret }));
}
