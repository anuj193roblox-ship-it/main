import { getClientIp } from "@/lib/auth/client-ip";
import { serverDeps } from "@/lib/auth/deps";
import { readJsonBody, rejectCrossSite, respond, touchActivity } from "@/lib/auth/http";
import { login } from "@/lib/auth/services/login";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;

  const body = await readJsonBody(request);
  const deps = serverDeps("/api/auth/login");
  const supabase = await createSupabaseServerClient();

  const result = await login(body, { ip: getClientIp(request.headers) }, {
    ...deps,
    minMs: deps.config.loginMinMs,
    async signInWithPassword(email, password, captchaToken) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: captchaToken ? { captchaToken } : undefined,
      });
      if (error) {
        deps.logStep("supabase", error.code);
        return { errorCode: error.code ?? "unknown" };
      }
      return data.user ? { userId: data.user.id } : null;
    },
  });

  if (result.userId) await touchActivity(result.userId);
  return respond(result);
}
