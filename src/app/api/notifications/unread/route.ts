import { createClient } from "@/lib/supabase/server";

// How many unread notifications the signed-in person has, for the bell in
// the app shell (roadmap Phase 17). Read under RLS by
// public.my_unread_notification_count: only their own, in households they're
// an active member of. Never cached: it's per person and changes often.

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return Response.json(
      { error: "Not signed in" },
      { status: 401, headers: NO_STORE },
    );
  }
  const { data, error } = await supabase.rpc("my_unread_notification_count");
  if (error || typeof data !== "number") {
    // The reason only: nothing about the person in logs.
    console.error("Unread notification count failed");
    return Response.json(
      { error: "Unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }
  return Response.json({ count: data }, { headers: NO_STORE });
}
