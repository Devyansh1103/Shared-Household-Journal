// Phase 6: household creation, invitations, joining, leaving and owner-only
// membership changes, run against the local stack as real signed-in users.
// Needs `npm run db:start`, then `npm run test:db`.
//
// Every user and household is created for this run and removed afterwards.

import { randomUUID } from "node:crypto";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createInviteToken,
  hashInviteToken,
} from "@/lib/households/invite-token";
import {
  adminClient,
  anonClient,
  signedInClient,
  type TypedClient,
} from "./support/local-supabase";

const PERMISSION_DENIED = "42501";
const CHECK_VIOLATION = "23514";
const INVALID_PARAMETER = "22023";
const INVITE_INVALID = "HJ001";
const OWNER_MUST_TRANSFER = "HJ002";
const NOT_AN_ACTIVE_MEMBER = "HJ003";
const HOUSEHOLD_NOT_EMPTY = "HJ004";
const NOT_YOURSELF = "HJ005";

const runId = randomUUID().slice(0, 8);
const password = `hh-${randomUUID()}`;
const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

type User = { id: string; email: string; client: TypedClient };
let owen: User, nina: User, pete: User, quinn: User, olga: User;
const createdHouseholds: string[] = [];

function expectError(error: PostgrestError | null, code: string) {
  expect(error, `expected Postgres error ${code}`).not.toBeNull();
  expect(error?.code).toBe(code);
}

