import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

// Browser-safe client. Uses the anon key only, so row-level security applies to every query.
export function createBrowserClient() {
  const env = publicEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
