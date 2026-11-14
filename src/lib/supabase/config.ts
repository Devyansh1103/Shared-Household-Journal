// Public Supabase settings (O4: the publishable key). Both values are safe to
// send to the browser; the service-role key is never read by the app.

/**
 * The session cookies' settings (roadmap Phase 18), for every Supabase client
 * that sets them (src/lib/supabase/server.ts and src/proxy.ts). HttpOnly: no
 * script in the page can read the session; nothing in the browser needs it,
 * since the app only talks to Supabase from the server. Secure in
 * production: sent over HTTPS only (browsers treat http://localhost as secure,
 * so a local production build still works). SameSite=Lax, as before.
 */
export const AUTH_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
} as const;

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. See .env.example.",
    );
  }
  return { url, publishableKey };
}
