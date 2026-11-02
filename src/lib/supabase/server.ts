import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
import { AUTH_COOKIE_OPTIONS } from "./cookie-options";

export { AUTH_COOKIE_OPTIONS };

/**
 * Supabase client for Server Components, Route Handlers and Server Actions (Supabase SSR pattern).
 * Uses the anon key and the user's session, so row-level security applies.
 */
export async function createSupabaseServerClient() {
  const store = await cookies();
  const env = publicEnv();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, { ...options, ...AUTH_COOKIE_OPTIONS });
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the session on navigation.
        }
      },
    },
  });
}
