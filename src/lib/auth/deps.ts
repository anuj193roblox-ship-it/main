import "server-only";
import { ZodError } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuditLogger } from "./audit";
import { createTurnstilePolicy } from "./captcha";
import { type AuthStep, logAuthStep } from "./dev-log";
import { createDbRateLimiter } from "./rate-limit";
import { authConfig } from "./server-config";

/**
 * Real dependencies for the auth services. The service-role client is used only for the
 * rate limiter, the audit log and the server-only SQL functions, always with a user id taken
 * from the verified session.
 *
 * @param route used only in development log lines, to say where a step failed.
 */
export function serverDeps(route: string) {
  const config = authConfig(route);
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    // A malformed or missing Supabase URL or key: name the setting, never its value.
    const names = e instanceof ZodError ? e.issues.map((i) => String(i.path[0])) : ["supabase-client"];
    for (const name of names) logAuthStep(route, "supabase", name, { detail: "missing-or-malformed" });
    throw e;
  }
  const logStep = (step: AuthStep, code?: string, detail?: string) => logAuthStep(route, step, code, { detail });
  return {
    config,
    admin,
    logStep,
    limiter: createDbRateLimiter(admin, (code, detail) => logStep("rate-limit", code, detail)),
    audit: createAuditLogger(admin),
    captcha: createTurnstilePolicy(config.turnstileSecretKey, config.supabaseVerifiesCaptcha, fetch, (code) =>
      logStep("turnstile", code),
    ),
    async householdOf(userId: string): Promise<string | null> {
      const { data } = await admin.from("users").select("household_id").eq("id", userId).maybeSingle();
      return (data?.household_id as string | undefined) ?? null;
    },
  };
}
