import { createServerClient } from "@supabase/ssr";
import { supabaseConfig } from "@/lib/supabase/config";

// Health check for the host and uptime monitors (roadmap Phase 18). Says only
// whether the app is up and whether the database answers: no versions, no
// configuration, no timings, nothing about anyone. It uses no session (an
// anonymous client with no cookies), and is never cached.

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  let database: "ok" | "unavailable" = "unavailable";
  try {
    const { url, publishableKey } = supabaseConfig();
    const supabase = createServerClient(url, publishableKey, {
      cookies: { getAll: () => [], setAll: () => {} },
    });
    const { data, error } = await supabase.rpc("health_check");
    if (!error && data === true) database = "ok";
  } catch {
    // Missing configuration or no connection: reported as unavailable.
  }
  const ok = database === "ok";
  return Response.json(
    { status: ok ? "ok" : "degraded", database },
    { status: ok ? 200 : 503, headers: NO_STORE },
  );
}
