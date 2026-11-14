// Operations (roadmap Phase 18) against the local stack:
//
// - public.health_check(), behind GET /api/health: anyone may call it, signed
//   in or not, and it says only "true".
// - Deleting an account (D14) as the operator procedure in
//   docs/operations.md: the person leaves every household; the sign-in is
//   removed with Supabase Auth's soft delete (a hard delete is refused, since
//   records point at the profile); private.anonymise_account() then turns the
//   profile into "Former member" and removes their own notifications and
//   settings, while every record other members rely on stays as it was.
//
// Needs `npm run db:start`, then `npm run test:db`. Everything is created for
// this run and removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBalancesPayload } from "@/lib/balances/parse";
import { todayIn } from "@/lib/expenses/dates";
import {
  adminClient,
  anonClient,
  psqlAsSuperuser,
  signedInClient,
  type TypedClient,
} from "./support/local-supabase";

const TZ = "Asia/Kolkata";
const runId = randomUUID().slice(0, 8);
const password = `ops-${randomUUID()}`;
const admin = adminClient();

type User = { id: string; email: string; name: string; client: TypedClient };
const users: User[] = [];
let olive: User, pat: User;
let H: string;

/** The data of a call that must succeed and answer. */
async function must<T>(
  query: PromiseLike<{ data: T; error: PostgrestError | null }>,
): Promise<NonNullable<T>> {
  const { data, error } = await query;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("No data returned");
  return data;
}

/** A call that must succeed and returns nothing. */
async function ok(query: PromiseLike<{ error: PostgrestError | null }>) {
  const { error } = await query;
  if (error) throw error;
}

