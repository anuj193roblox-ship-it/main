// Auth events go to audit_log with ids and an action name only.
// Never pass emails, names, passwords, tokens, IP addresses or codes here.
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthAuditAction =
  | "auth.login_success"
  | "auth.login_failure"
  | "auth.rate_limited"
  | "auth.logout"
  | "auth.session_timeout"
  | "auth.signup_requested"
  | "auth.email_verified"
  | "auth.verify_email_resent"
  | "auth.password_reset_requested"
  | "auth.password_reset_link_used"
  | "auth.password_changed"
  | "auth.mfa_enrolled"
  | "auth.mfa_verified"
  | "auth.mfa_failure"
  | "auth.invite_created"
  | "auth.invite_rejected"
  | "device.pairing_code_created"
  | "device.pair_failed"
  | "device.revoked";

export type AuditEvent = {
  action: AuthAuditAction;
  actorId?: string | null;
  householdId?: string | null;
  recordId?: string | null;
};

export type AuditLogger = (event: AuditEvent) => Promise<void>;

/** Writes with the service role (audit_log has no client write policy). Never throws. */
export function createAuditLogger(admin: SupabaseClient): AuditLogger {
  return async (event) => {
    const { error } = await admin.from("audit_log").insert({
      action: event.action,
      table_name: "auth",
      actor_id: event.actorId ?? null,
      household_id: event.householdId ?? null,
      record_id: event.recordId ?? null,
    });
    if (error) console.error("audit write failed", event.action);
  };
}

/** Collects events in memory, for tests. */
export function createMemoryAuditLogger(): AuditLogger & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  const logger = (async (event: AuditEvent) => {
    events.push(event);
  }) as AuditLogger & { events: AuditEvent[] };
  logger.events = events;
  return logger;
}
