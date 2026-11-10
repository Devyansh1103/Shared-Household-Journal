import "server-only";
import { cache } from "react";
import { io } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RETURN_PATH_HEADER, signInPath } from "./return-path";

// Data access layer for the session. Every protected page, layout and Server
// Action checks the user here; the proxy only refreshes cookies (ADR-002).

export type CurrentUser = { id: string; email: string };

export type Profile = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

/**
 * The signed-in user, or null. `getUser()` asks Supabase Auth, so a session
 * that was signed out or revoked is rejected rather than trusted from the
 * cookie. Runs once per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // Supabase reads the clock to check the session, which is request-time work:
  // tell Next.js, so prefetch prerendering stops here instead of logging an error.
  await io();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
});

/** The signed-in user; otherwise redirects to sign-in, returning here afterwards. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const requested = (await headers()).get(RETURN_PATH_HEADER);
    redirect(signInPath(requested));
  }
  return user;
}

/** The signed-in user's own profile, read under RLS. */
export const getMyProfile = cache(async (): Promise<Profile> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .eq("id", user.id)
    .single();
  if (error) throw new Error("Could not load your profile.");
  return {
    id: data.id,
    displayName: data.display_name,
    avatarUrl: data.avatar_url,
  };
});
