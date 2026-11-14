import { describe, expect, it } from "vitest";
import {
  checkEnvironment,
  checkPublicSecrets,
  describeProblems,
  isSecretSupabaseKey,
} from "./env";

// Fake keys: shaped like real ones, valid for nothing.
const jwt = (payload: object) =>
  [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
const PUBLISHABLE = "sb_publishable_EXAMPLEexampleEXAMPLE";
const SECRET = "sb_secret_EXAMPLEexampleEXAMPLE";

const good = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
};

describe("isSecretSupabaseKey", () => {
  it("knows secret and service-role keys from public ones", () => {
    expect(isSecretSupabaseKey(SECRET)).toBe(true);
    expect(isSecretSupabaseKey(jwt({ role: "service_role" }))).toBe(true);
    expect(isSecretSupabaseKey(PUBLISHABLE)).toBe(false);
    expect(isSecretSupabaseKey(jwt({ role: "anon" }))).toBe(false);
    expect(isSecretSupabaseKey("not.a.jwt")).toBe(false);
  });
});

describe("checkEnvironment", () => {
  it("accepts a hosted project and a local stack", () => {
    expect(checkEnvironment(good)).toEqual({ ok: true });
    expect(
      checkEnvironment({
        ...good,
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toEqual({ ok: true });
    expect(
      checkEnvironment({
        ...good,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon" }),
      }),
    ).toEqual({ ok: true });
  });

  it("says what's missing or wrong, by name", () => {
    const result = checkEnvironment({});
    expect(result).toEqual({
      ok: false,
      problems: [
        "NEXT_PUBLIC_SUPABASE_URL is missing.",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing.",
      ],
    });
    for (const url of [
      "abcdefgh.supabase.co",
      "http://abcdefgh.supabase.co",
      "https://user:pass@abcdefgh.supabase.co",
    ]) {
      expect(
        checkEnvironment({ ...good, NEXT_PUBLIC_SUPABASE_URL: url }).ok,
        url,
      ).toBe(false);
    }
  });

  it("refuses a secret in a public variable, and never repeats its value", () => {
    for (const key of [SECRET, jwt({ role: "service_role" })]) {
      const result = checkEnvironment({
        ...good,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.problems.join(" ")).toMatch(/secret/);
        expect(describeProblems(result.problems)).not.toContain(key);
      }
    }
    const named = checkPublicSecrets({
      ...good,
      NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "anything",
      NEXT_PUBLIC_API_TOKEN: "x",
      NEXT_PUBLIC_EMPTY_SECRET: "",
    });
    expect(named).toEqual({
      ok: false,
      problems: [
        "NEXT_PUBLIC_API_TOKEN looks like a secret, but every NEXT_PUBLIC_ variable is sent to browsers. Remove it.",
        "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY looks like a secret, but every NEXT_PUBLIC_ variable is sent to browsers. Remove it.",
      ],
    });
    // Server-only secrets are fine where they are.
    expect(
      checkPublicSecrets({ ...good, SUPABASE_SECRET_KEY: SECRET }),
    ).toEqual({ ok: true });
  });
});
