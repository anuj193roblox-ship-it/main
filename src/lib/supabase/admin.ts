import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

// Service-role client. Bypasses RLS, so use it only in server code that has already
// checked who the caller is and which household they belong to.
export function createAdminClient() {
  const pub = publicEnv();
  const server = serverEnv();
  return createClient(pub.NEXT_PUBLIC_SUPABASE_URL, server.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
