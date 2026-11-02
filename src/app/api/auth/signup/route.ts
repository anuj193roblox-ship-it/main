import { getClientIp } from "@/lib/auth/client-ip";
import { serverDeps } from "@/lib/auth/deps";
import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { signup } from "@/lib/auth/services/signup";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;

  const body = await readJsonBody(request);
  const deps = serverDeps("/api/auth/signup");
  const supabase = await createSupabaseServerClient();

  const result = await signup(body, { ip: getClientIp(request.headers) }, {
    ...deps,
    siteUrl: deps.config.siteUrl,
    minMs: deps.config.signupMinMs,
    async signUp(email, password, emailRedirectTo, captchaToken) {
      // No user metadata: role and household are never taken from sign-up.
      const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo, captchaToken } });
      if (error) deps.logStep("supabase", error.code);
      return { errorCode: error?.code ?? null };
    },
  });
  return respond(result);
}
