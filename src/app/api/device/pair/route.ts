import { getClientIp } from "@/lib/auth/client-ip";
import { serverDeps } from "@/lib/auth/deps";
import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { serverDb, setDeviceCookie } from "@/lib/patient/server";
import { pairDevice } from "@/lib/patient/services/pairing";

/** Patient device: exchange a pairing code for a device token (httpOnly cookie). */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const deps = serverDeps("/api/device/pair");
  const result = await pairDevice(await readJsonBody(request), { ip: getClientIp(request.headers) }, serverDb(), {
    limiter: deps.limiter,
    audit: deps.audit,
    secret: deps.config.sessionSecret,
  });
  if (result.token) await setDeviceCookie(result.token);
  // The token is only ever in the httpOnly cookie, never in the response body.
  return respond({ status: result.status, body: result.body, headers: result.headers });
}
