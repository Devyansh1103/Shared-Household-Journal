// RLS and constraint tests for the Phase 4 tables (requirements-notes Â§4.9, ADR-012).
// Needs the local Supabase stack: `npm run db:start`, then `npm run test:db`.
//
// Fixtures: household A (alice owner, bob member, dave former member) and
// household B (carol owner). Every user and household is created for this run
// and removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  signedInClient,
  type TypedClient,
} from "./support/local-supabase";

const PERMISSION_DENIED = "42501";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const INVALID_PARAMETER = "22023";

const TABLES = [
  "profiles",
  "households",
  "household_members",
  "invitations",
] as const;

const runId = randomUUID().slice(0, 8);
const password = `rls-${randomUUID()}`;
const admin = adminClient();

type User = { id: string; email: string; client: TypedClient };
let alice: User, bob: User, carol: User, dave: User;
let householdA: string, householdB: string;
let inviteByAlice: string, inviteByBob: string, inviteInB: string;

function tokenHash(): string {
  return createHash("sha256").update(randomBytes(32)).digest("hex");
}

function expectError(error: PostgrestError | null, code: string) {
  expect(error, `expected Postgres error ${code}`).not.toBeNull();
  expect(error?.code).toBe(code);
}

function ids(rows: { id: string }[] | null): string[] {
  return (rows ?? []).map((row) => row.id).sort();
}

