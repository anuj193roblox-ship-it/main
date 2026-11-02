// Shared by server and browser code. No secrets here.

/** Sign out after this much inactivity (spec AUTH-8). */
export const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;
/** Show the "you will be signed out" warning at this point. */
export const INACTIVITY_WARNING_MS = 28 * 60 * 1000;
/** While the user is active, tell the server at most this often. */
export const ACTIVITY_PING_INTERVAL_MS = 5 * 60 * 1000;
/** A password-reset link must be used within this window after it is opened. */
export const RECOVERY_WINDOW_MS = 15 * 60 * 1000;

/** httpOnly cookie holding the signed time of the last activity. */
export const ACTIVITY_COOKIE = "nurra_activity";
/** httpOnly cookie proving the session came from a password-reset link. */
export const RECOVERY_COOKIE = "nurra_recovery";
/** localStorage key so all open tabs share one idle timer. Holds a timestamp only. */
export const ACTIVITY_STORAGE_KEY = "nurra_last_activity";