async function createUser(name: string, displayName: string): Promise<User> {
  const email = `hh-${runId}-${name}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error) throw error;
  return {
    id: data.user.id,
    email,
    client: await signedInClient(email, password),
  };
}

async function createHousehold(
  user: User,
  name = `Home ${runId}`,
  requestKey?: string,
): Promise<string> {
  const { data, error } = await user.client.rpc("create_household", {
    household_name: name,
    currency: "INR",
    time_zone: "Asia/Kolkata",
    request_key: requestKey,
  });
  if (error) throw error;
  createdHouseholds.push(data);
  return data;
}

async function createInvite(
  user: User,
  householdId: string,
  fields: { max_uses?: number } = {},
): Promise<{ id: string; token: string }> {
  const { token, tokenHash } = createInviteToken();
  const { data, error } = await user.client
    .from("invitations")
    .insert({ household_id: householdId, token_hash: tokenHash, ...fields })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, token };
}

/** Invites in states a member can't create directly (already expired or used up). */
async function adminInvite(
  householdId: string,
  createdBy: string,
  fields: {
    created_at?: string;
    expires_at?: string;
    max_uses?: number;
    use_count?: number;
  },
): Promise<string> {
  const { token, tokenHash } = createInviteToken();
  const { error } = await admin.from("invitations").insert({
    household_id: householdId,
    token_hash: tokenHash,
    created_by: createdBy,
    ...fields,
  });
  if (error) throw error;
  return token;
}

async function activeMembers(householdId: string) {
  const { data, error } = await admin
    .from("household_members")
    .select("user_id, role")
    .eq("household_id", householdId)
    .is("left_at", null);
  if (error) throw error;
  return data;
}

async function eventTypes(householdId: string) {
  const { data, error } = await admin
    .from("activity_events")
    .select("type, actor_id, entity_type, summary")
    .eq("household_id", householdId)
    .order("created_at");
  if (error) throw error;
  return data;
}

async function canSeeHousehold(user: User, householdId: string) {
  const [households, members, invitations, events] = await Promise.all([
    user.client.from("households").select("id").eq("id", householdId),
    user.client
      .from("household_members")
      .select("id")
      .eq("household_id", householdId),
    user.client
      .from("invitations")
      .select("id")
      .eq("household_id", householdId),
    user.client
      .from("activity_events")
      .select("id")
      .eq("household_id", householdId),
  ]);
  return {
    households: households.data?.length ?? 0,
    members: members.data?.length ?? 0,
    invitations: invitations.data?.length ?? 0,
    events: events.data?.length ?? 0,
  };
}

const NOTHING = { households: 0, members: 0, invitations: 0, events: 0 };

beforeAll(async () => {
  [owen, nina, pete, quinn, olga] = await Promise.all([
    createUser("owen", "Owen"),
    createUser("nina", "Nina"),
    createUser("pete", "Pete"),
    createUser("quinn", "Quinn"),
    createUser("olga", "Olga"),
  ]);
}, 60_000);

afterAll(async () => {
  const users = [owen, nina, pete, quinn, olga].filter(Boolean);
  const userIds = users.map((u) => u.id);
  // Households cascade to memberships, invitations and activity events; then
  // profiles, then auth users (profiles.id has no cascade, D14).
  if (userIds.length) {
    await admin.from("households").delete().in("created_by", userIds);
  }
  if (createdHouseholds.length) {
    await admin.from("households").delete().in("id", createdHouseholds);
  }
  if (userIds.length) {
    await admin.from("profiles").delete().in("id", userIds);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  }
});

describe("create_household", () => {
  it("is not available without a session", async () => {
    const { error } = await anonClient().rpc("create_household", {
      household_name: "Anon home",
      currency: "INR",
      time_zone: "Asia/Kolkata",
    });
    expect(error).not.toBeNull();
    const { data } = await admin
      .from("households")
      .select("id")
      .eq("name", "Anon home");
    expect(data).toEqual([]);
  });

  it("creates the household with the caller as its only, owning member", async () => {
    const id = await createHousehold(owen, `Owen's flat ${runId}`);

    const { data: household } = await admin
      .from("households")
      .select("name, currency_code, timezone, created_by")
      .eq("id", id)
      .single();
    expect(household).toEqual({
      name: `Owen's flat ${runId}`,
      currency_code: "INR",
      timezone: "Asia/Kolkata",
      created_by: owen.id,
    });
    expect(await activeMembers(id)).toEqual([
      { user_id: owen.id, role: "owner" },
    ]);

    const events = await eventTypes(id);
    expect(events.map((e) => [e.type, e.actor_id])).toEqual([
      ["household_created", owen.id],
    ]);
  });

  it("returns the same household when a request key is repeated, even concurrently", async () => {
    const key = randomUUID();
    const first = await createHousehold(owen, `Keyed ${runId}`, key);
    const [second, third] = await Promise.all([
      createHousehold(owen, `Keyed ${runId}`, key),
      createHousehold(owen, `Keyed ${runId}`, key),
    ]);
    expect(second).toBe(first);
    expect(third).toBe(first);

    const { data } = await admin
      .from("households")
      .select("id")
      .eq("creation_key", key);
    expect(data).toHaveLength(1);
    expect(await activeMembers(first)).toHaveLength(1);
  });

  it("treats the same key from a different user as a different request", async () => {
    const key = randomUUID();
    const mine = await createHousehold(owen, `Shared key ${runId}`, key);
    const theirs = await createHousehold(olga, `Shared key ${runId}`, key);
    expect(theirs).not.toBe(mine);
    expect(await activeMembers(theirs)).toEqual([
      { user_id: olga.id, role: "owner" },
    ]);
  });

  it("validates the name, currency and timezone and creates nothing on failure", async () => {
    const attempt = (
      household_name: string,
      currency: string,
      time_zone: string,
    ) =>
      owen.client.rpc("create_household", {
        household_name,
        currency,
        time_zone,
      });

    expectError(
      (await attempt("", "INR", "Asia/Kolkata")).error,
      CHECK_VIOLATION,
    );
    expectError(
      (await attempt(" Padded ", "INR", "Asia/Kolkata")).error,
      CHECK_VIOLATION,
    );
    expectError(
      (await attempt("x".repeat(81), "INR", "Asia/Kolkata")).error,
      CHECK_VIOLATION,
    );
    expectError(
      (await attempt("Valid", "inr", "Asia/Kolkata")).error,
      CHECK_VIOLATION,
    );
    expectError(
      (await attempt("Valid", "INR", "Mars/Olympus")).error,
      INVALID_PARAMETER,
    );

    const { data } = await admin
      .from("households")
      .select("id")
      .eq("created_by", owen.id)
      .eq("name", "Valid");
    expect(data).toEqual([]);
  });
});

