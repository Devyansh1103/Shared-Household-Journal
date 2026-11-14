import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { AUTH_COOKIE_OPTIONS, supabaseConfig } from "./config";
import type { Database } from "./database.types";

/**
 * A Supabase client acting as the signed-in user, from the session cookie.
 * Create one per request. Queries run under RLS as `authenticated` (or `anon`
 * with no session).
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = supabaseConfig();

  return createServerClient<Database>(url, publishableKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components can't set cookies. The proxy refreshes the
          // session, so this is safe to ignore there; Server Actions and Route
          // Handlers can set cookies and don't reach this branch.
        }
      },
    },
  });
}
