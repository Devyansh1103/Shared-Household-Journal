// Supabase Auth behaviour the app relies on (Phase 5), against the local stack
// and its config.toml: email confirmation, the email templates, password
// rules, recovery and sign-out. Needs `npm run db:start` (with Mailpit).
//
// The Next.js pages and Server Actions on top of this are covered by the unit
// tests in src/lib/auth and by manual checks, not here.

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { isExistingAccountError } from "@/lib/auth/errors";
import { adminClient, anonClient, mailpitUrl } from "./support/local-supabase";

const runId = randomUUID().slice(0, 8);
const admin = adminClient();
const createdUserIds: string[] = [];

const emailFor = (name: string) => `auth-${runId}-${name}@example.com`;
const password = `pw-${randomUUID()}`;

type MailpitSearch = { messages?: { ID: string }[] };
type MailpitMessage = { HTML: string };

/** Waits for an Auth email to `to` and returns its /auth/confirm link. */
async function confirmLink(
  to: string,
  type: "email" | "recovery",
): Promise<URL> {
  const base = mailpitUrl();
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = (await fetch(
      `${base}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
    ).then((r) => r.json())) as MailpitSearch;
    for (const { ID } of search.messages ?? []) {
      const message = (await fetch(`${base}/api/v1/message/${ID}`).then((r) =>
        r.json(),
      )) as MailpitMessage;
      const href = /href="([^"]*\/auth\/confirm\?[^"]*)"/.exec(
        message.HTML,
      )?.[1];
      if (!href) continue;
      const url = new URL(href.replaceAll("&amp;", "&"));
      if (url.searchParams.get("type") === type) return url;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No ${type} email arrived for ${to}`);
}

async function signUp(email: string, displayName = "Test Person") {
  const result = await anonClient().auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (result.data.user && !result.error)
    createdUserIds.push(result.data.user.id);
  return result;
}

afterAll(async () => {
  // profiles.id has no cascade (D14), so remove profiles before auth users.
  if (createdUserIds.length) {
    await admin.from("profiles").delete().in("id", createdUserIds);
  }
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
});

describe("sign-up with email confirmation", () => {
  const email = emailFor("new");

  it("creates the user and profile but no session", async () => {
    const { data, error } = await signUp(email, "Asha Rao");
    expect(error).toBeNull();
    expect(data.session).toBeNull();
    expect(data.user?.email_confirmed_at).toBeFalsy();

    const { data: profile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", data.user!.id)
      .single();
    expect(profile?.display_name).toBe("Asha Rao");
  });

  it("blocks sign-in until the email is confirmed", async () => {
    const { error } = await anonClient().auth.signInWithPassword({
      email,
      password,
    });
    expect(error?.code).toBe("email_not_confirmed");
  });

  let tokenHash = "";

  it("emails a link to the app's /auth/confirm route", async () => {
    const link = await confirmLink(email, "email");
    expect(link.origin).toBe("http://localhost:3000");
    expect(link.pathname).toBe("/auth/confirm");
    tokenHash = link.searchParams.get("token_hash") ?? "";
    expect(tokenHash).not.toBe("");
  });

  it("confirms the email with the token hash, which works only once", async () => {
    const first = await anonClient().auth.verifyOtp({
      type: "email",
      token_hash: tokenHash,
    });
    expect(first.error).toBeNull();
    expect(first.data.session).not.toBeNull();

    const again = await anonClient().auth.verifyOtp({
      type: "email",
      token_hash: tokenHash,
    });
    expect(again.error).not.toBeNull();
  });

  it("then allows sign-in", async () => {
    const { data, error } = await anonClient().auth.signInWithPassword({
      email,
      password,
    });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
  });

  it("rejects a duplicate sign-up with a code the app hides", async () => {
    const { data, error } = await anonClient().auth.signUp({
      email,
      password: `other-${password}`,
    });
    // This Auth version reports the duplicate rather than returning a
    // placeholder user. The signUp action must show its normal "check your
    // email" message for this code, so the form doesn't reveal the account.
    expect(data.session).toBeNull();
    expect(isExistingAccountError(error?.code)).toBe(true);
  });
});

describe("password rules and sign-in errors", () => {
  it("rejects passwords shorter than 8 characters", async () => {
    const { error } = await anonClient().auth.signUp({
      email: emailFor("short"),
      password: "1234567",
    });
    expect(error?.code).toBe("weak_password");
  });

  it("gives the same error for a wrong password and for an unknown email", async () => {
    const email = emailFor("known");
    const { data } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    createdUserIds.push(data.user!.id);

    const wrongPassword = await anonClient().auth.signInWithPassword({
      email,
      password: "not-the-password",
    });
    const unknownEmail = await anonClient().auth.signInWithPassword({
      email: emailFor("nobody"),
      password,
    });
    expect(wrongPassword.error?.code).toBe("invalid_credentials");
    expect(unknownEmail.error?.code).toBe("invalid_credentials");
    expect(wrongPassword.error?.message).toBe(unknownEmail.error?.message);
  });
});

describe("password recovery", () => {
  const email = emailFor("recover");
  const newPassword = `new-${randomUUID()}`;

  it("doesn't reveal whether an email has an account", async () => {
    const { error } = await anonClient().auth.resetPasswordForEmail(
      emailFor("missing"),
    );
    expect(error).toBeNull();
  });

  it("emails a recovery link whose session can set a new password", async () => {
    const { data } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    createdUserIds.push(data.user!.id);

    const request = await anonClient().auth.resetPasswordForEmail(email);
    expect(request.error).toBeNull();

    const link = await confirmLink(email, "recovery");
    expect(link.pathname).toBe("/auth/confirm");

    const client = anonClient();
    const verified = await client.auth.verifyOtp({
      type: "recovery",
      token_hash: link.searchParams.get("token_hash")!,
    });
    expect(verified.error).toBeNull();

    // secure_password_change is on; a fresh recovery session still qualifies.
    const update = await client.auth.updateUser({ password: newPassword });
    expect(update.error).toBeNull();
  });

  it("replaces the old password", async () => {
    const withNew = await anonClient().auth.signInWithPassword({
      email,
      password: newPassword,
    });
    expect(withNew.error).toBeNull();
    const withOld = await anonClient().auth.signInWithPassword({
      email,
      password,
    });
    expect(withOld.error?.code).toBe("invalid_credentials");
  });
});

describe("sign-out", () => {
  it("revokes the session, so its tokens no longer work", async () => {
    const email = emailFor("signout");
    const { data } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    createdUserIds.push(data.user!.id);

    const client = anonClient();
    const { data: signedIn } = await client.auth.signInWithPassword({
      email,
      password,
    });
    const { access_token, refresh_token } = signedIn.session!;

    const { error } = await client.auth.signOut({ scope: "local" });
    expect(error).toBeNull();

    // getUser() is what the app's session check uses (src/lib/auth/session.ts).
    const user = await anonClient().auth.getUser(access_token);
    expect(user.error).not.toBeNull();
    const refreshed = await anonClient().auth.refreshSession({ refresh_token });
    expect(refreshed.error).not.toBeNull();
  });
});
