import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { SIGNED_IN_HOME } from "@/lib/auth/return-path";
import { createClient } from "@/lib/supabase/server";

// Target of the links in supabase/templates. Exchanges the one-time token hash
// for a session cookie, so the link works in any browser.
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  if (tokenHash && (type === "email" || type === "recovery")) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      redirect(
        type === "recovery"
          ? "/reset-password"
          : `${SIGNED_IN_HOME}?confirmed=1`,
      );
    }
  }

  redirect("/sign-in?error=invalid_link");
}
