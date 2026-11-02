import type { SessionState } from "@/lib/auth/access";

/**
 * Where "/" sends a visitor. A verified, active session goes into the app (no household yet:
 * /app/start, as the app itself does). Everyone else sees the sample dashboard (null).
 */
export function homeRedirect(state: SessionState): string | null {
  if (!state.user || !state.activityValid || !state.user.emailVerified) return null;
  return state.profile ? "/app/today" : "/app/start";
}
