import type { Instrumentation } from "next";

// Server start-up and error reporting (roadmap Phase 18). No external
// monitoring service is configured; errors go to the server log (the host's
// log stream, e.g. Vercel's runtime logs) as one JSON line each.

/**
 * Runs once when a server instance starts: refuses to serve with a missing
 * or unsafe configuration (docs/environment.md), saying which variable is
 * wrong without printing any value.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Building isn't serving; next.config.ts checks the build for secrets.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { checkEnvironment, describeProblems } = await import("./lib/env");
  const result = checkEnvironment({
    ...process.env,
    // As compiled into the app (Next.js inlines NEXT_PUBLIC_ values at build).
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!result.ok) throw new Error(describeProblems(result.problems));
}

/**
 * One JSON line per server error: where it happened and the digest that
 * matches what the visitor sees, never the message, the URL's query, headers
 * or cookies, which can hold household content or tokens.
 */
export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String(error.digest)
      : undefined;
  console.error(
    JSON.stringify({
      level: "error",
      event: "request_error",
      time: new Date().toISOString(),
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
      renderSource: context.renderSource ?? null,
      errorName: error instanceof Error ? error.name : typeof error,
      digest: digest ?? null,
    }),
  );
};
