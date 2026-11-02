import "server-only";
import type { NextResponse } from "next/server";
import { requireApiAccess, requirePageAccess } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CareCtx } from "./context";
import { type Db, supabaseDb } from "./db";

/**
 * For route handlers, after the Origin check: a signed-in, verified household member (with
 * two-step sign-in where required). The context comes from the session only. The data layer uses
 * the user's own session, so RLS and the database triggers apply to every read and write.
 */
export async function careApi(): Promise<{ ok: true; ctx: CareCtx; db: Db } | { ok: false; response: NextResponse }> {
  const access = await requireApiAccess({ needProfile: true });
  if (!access.ok) return access;
  const { user, profile } = access.state;
  if (!profile) throw new Error("profile required");
  return {
    ok: true,
    ctx: { userId: user.id, householdId: profile.householdId, role: profile.role },
    db: supabaseDb(await createSupabaseServerClient()),
  };
}

/** For pages: same checks, redirecting instead of answering 401/403. */
export async function carePage(nextPath: string): Promise<{ ctx: CareCtx; db: Db }> {
  const { user, profile } = await requirePageAccess({ needProfile: true, nextPath });
  if (!profile) throw new Error("profile required");
  return {
    ctx: { userId: user.id, householdId: profile.householdId, role: profile.role },
    db: supabaseDb(await createSupabaseServerClient()),
  };
}