describe("invitations and joining", () => {
  let home: string;

  beforeAll(async () => {
    home = await createHousehold(owen, `Invite home ${runId}`);
  });

  it("store only the hash of the token", async () => {
    const invite = await createInvite(owen, home);
    const { data } = await admin
      .from("invitations")
      .select("*")
      .eq("id", invite.id)
      .single();
    expect(data?.token_hash).toBe(hashInviteToken(invite.token));
    expect(JSON.stringify(data)).not.toContain(invite.token);
  });

  it("can be previewed by a signed-in holder of a valid link, and by nobody without a session", async () => {
    const invite = await createInvite(owen, home);
    const { data } = await nina.client
      .rpc("get_invite_preview", { token: invite.token })
      .single();
    expect(data).toEqual({
      status: "valid",
      household_id: null,
      household_name: `Invite home ${runId}`,
      inviter_name: "Owen",
    });

    const anon = await anonClient().rpc("get_invite_preview", {
      token: invite.token,
    });
    expect(anon.error).not.toBeNull();
    expect(anon.data).toBeNull();
  });

  it("preview reveals nothing for unknown or malformed tokens", async () => {
    for (const token of [createInviteToken().token, "short", "' or 1=1 --"]) {
      const { data } = await nina.client
        .rpc("get_invite_preview", { token })
        .single();
      expect(data).toEqual({
        status: "invalid",
        household_id: null,
        household_name: null,
        inviter_name: null,
      });
    }
  });

  it("joins the caller as a member and counts one use", async () => {
    const invite = await createInvite(owen, home);
    const { data, error } = await nina.client
      .rpc("accept_invite", { token: invite.token })
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ joined_household_id: home, already_member: false });

    const members = await activeMembers(home);
    expect(members).toContainEqual({ user_id: nina.id, role: "member" });

    const { data: row } = await admin
      .from("invitations")
      .select("use_count")
      .eq("id", invite.id)
      .single();
    expect(row?.use_count).toBe(1);

    const events = await eventTypes(home);
    expect(events.at(-1)).toMatchObject({
      type: "member_joined",
      actor_id: nina.id,
      entity_type: "household_member",
    });

    // Opening the link again: no second membership and no use consumed.
    const again = await nina.client
      .rpc("accept_invite", { token: invite.token })
      .single();
    expect(again.data).toEqual({
      joined_household_id: home,
      already_member: true,
    });
    expect(
      (await activeMembers(home)).filter((m) => m.user_id === nina.id),
    ).toHaveLength(1);
    const { data: after } = await admin
      .from("invitations")
      .select("use_count")
      .eq("id", invite.id)
      .single();
    expect(after?.use_count).toBe(1);

    const preview = await nina.client
      .rpc("get_invite_preview", { token: invite.token })
      .single();
    expect(preview.data?.status).toBe("member");
    expect(preview.data?.household_id).toBe(home);
  });

  it("rejects expired, revoked, used-up and unknown invites without joining", async () => {
    const expired = await adminInvite(home, owen.id, {
      created_at: new Date(Date.now() - 8 * DAY).toISOString(),
      expires_at: new Date(Date.now() - DAY).toISOString(),
    });
    const usedUp = await adminInvite(home, owen.id, {
      max_uses: 1,
      use_count: 1,
    });
    const revoked = await createInvite(owen, home);
    await owen.client
      .from("invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", revoked.id);

    for (const token of [
      expired,
      usedUp,
      revoked.token,
      createInviteToken().token,
      "not-a-token",
    ]) {
      const { error } = await pete.client.rpc("accept_invite", { token });
      expectError(error, INVITE_INVALID);
      const preview = await pete.client
        .rpc("get_invite_preview", { token })
        .single();
      expect(preview.data?.status).toBe("invalid");
      expect(preview.data?.household_name).toBeNull();
    }
    expect((await activeMembers(home)).map((m) => m.user_id)).not.toContain(
      pete.id,
    );
  });

  it("can't be accepted without a session", async () => {
    const invite = await createInvite(owen, home);
    const { error } = await anonClient().rpc("accept_invite", {
      token: invite.token,
    });
    expect(error).not.toBeNull();
  });

  it("let only one person take the last use", async () => {
    const invite = await createInvite(owen, home, { max_uses: 1 });
    const results = await Promise.all(
      [pete, quinn].map((user) =>
        user.client.rpc("accept_invite", { token: invite.token }),
      ),
    );
    const succeeded = results.filter((r) => r.error === null);
    const failed = results.filter((r) => r.error !== null);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].error?.code).toBe(INVITE_INVALID);

    const { data } = await admin
      .from("invitations")
      .select("use_count")
      .eq("id", invite.id)
      .single();
    expect(data?.use_count).toBe(1);
  });

  it("never let anyone outside the household read it", async () => {
    expect(await canSeeHousehold(olga, home)).toEqual(NOTHING);
    expect((await canSeeHousehold(nina, home)).households).toBe(1);
  });
});

