import { serverDeps } from "@/lib/auth/deps";
import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { createAnthropicModel } from "@/lib/patient/model-anthropic";
import { deviceApi, patientConfig } from "@/lib/patient/server";
import { checkin } from "@/lib/patient/services/checkin";

/** Patient check-in. Authenticated only by the device token. Transcripts are never logged. */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const access = await deviceApi();
  if (!access.ok) return access.response;
  const config = patientConfig();
  return respond(
    await checkin(await readJsonBody(request), access.device, {
      db: access.db,
      model: createAnthropicModel(),
      limiter: serverDeps("/api/checkin").limiter,
      dailyCap: config.dailyCap,
      alertsDeliveryEnabled: config.alertsDeliveryEnabled,
    }),
  );
}