async function createUser(name: string): Promise<User> {
  const email = `ops-${runId}-${name.split(" ")[0].toLowerCase()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  const user = {
    id: data.user.id,
    email,
    name,
    client: await signedInClient(email, password),
  };
  users.push(user);
  return user;
}

/** Runs the D14 procedure as the given database role; returns psql's outcome. */
function anonymise(userId: string, role = "service_role") {
  if (!/^[0-9a-f-]{36}$/.test(userId)) throw new Error("not a uuid");
  return psqlAsSuperuser(
    `\\set VERBOSITY verbose\nset role ${role};\nselect private.anonymise_account('${userId}');\n`,
  );
}

function scalar(sql: string): string {
  const result = psqlAsSuperuser(
    `\\pset tuples_only on\n\\pset format unaligned\n${sql}`,
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

/** The records other members rely on, as the service role reads them. */
async function records() {
  const [expenses, splits, settlements, events, members] = await Promise.all([
    must(admin.from("expenses").select("*").eq("household_id", H).order("id")),
    must(
      admin
        .from("expense_splits")
        .select("*")
        .eq("household_id", H)
        .order("expense_id")
        .order("user_id"),
    ),
    must(
      admin.from("settlements").select("*").eq("household_id", H).order("id"),
    ),
    must(
      admin
        .from("activity_events")
        .select("*")
        .eq("household_id", H)
        .order("id"),
    ),
    must(
      admin
        .from("household_members")
        .select("*")
        .eq("household_id", H)
        .order("user_id"),
    ),
  ]);
  return { expenses, splits, settlements, events, members };
}

beforeAll(async () => {
  olive = await createUser(`Olive ${runId}`);
  pat = await createUser(`Patience ${runId}`);
  const today = todayIn(TZ);
  H = await must(
    olive.client.rpc("create_household", {
      household_name: `Ops ${runId}`,
      currency: "INR",
      time_zone: TZ,
    }),
  );
  const bytes = randomBytes(32);
  await ok(
    olive.client.from("invitations").insert({
      household_id: H,
      token_hash: createHash("sha256").update(bytes).digest("hex"),
    }),
  );
  await must(
    pat.client.rpc("accept_invite", { token: bytes.toString("base64url") }),
  );
  await must(
    olive.client.rpc("create_expense", {
      target_household_id: H,
      title: "Groceries",
      amount: 1000,
      expense_category: "groceries",
      spent_on: today,
      payer_id: olive.id,
      method: "equal",
      shares: [
        { user_id: olive.id, share_minor: 500, percentage_bp: null },
        { user_id: pat.id, share_minor: 500, percentage_bp: null },
      ],
    }),
  );
  // Paid back in full, so Patience can leave (D13).
  await must(
    pat.client.rpc("record_settlement", {
      target_household_id: H,
      payer_id: pat.id,
      recipient_id: olive.id,
      amount: 500,
      paid_on: today,
    }),
  );
  await ok(
    pat.client.rpc("set_notification_preferences", {
      target_household_id: H,
      muted_categories: ["shopping"],
    }),
  );
}, 60_000);

afterAll(async () => {
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await admin.from("households").delete().in("created_by", ids);
    await admin.from("profiles").delete().in("id", ids);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  }
});

describe("the health check", () => {
  it("answers anyone, signed in or not, with true and nothing else", async () => {
    const signedOut = await anonClient().rpc("health_check");
    expect({ data: signedOut.data, error: signedOut.error }).toEqual({
      data: true,
      error: null,
    });
    expect(await must(olive.client.rpc("health_check"))).toBe(true);
  });
});

describe("deleting an account (D14)", () => {
  it("refuses an id with no account", () => {
    const result = anonymise(randomUUID());
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("HJ033");
  });

  it("can't be run by signed-in people or signed-out ones", () => {
    for (const role of ["authenticated", "anon"]) {
      const result = anonymise(pat.id, role);
      expect(result.status, role).not.toBe(0);
      expect(result.stderr, role).toMatch(/42501|permission denied/);
    }
    expect(
      scalar(`select display_name from public.profiles where id = '${pat.id}'`),
    ).toBe(pat.name);
  });

  it("refuses someone who is still a member of a household", () => {
    const result = anonymise(pat.id);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("HJ034");
    expect(
      scalar(`select display_name from public.profiles where id = '${pat.id}'`),
    ).toBe(pat.name);
  });

  it("removes the sign-in and the name, and keeps every record others rely on", async () => {
    // 1. They leave every household (the app's own Leave, with a zero balance).
    await ok(pat.client.rpc("leave_household", { target_household_id: H }));
    const before = await records();
    expect(before.expenses).toHaveLength(1);
    expect(before.settlements).toHaveLength(1);
    expect(
      await must(
        admin.from("notifications").select("id").eq("user_id", pat.id),
      ),
    ).not.toHaveLength(0);

    // 2. A hard delete is refused while the profile exists (ON DELETE RESTRICT),
    //    so the dashboard's Delete user can't be used.
    const hard = await admin.auth.admin.deleteUser(pat.id);
    expect(hard.error).not.toBeNull();
    expect(
      scalar(`select count(*) from auth.users where id = '${pat.id}'`),
    ).toBe("1");

    // 3. The soft delete removes the sign-in.
    const soft = await admin.auth.admin.deleteUser(pat.id, true);
    expect(soft.error).toBeNull();
    const signIn = await anonClient().auth.signInWithPassword({
      email: pat.email,
      password,
    });
    expect(signIn.error).not.toBeNull();
    expect(
      scalar(`select (deleted_at is not null)::text || ',' || (email is distinct from '${pat.email}')::text
                || ',' || raw_user_meta_data::text
                || ',' || (select count(*) from auth.sessions s where s.user_id = u.id)
                || ',' || (select count(*) from auth.refresh_tokens t where t.user_id = u.id::text)
              from auth.users u where id = '${pat.id}'`),
    ).toBe("true,true,{},0,0");
    expect(
      scalar(`select count(*) from auth.identities
              where user_id = '${pat.id}' and identity_data::text like '%${pat.email}%'`),
    ).toBe("0");

    // 4. The operator anonymises the profile.
    const result = anonymise(pat.id);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    // Running it again changes nothing and doesn't fail.
    expect(anonymise(pat.id).status).toBe(0);

    const profile = await must(
      admin
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", pat.id)
        .single(),
    );
    expect(profile).toEqual({
      display_name: "Former member",
      avatar_url: null,
    });
    expect(
      await must(
        admin.from("notifications").select("id").eq("user_id", pat.id),
      ),
    ).toEqual([]);
    expect(
      await must(
        admin
          .from("notification_preferences")
          .select("user_id")
          .eq("user_id", pat.id),
      ),
    ).toEqual([]);
    expect(await records()).toEqual(before);

    // What the other members see: the same money, under "Former member".
    const balances = parseBalancesPayload(
      await must(
        olive.client.rpc("household_balances", { target_household_id: H }),
      ),
    );
    const former = balances!.people.find((p) => p.userId === pat.id);
    expect(former).toMatchObject({
      displayName: "Former member",
      isActive: false,
      shareMinor: BigInt(500),
      settlementsPaidMinor: BigInt(500),
      netMinor: BigInt(0),
    });
    const journal = JSON.stringify(
      await must(
        olive.client.rpc("household_journal", { target_household_id: H }),
      ),
    );
    expect(journal).toContain("Former member");
    expect(journal).not.toContain(pat.name);
    const history = JSON.stringify(
      await must(
        olive.client.rpc("expense_history", { target_household_id: H }),
      ),
    );
    expect(history).not.toContain(pat.name);
  });
});