describe("leaving a household", () => {
  let home: string;

  beforeAll(async () => {
    home = await createHousehold(owen, `Leaving home ${runId}`);
    const invite = await createInvite(owen, home);
    for (const user of [nina, pete]) {
      const { error } = await user.client.rpc("accept_invite", {
        token: invite.token,
      });
      if (error) throw error;
    }
  });

  it("is refused for the owner (D13)", async () => {
    const { error } = await owen.client.rpc("leave_household", {
      target_household_id: home,
    });
    expectError(error, OWNER_MUST_TRANSFER);
    expect(await activeMembers(home)).toContainEqual({
      user_id: owen.id,
      role: "owner",
    });
  });

  it("is refused for someone who isn't a member", async () => {
    const { error } = await olga.client.rpc("leave_household", {
      target_household_id: home,
    });
    expectError(error, PERMISSION_DENIED);
  });

  it("ends access immediately, keeps the history row and revokes the leaver's invites", async () => {
    const ninasInvite = await createInvite(nina, home);
    expect((await canSeeHousehold(nina, home)).households).toBe(1);

    const { error } = await nina.client.rpc("leave_household", {
      target_household_id: home,
    });
    expect(error).toBeNull();

    expect(await canSeeHousehold(nina, home)).toEqual(NOTHING);
    const { data: history } = await admin
      .from("household_members")
      .select("left_at")
      .eq("household_id", home)
      .eq("user_id", nina.id);
    expect(history).toHaveLength(1);
    expect(history?.[0].left_at).not.toBeNull();

    const { data: invite } = await admin
      .from("invitations")
      .select("revoked_at")
      .eq("id", ninasInvite.id)
      .single();
    expect(invite?.revoked_at).not.toBeNull();
    const reuse = await quinn.client.rpc("accept_invite", {
      token: ninasInvite.token,
    });
    expectError(reuse.error, INVITE_INVALID);

    const types = (await eventTypes(home)).map((e) => e.type);
    expect(types).toContain("member_left");
    expect(types).toContain("invitation_revoked");

    const twice = await nina.client.rpc("leave_household", {
      target_household_id: home,
    });
    expectError(twice.error, PERMISSION_DENIED);
  });

  it("allows rejoining through a new valid invite, as a new membership row", async () => {
    const invite = await createInvite(owen, home);
    const { error } = await nina.client.rpc("accept_invite", {
      token: invite.token,
    });
    expect(error).toBeNull();
    const { data } = await admin
      .from("household_members")
      .select("left_at")
      .eq("household_id", home)
      .eq("user_id", nina.id);
    expect(data).toHaveLength(2);
    expect(data?.filter((m) => m.left_at === null)).toHaveLength(1);
  });
});

