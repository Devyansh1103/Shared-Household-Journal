import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { RETURN_PATH_HEADER } from "@/lib/auth/return-path";
import { AUTH_COOKIE_OPTIONS, supabaseConfig } from "@/lib/supabase/config";

// Refreshes the Supabase session cookie on each request (ADR-002). It makes no
// authorization decisions: pages, layouts and Server Actions check the user
// themselves through src/lib/auth/session.ts.
export async function proxy(request: NextRequest) {
  const returnPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;

  // Forwards the (possibly refreshed) cookies and the requested path upstream.
  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set(RETURN_PATH_HEADER, returnPath);
    return NextResponse.next({ request: { headers } });
  };

  let response = forward();
  const { url, publishableKey } = supabaseConfig();
  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, cacheHeaders) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = forward();
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(cacheHeaders)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Validates the access token and refreshes it if it has expired. Nothing
  // should run between creating the client and this call.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