async function createUser(name: string, displayName?: string): Promise<User> {
  const email = `rls-${runId}-${name}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: displayName ? { display_name: displayName } : {},
  });
  if (error) throw error;
  return {
    id: data.user.id,
    email,
    client: await signedInClient(email, password),
  };
}

async function succeed(
  query: PromiseLike<{ error: PostgrestError | null }>,
): Promise<void> {
  const { error } = await query;
  if (error) throw error;
}

async function returning<T>(
  query: PromiseLike<{ data: T; error: PostgrestError | null }>,
): Promise<NonNullable<T>> {
  const { data, error } = await query;
  if (error) throw error;
  if (data == null) throw new Error("Expected rows to be returned");
  return data as NonNullable<T>;
}

beforeAll(async () => {
  alice = await createUser("alice", "Alice");
  bob = await createUser("bob", "Bob");
  carol = await createUser("carol", "Carol");
  dave = await createUser("dave");

  const households = await returning(
    admin
      .from("households")
      .insert([
        { name: `A ${runId}`, timezone: "Asia/Kolkata", created_by: alice.id },
        { name: `B ${runId}`, timezone: "Europe/London", created_by: carol.id },
      ])
      .select("id, name"),
  );
  householdA = households.find((h) => h.name.startsWith("A "))!.id;
  householdB = households.find((h) => h.name.startsWith("B "))!.id;

  await succeed(
    admin.from("household_members").insert([
      { household_id: householdA, user_id: alice.id, role: "owner" },
      { household_id: householdA, user_id: bob.id, role: "member" },
      { household_id: householdA, user_id: dave.id, role: "member" },
      { household_id: householdB, user_id: carol.id, role: "owner" },
    ]),
  );
  await succeed(
    admin
      .from("household_members")
      .update({ left_at: new Date().toISOString() })
      .eq("household_id", householdA)
      .eq("user_id", dave.id),
  );

  const invites = await returning(
    admin
      .from("invitations")
      .insert([
        {
          household_id: householdA,
          token_hash: tokenHash(),
          created_by: alice.id,
        },
        {
          household_id: householdA,
          token_hash: tokenHash(),
          created_by: bob.id,
        },
        {
          household_id: householdB,
          token_hash: tokenHash(),
          created_by: carol.id,
        },
      ])
      .select("id, created_by"),
  );
  inviteByAlice = invites.find((i) => i.created_by === alice.id)!.id;
  inviteByBob = invites.find((i) => i.created_by === bob.id)!.id;
  inviteInB = invites.find((i) => i.created_by === carol.id)!.id;
}, 60_000);

afterAll(async () => {
  const users = [alice, bob, carol, dave].filter(Boolean);
  const householdIds = [householdA, householdB].filter(Boolean);
  // Order matters: households cascade to memberships and invitations, then
  // profiles, then auth users (profiles.id has no cascade, D14).
  if (householdIds.length)
    await admin.from("households").delete().in("id", householdIds);
  if (users.length) {
    await admin
      .from("profiles")
      .delete()
      .in(
        "id",
        users.map((u) => u.id),
      );
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  }
});

describe("anon role", () => {
  it.each(TABLES)("cannot read %s", async (table) => {
    const { error } = await anonClient().from(table).select("id").limit(1);
    expectError(error, PERMISSION_DENIED);
  });
});

describe("RLS helper functions", () => {
  it("are not callable through the Data API", async () => {
    const untyped = alice.client as unknown as SupabaseClient;
    const { error } = await untyped.rpc("is_household_member", {
      target_household_id: householdA,
    });
    expect(error).not.toBeNull();
  });
});

describe("profiles", () => {
  it("are created from sign-up metadata, with a fallback name", async () => {
    const { data } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", [alice.id, dave.id]);
    expect(data?.find((p) => p.id === alice.id)?.display_name).toBe("Alice");
    expect(data?.find((p) => p.id === dave.id)?.display_name).toBe(
      "New member",
    );
  });

  it("are visible to the user and to current co-members, including former members", async () => {
    const all = [alice.id, bob.id, carol.id, dave.id];
    const read = async (user: User) =>
      ids((await user.client.from("profiles").select("id").in("id", all)).data);

    expect(await read(alice)).toEqual([alice.id, bob.id, dave.id].sort());
    expect(await read(bob)).toEqual([alice.id, bob.id, dave.id].sort());
    expect(await read(carol)).toEqual([carol.id]);
    // Dave left household A, so he only sees himself.
    expect(await read(dave)).toEqual([dave.id]);
  });

  it("can be updated by their owner only", async () => {
    const own = await alice.client
      .from("profiles")
      .update({ display_name: "Alice R" })
      .eq("id", alice.id)
      .select("id");
    expect(ids(own.data)).toEqual([alice.id]);

    const other = await alice.client
      .from("profiles")
      .update({ display_name: "Hijacked" })
      .eq("id", bob.id)
      .select("id");
    expect(other.data).toEqual([]);
    const { data: bobProfile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", bob.id)
      .single();
    expect(bobProfile?.display_name).toBe("Bob");
  });

  it("reject updates to protected columns, inserts and deletes", async () => {
    const created = await alice.client
      .from("profiles")
      .update({ created_at: new Date(0).toISOString() })
      .eq("id", alice.id);
    expectError(created.error, PERMISSION_DENIED);

    const insert = await alice.client
      .from("profiles")
      .insert({ id: randomUUID(), display_name: "Ghost" });
    expectError(insert.error, PERMISSION_DENIED);

    const del = await alice.client.from("profiles").delete().eq("id", alice.id);
    expectError(del.error, PERMISSION_DENIED);
  });

  it("enforce the display name length", async () => {
    const { error } = await alice.client
      .from("profiles")
      .update({ display_name: "" })
      .eq("id", alice.id);
    expectError(error, CHECK_VIOLATION);
  });
});

describe("households", () => {
  it("are visible to active members only", async () => {
    const read = async (user: User) =>
      ids((await user.client.from("households").select("id")).data);

    expect(await read(alice)).toEqual([householdA]);
    expect(await read(bob)).toEqual([householdA]);
    expect(await read(carol)).toEqual([householdB]);
    expect(await read(dave)).toEqual([]);
  });

  it("cannot be created or deleted directly", async () => {
    const insert = await alice.client.from("households").insert({
      name: "Direct",
      timezone: "Asia/Kolkata",
      created_by: alice.id,
    });
    expectError(insert.error, PERMISSION_DENIED);

    const del = await alice.client
      .from("households")
      .delete()
      .eq("id", householdA);
    expectError(del.error, PERMISSION_DENIED);
  });

  it("can be updated by the owner only", async () => {
    const byMember = await bob.client
      .from("households")
      .update({ name: "Bob's place" })
      .eq("id", householdA)
      .select("id");
    expect(byMember.data).toEqual([]);

    const byOutsider = await carol.client
      .from("households")
      .update({ name: "Carol's now" })
      .eq("id", householdA)
      .select("id");
    expect(byOutsider.data).toEqual([]);

    const byOwner = await alice.client
      .from("households")
      .update({ name: `A renamed ${runId}` })
      .eq("id", householdA)
      .select("id, name");
    expect(byOwner.data).toEqual([
      { id: householdA, name: `A renamed ${runId}` },
    ]);
  });

  it("reject changes to created_by", async () => {
    const { error } = await alice.client
      .from("households")
      .update({ created_by: bob.id })
      .eq("id", householdA);
    expectError(error, PERMISSION_DENIED);
  });

  it("validate currency code and timezone", async () => {
    const currency = await alice.client
      .from("households")
      .update({ currency_code: "inr" })
      .eq("id", householdA);
    expectError(currency.error, CHECK_VIOLATION);

    const timezone = await alice.client
      .from("households")
      .update({ timezone: "Mars/Olympus_Mons" })
      .eq("id", householdA);
    expectError(timezone.error, INVALID_PARAMETER);
  });

  it("default to INR", async () => {
    const { data } = await admin
      .from("households")
      .select("currency_code")
      .eq("id", householdA)
      .single();
    expect(data?.currency_code).toBe("INR");
  });
});

describe("household_members", () => {
  it("are visible to active members of the same household, including history", async () => {
    const read = async (user: User) =>
      (
        await user.client
          .from("household_members")
          .select("household_id, user_id")
      ).data ?? [];

    const seenByAlice = await read(alice);
    expect(seenByAlice.every((m) => m.household_id === householdA)).toBe(true);
    expect(seenByAlice.map((m) => m.user_id).sort()).toEqual(
      [alice.id, bob.id, dave.id].sort(),
    );

    expect(await read(carol)).toEqual([
      { household_id: householdB, user_id: carol.id },
    ]);
    expect(await read(dave)).toEqual([]);
  });

  it("cannot be inserted, updated or deleted directly", async () => {
    const join = await bob.client
      .from("household_members")
      .insert({ household_id: householdB, user_id: bob.id });
    expectError(join.error, PERMISSION_DENIED);

    const promote = await bob.client
      .from("household_members")
      .update({ role: "owner" })
      .eq("user_id", bob.id);
    expectError(promote.error, PERMISSION_DENIED);

    const remove = await alice.client
      .from("household_members")
      .delete()
      .eq("user_id", bob.id);
    expectError(remove.error, PERMISSION_DENIED);
  });
});

describe("invitations", () => {
  it("are visible to active members of the same household only", async () => {
    const read = async (user: User) =>
      ids((await user.client.from("invitations").select("id")).data);

    expect(await read(alice)).toEqual([inviteByAlice, inviteByBob].sort());
    expect(await read(bob)).toEqual([inviteByAlice, inviteByBob].sort());
    expect(await read(carol)).toEqual([inviteInB]);
    expect(await read(dave)).toEqual([]);
  });

  it("can be created by any active member, attributed to them, with D5 defaults", async () => {
    const { data, error } = await bob.client
      .from("invitations")
      .insert({ household_id: householdA, token_hash: tokenHash() })
      .select(
        "created_by, max_uses, use_count, revoked_at, created_at, expires_at",
      )
      .single();
    expect(error).toBeNull();
    expect(data?.created_by).toBe(bob.id);
    expect(data?.max_uses).toBe(10);
    expect(data?.use_count).toBe(0);
    expect(data?.revoked_at).toBeNull();
    const days =
      (Date.parse(data!.expires_at) - Date.parse(data!.created_at)) /
      (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(7, 3);
  });

  it("cannot be created for another household or by a former member", async () => {
    const otherHousehold = await bob.client
      .from("invitations")
      .insert({ household_id: householdB, token_hash: tokenHash() });
    expectError(otherHousehold.error, PERMISSION_DENIED);

    const formerMember = await dave.client
      .from("invitations")
      .insert({ household_id: householdA, token_hash: tokenHash() });
    expectError(formerMember.error, PERMISSION_DENIED);
  });

  it("reject client-set creator, use count or revocation on insert", async () => {
    for (const extra of [
      { created_by: alice.id },
      { use_count: 5 },
      { revoked_at: new Date().toISOString() },
    ]) {
      const { error } = await bob.client.from("invitations").insert({
        household_id: householdA,
        token_hash: tokenHash(),
        ...extra,
      });
      expectError(error, PERMISSION_DENIED);
    }
  });

  it("can be revoked by their creator or the owner, and by no one else", async () => {
    const revoke = (user: User, id: string) =>
      user.client
        .from("invitations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id)
        .select("id");

    // A member cannot revoke someone else's invite; an outsider cannot see it.
    expect((await revoke(bob, inviteByAlice)).data).toEqual([]);
    expect((await revoke(carol, inviteByAlice)).data).toEqual([]);
    expect((await revoke(dave, inviteByBob)).data).toEqual([]);

    // The creator can revoke their own; the owner can revoke anyone's.
    expect(ids((await revoke(bob, inviteByBob)).data)).toEqual([inviteByBob]);
    const second = await returning(
      admin
        .from("invitations")
        .insert({
          household_id: householdA,
          token_hash: tokenHash(),
          created_by: bob.id,
        })
        .select("id")
        .single(),
    );
    expect(ids((await revoke(alice, second.id)).data)).toEqual([second.id]);
  });

  it("cannot be un-revoked, re-limited or deleted", async () => {
    const unrevoke = await bob.client
      .from("invitations")
      .update({ revoked_at: null })
      .eq("id", inviteByBob)
      .select("id");
    expect(unrevoke.data).toEqual([]);

    const relimit = await alice.client
      .from("invitations")
      .update({ max_uses: 1000 })
      .eq("id", inviteByAlice);
    expectError(relimit.error, PERMISSION_DENIED);

    const del = await alice.client
      .from("invitations")
      .delete()
      .eq("id", inviteByAlice);
    expectError(del.error, PERMISSION_DENIED);
  });
});

describe("constraints", () => {
  it("allow at most one active owner per household", async () => {
    const { error } = await admin
      .from("household_members")
      .update({ role: "owner" })
      .eq("household_id", householdA)
      .eq("user_id", bob.id);
    expectError(error, UNIQUE_VIOLATION);
  });

  it("require an active owner while the household has active members", async () => {
    const { error } = await admin
      .from("household_members")
      .update({ role: "member" })
      .eq("household_id", householdA)
      .eq("user_id", alice.id);
    expectError(error, CHECK_VIOLATION);
  });

  it("stop the owner from leaving without transferring ownership", async () => {
    const { error } = await admin
      .from("household_members")
      .update({ left_at: new Date().toISOString() })
      .eq("household_id", householdA)
      .eq("user_id", alice.id);
    expectError(error, CHECK_VIOLATION);
  });

  it("allow one active membership per user, and rejoining after leaving", async () => {
    const duplicate = await admin
      .from("household_members")
      .insert({ household_id: householdA, user_id: bob.id });
    expectError(duplicate.error, UNIQUE_VIOLATION);

    const rejoin = await admin
      .from("household_members")
      .insert({ household_id: householdA, user_id: dave.id })
      .select("id")
      .single();
    expect(rejoin.error).toBeNull();
    await admin.from("household_members").delete().eq("id", rejoin.data!.id);
  });

  it("validate invitation token hashes and use counts", async () => {
    const badHash = await admin.from("invitations").insert({
      household_id: householdA,
      token_hash: "not-a-hash",
      created_by: alice.id,
    });
    expectError(badHash.error, CHECK_VIOLATION);

    const overUsed = await admin
      .from("invitations")
      .update({ use_count: 11 })
      .eq("id", inviteByAlice);
    expectError(overUsed.error, CHECK_VIOLATION);

    const duplicate = await admin
      .from("invitations")
      .select("token_hash")
      .eq("id", inviteByAlice)
      .single();
    const reused = await admin.from("invitations").insert({
      household_id: householdB,
      token_hash: duplicate.data!.token_hash,
      created_by: carol.id,
    });
    expectError(reused.error, UNIQUE_VIOLATION);
  });

  it("block deleting an auth user who still has a profile (D14)", async () => {
    const { error } = await admin.auth.admin.deleteUser(carol.id);
    expect(error).not.toBeNull();
    const { data } = await admin
      .from("profiles")
      .select("id")
      .eq("id", carol.id);
    expect(ids(data)).toEqual([carol.id]);
  });
});