describe("owner-only membership changes", () => {
  let home: string;
  let other: string;

  beforeAll(async () => {
    home = await createHousehold(owen, `Owner home ${runId}`);
    other = await createHousehold(olga, `Olga home ${runId}`);
    const invite = await createInvite(owen, home);
    for (const user of [nina, pete]) {
      const { error } = await user.client.rpc("accept_invite", {
        token: invite.token,
      });
      if (error) throw error;
    }
  });

  it("refuse members and outsiders", async () => {
    for (const user of [nina, olga]) {
      const remove = await user.client.rpc("remove_member", {
        target_household_id: home,
        member_user_id: pete.id,
      });
      expectError(remove.error, PERMISSION_DENIED);

      const transfer = await user.client.rpc("transfer_ownership", {
        target_household_id: home,
        new_owner_user_id: user.id,
      });
      expectError(transfer.error, PERMISSION_DENIED);

      const del = await user.client.rpc("delete_household", {
        target_household_id: home,
      });
      expectError(del.error, PERMISSION_DENIED);
    }
    expect(await activeMembers(home)).toContainEqual({
      user_id: owen.id,
      role: "owner",
    });
  });

  it("can't reach into another household", async () => {
    const remove = await owen.client.rpc("remove_member", {
      target_household_id: other,
      member_user_id: olga.id,
    });
    expectError(remove.error, PERMISSION_DENIED);
    const transfer = await owen.client.rpc("transfer_ownership", {
      target_household_id: other,
      new_owner_user_id: owen.id,
    });
    expectError(transfer.error, PERMISSION_DENIED);
    const del = await owen.client.rpc("delete_household", {
      target_household_id: other,
    });
    expectError(del.error, PERMISSION_DENIED);
    expect(await activeMembers(other)).toEqual([
      { user_id: olga.id, role: "owner" },
    ]);
  });

  it("reject targets who aren't active members, and the owner themselves", async () => {
    const outsider = await owen.client.rpc("remove_member", {
      target_household_id: home,
      member_user_id: olga.id,
    });
    expectError(outsider.error, NOT_AN_ACTIVE_MEMBER);

    const self = await owen.client.rpc("remove_member", {
      target_household_id: home,
      member_user_id: owen.id,
    });
    expectError(self.error, NOT_YOURSELF);

    const toOutsider = await owen.client.rpc("transfer_ownership", {
      target_household_id: home,
      new_owner_user_id: olga.id,
    });
    expectError(toOutsider.error, NOT_AN_ACTIVE_MEMBER);

    const toSelf = await owen.client.rpc("transfer_ownership", {
      target_household_id: home,
      new_owner_user_id: owen.id,
    });
    expectError(toSelf.error, NOT_YOURSELF);
  });

  it("remove a member: access ends and their invites are revoked", async () => {
    const petesInvite = await createInvite(pete, home);
    const { error } = await owen.client.rpc("remove_member", {
      target_household_id: home,
      member_user_id: pete.id,
    });
    expect(error).toBeNull();

    expect(await canSeeHousehold(pete, home)).toEqual(NOTHING);
    const rejoin = await pete.client.rpc("accept_invite", {
      token: petesInvite.token,
    });
    expectError(rejoin.error, INVITE_INVALID);

    const events = await eventTypes(home);
    expect(events.find((e) => e.type === "member_removed")).toMatchObject({
      actor_id: owen.id,
      summary: { user_id: pete.id },
    });
  });

  it("refuse deleting while other members remain", async () => {
    const { error } = await owen.client.rpc("delete_household", {
      target_household_id: home,
    });
    expectError(error, HOUSEHOLD_NOT_EMPTY);
    const { data } = await admin.from("households").select("id").eq("id", home);
    expect(data).toHaveLength(1);
  });

  it("transfer ownership: exactly one owner afterwards, and the old owner can then leave", async () => {
    const { error } = await owen.client.rpc("transfer_ownership", {
      target_household_id: home,
      new_owner_user_id: nina.id,
    });
    expect(error).toBeNull();

    const members = await activeMembers(home);
    expect(members.filter((m) => m.role === "owner")).toEqual([
      { user_id: nina.id, role: "owner" },
    ]);
    expect(members).toContainEqual({ user_id: owen.id, role: "member" });

    // The former owner lost owner powers at once.
    const removeAsMember = await owen.client.rpc("remove_member", {
      target_household_id: home,
      member_user_id: nina.id,
    });
    expectError(removeAsMember.error, PERMISSION_DENIED);

    const leave = await owen.client.rpc("leave_household", {
      target_household_id: home,
    });
    expect(leave.error).toBeNull();

    const types = (await eventTypes(home)).map((e) => e.type);
    expect(types).toContain("ownership_transferred");
  });

  it("delete the household once the owner is its only member, removing everything in it", async () => {
    await createInvite(nina, home);
    const { error } = await nina.client.rpc("delete_household", {
      target_household_id: home,
    });
    expect(error).toBeNull();

    for (const table of [
      "household_members",
      "invitations",
      "activity_events",
    ] as const) {
      const { data } = await admin
        .from(table)
        .select("id")
        .eq("household_id", home);
      expect(data, table).toEqual([]);
    }
    const { data } = await admin.from("households").select("id").eq("id", home);
    expect(data).toEqual([]);
  });
});

