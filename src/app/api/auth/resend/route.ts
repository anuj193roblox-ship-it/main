import { getClientIp } from "@/lib/auth/client-ip";
import { serverDeps } from "@/lib/auth/deps";
import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { requestEmailLink } from "@/lib/auth/services/password";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Resend the sign-up verification email. Same answer whether or not the email exists. */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;

  const body = await readJsonBody(request);
  const deps = serverDeps("/api/auth/resend");
  const supabase = await createSupabaseServerClient();

  const result = await requestEmailLink("verify", body, { ip: getClientIp(request.headers) }, {
    ...deps,
    siteUrl: deps.config.siteUrl,
    minMs: deps.config.signupMinMs,
    async send(email, redirectTo, captchaToken) {
      const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo, captchaToken } });
      if (error) {
        deps.logStep("supabase", error.code);
        return { errorCode: error.code ?? "unknown" };
      }
    },
  });
  return respond(result);
}
