// Clients for the local Supabase stack used by the RLS tests (ADR-012).
// Keys are read from `supabase status` at runtime and kept in memory only:
// they are never written to disk or printed.

import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type TypedClient = SupabaseClient<Database>;

type LocalStatus = {
  url: string;
  publicKey: string;
  serviceRoleKey: string;
  mailpitUrl?: string;
};

let status: LocalStatus | undefined;

function readStatus(): LocalStatus {
  if (status) return status;

  let raw: string;
  try {
    raw = execSync("npx supabase status -o json", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error(
      "Local Supabase is not running. Start it with `npm run db:start` (needs Docker).",
    );
  }

  const values = JSON.parse(raw.slice(raw.indexOf("{"))) as Record<
    string,
    string
  >;
  const url = values.API_URL;
  // The app uses the publishable key (O4); older CLIs only print the anon key.
  const publicKey = values.PUBLISHABLE_KEY ?? values.ANON_KEY;
  const serviceRoleKey = values.SERVICE_ROLE_KEY ?? values.SECRET_KEY;
  if (!url || !publicKey || !serviceRoleKey) {
    throw new Error(
      `Unexpected \`supabase status\` output; fields present: ${Object.keys(values).join(", ")}`,
    );
  }

  status = { url, publicKey, serviceRoleKey, mailpitUrl: values.MAILPIT_URL };
  return status;
}

/** Local Mailpit, which catches Auth emails. */
export function mailpitUrl(): string {
  const { mailpitUrl } = readStatus();
  if (!mailpitUrl) {
    throw new Error(
      "Mailpit is not running. Start the stack with `npm run db:start`.",
    );
  }
  return mailpitUrl;
}

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

/** Bypasses RLS. Test fixtures only; never used for normal requests. */
export function adminClient(): TypedClient {
  const { url, serviceRoleKey } = readStatus();
  return createClient<Database>(url, serviceRoleKey, clientOptions);
}

/** A client with the public key and no session (the `anon` role). */
export function anonClient(): TypedClient {
  const { url, publicKey } = readStatus();
  return createClient<Database>(url, publicKey, clientOptions);
}

/** A client signed in as the given user (the `authenticated` role). */
export async function signedInClient(
  email: string,
  password: string,
): Promise<TypedClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

/**
 * Runs SQL with psql as `postgres` inside the local database container. Only
 * for checks the Data API can't reach, such as data that breaks a deferred
 * constraint inside a transaction that is never committed. Output is returned,
 * never printed; it contains no keys.
 */
export function psqlAsSuperuser(sql: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  // Test runners start in the repository root.
  const config = readFileSync(
    path.join(process.cwd(), "supabase", "config.toml"),
    "utf8",
  );
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  if (!projectId)
    throw new Error("project_id not found in supabase/config.toml");

  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      `supabase_db_${projectId}`,
      "psql",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    { input: sql, encoding: "utf8" },
  );
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