describe("activity_events", () => {
  let home: string;

  beforeAll(async () => {
    home = await createHousehold(quinn, `Journal home ${runId}`);
  });

  it("are readable by active members only", async () => {
    const mine = await quinn.client
      .from("activity_events")
      .select("type")
      .eq("household_id", home);
    expect(mine.data?.map((e) => e.type)).toEqual(["household_created"]);

    expect((await canSeeHousehold(olga, home)).events).toBe(0);

    const anon = await anonClient()
      .from("activity_events")
      .select("id")
      .limit(1);
    expectError(anon.error, PERMISSION_DENIED);
  });

  it("can't be written directly by members", async () => {
    const insert = await quinn.client.from("activity_events").insert({
      household_id: home,
      type: "member_joined",
      entity_type: "household",
      entity_id: home,
    });
    expectError(insert.error, PERMISSION_DENIED);

    const update = await quinn.client
      .from("activity_events")
      .update({ summary: {} })
      .eq("household_id", home);
    expectError(update.error, PERMISSION_DENIED);

    const del = await quinn.client
      .from("activity_events")
      .delete()
      .eq("household_id", home);
    expectError(del.error, PERMISSION_DENIED);
  });

  it("are append-only even for the service role", async () => {
    const update = await admin
      .from("activity_events")
      .update({ summary: { edited: true } })
      .eq("household_id", home);
    expectError(update.error, PERMISSION_DENIED);

    const del = await admin
      .from("activity_events")
      .delete()
      .eq("household_id", home);
    expectError(del.error, PERMISSION_DENIED);
  });

  it("never record emails or raw invite tokens", async () => {
    const invite = await createInvite(quinn, home);
    const { data } = await admin
      .from("activity_events")
      .select("summary")
      .eq("household_id", home);
    const text = JSON.stringify(data);
    expect(text).not.toContain(invite.token);
    expect(text).not.toContain("@example.com");
  });
});

describe("function exposure", () => {
  it("keeps private helpers out of the Data API", async () => {
    const untyped = owen.client as unknown as SupabaseClient;
    for (const fn of [
      "record_activity",
      "invite_token_hash",
      "require_household_owner",
      "revoke_invitations_created_by",
    ]) {
      const { error } = await untyped.rpc(fn, {});
      expect(error, fn).not.toBeNull();
    }
  });

  it("lets anonymous callers run none of the household functions", async () => {
    const anon = anonClient() as unknown as SupabaseClient;
    const id = randomUUID();
    const calls: [string, Record<string, unknown>][] = [
      ["leave_household", { target_household_id: id }],
      ["remove_member", { target_household_id: id, member_user_id: id }],
      [
        "transfer_ownership",
        { target_household_id: id, new_owner_user_id: id },
      ],
      ["delete_household", { target_household_id: id }],
    ];
    for (const [fn, args] of calls) {
      const { error } = await anon.rpc(fn, args);
      expect(error, fn).not.toBeNull();
    }
  });
});
