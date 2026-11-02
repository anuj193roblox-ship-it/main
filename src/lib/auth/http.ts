import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/server";
import { signActivity, signRecovery } from "./activity";
import { isSameOriginRequest } from "./origin";
import { authConfig } from "./server-config";
import type { ServiceResult } from "./services/result";
import { ACTIVITY_COOKIE, RECOVERY_COOKIE } from "./session-timing";

const MAX_BODY_BYTES = 16 * 1024;

/** Call first in every state-changing route handler. Returns a 403 for cross-site requests. */
export function rejectCrossSite(request: Request): NextResponse | null {
  if (isSameOriginRequest(request, [authConfig().siteUrl])) return null;
  return NextResponse.json({ error: "This request was blocked." }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

/** Parses a small JSON body. Anything else becomes null, which every schema rejects. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return null;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function respond(result: ServiceResult): NextResponse {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { ...result.headers, "Cache-Control": "no-store" },
  });
}

/** Marks the user active now. Without this cookie, the app treats the session as timed out. */
export async function touchActivity(userId: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVITY_COOKIE, await signActivity(userId, Date.now(), authConfig().sessionSecret), {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: 12 * 60 * 60,
  });
}

/** Marks this browser as having just opened a password-reset link for this user. */
export async function markRecovery(userId: string): Promise<void> {
  const store = await cookies();
  store.set(RECOVERY_COOKIE, await signRecovery(userId, Date.now(), authConfig().sessionSecret), {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: 15 * 60,
  });
}

export async function clearAppCookies(): Promise<void> {
  const store = await cookies();
  store.delete({ name: ACTIVITY_COOKIE, path: "/" });
  store.delete({ name: RECOVERY_COOKIE, path: "/" });
}
