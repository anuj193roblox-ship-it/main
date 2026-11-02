/** True only when NEXT_PUBLIC_DEMO_MODE is exactly "true". Anything else (unset, "1", "TRUE") is off. */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

/** Internal pages such as /style are open in development and hidden in production unless demo mode is on. */
export function isStylePageEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || isDemoMode();
}
