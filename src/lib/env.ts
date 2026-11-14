// Checks the app's configuration (roadmap Phase 18). Pure: given the
// environment, it says what's wrong, naming variables but never printing a
// value. Two things matter:
//
// - The app needs NEXT_PUBLIC_SUPABASE_URL and
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (O4). Both are public by design.
// - Anything named NEXT_PUBLIC_* is compiled into the JavaScript sent to every
//   browser. A secret there (the service-role or a secret key) would give
//   anyone full access to the database, past every RLS policy. That must stop
//   the build and the server, not just be warned about.

export type EnvCheck = { ok: true } | { ok: false; problems: string[] };

type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A Supabase secret: a new-style secret key, or a legacy service-role JWT. */
export function isSecretSupabaseKey(key: string): boolean {
  const value = key.trim();
  if (value.startsWith("sb_secret_")) return true;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    return (
      typeof payload === "object" &&
      payload !== null &&
      "role" in payload &&
      payload.role === "service_role"
    );
  } catch {
    return false;
  }
}

/** Public variables whose names say they hold a secret. */
function secretLookingPublicNames(env: Env): string[] {
  return Object.keys(env)
    .filter(
      (name) =>
        name.startsWith("NEXT_PUBLIC_") &&
        /SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN/i.test(name) &&
        (env[name] ?? "") !== "",
    )
    .sort();
}

/**
 * Only the secret checks: a secret in a public variable. Run when the app is
 * built, so a secret can never be compiled into the browser's JavaScript.
 */
export function checkPublicSecrets(env: Env): EnvCheck {
  const problems: string[] = [];
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (key && isSecretSupabaseKey(key)) {
    problems.push(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret (service-role) key. It would be sent to every browser. Use the project's publishable key.",
    );
  }
  for (const name of secretLookingPublicNames(env)) {
    problems.push(
      `${name} looks like a secret, but every NEXT_PUBLIC_ variable is sent to browsers. Remove it.`,
    );
  }
  return problems.length ? { ok: false, problems } : { ok: true };
}

/**
 * Everything the server needs to start: the two Supabase values, a valid
 * HTTPS URL (plain HTTP only for a local stack), and no public secrets.
 */
export function checkEnvironment(env: Env): EnvCheck {
  const problems: string[] = [];
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url) {
    problems.push("NEXT_PUBLIC_SUPABASE_URL is missing.");
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      problems.push("NEXT_PUBLIC_SUPABASE_URL isn't a valid URL.");
    }
    if (parsed) {
      const local = LOCAL_HOSTS.has(parsed.hostname);
      if (
        parsed.protocol !== "https:" &&
        !(parsed.protocol === "http:" && local)
      ) {
        problems.push(
          "NEXT_PUBLIC_SUPABASE_URL must use https:// (http:// is allowed only for a local stack).",
        );
      }
      if (parsed.username || parsed.password) {
        problems.push(
          "NEXT_PUBLIC_SUPABASE_URL must not contain a user name or password.",
        );
      }
    }
  }
  if (!key) problems.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing.");

  const secrets = checkPublicSecrets(env);
  if (!secrets.ok) problems.push(...secrets.problems);
  return problems.length ? { ok: false, problems } : { ok: true };
}

/** The problems as one message, for a thrown error or a log line. */
export function describeProblems(problems: readonly string[]): string {
  return [
    "The app's configuration isn't safe to run:",
    ...problems.map((p) => `- ${p}`),
    "See .env.example and docs/environment.md.",
  ].join("\n");
}
