// Authorization regression tests for the security audit (roadmap Phase 18),
// against the local stack.
//
// 1. The catalog: RLS on every table, no views, what anon, authenticated and
//    PUBLIC may do with each table, column and function, a pinned search_path
//    on every function, the operator-only D14 procedure, and the private
//    schema kept out of the Data API. Supabase's default privileges grant
//    anon and authenticated everything on each new table and function in
//    public, so a migration that forgets its revoke fails here.
// 2. Another household's records: someone outside it, someone who has left
//    it, and someone signed out call every function and table with its ids.
//    Each call is refused with the expected code, nothing is readable, and
//    every row of the household (and its people's profiles) is unchanged,
//    compared row by row with a snapshot taken by the database superuser.
// 3. A member's role: an ordinary member can't do what belongs to the owner,
//    the person who added a record, or the two people in a settlement.
// 4. References across households: people and records from another
//    household are refused inside your own.
//
// Needs `npm run db:start`, then `npm run test:db`. Everything is created for
// this run and removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMonths } from "@/lib/bills/schedule";
import { parseBalancesPayload } from "@/lib/balances/parse";
import { periodStart } from "@/lib/budgets/period";
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
const password = `authz-${randomUUID()}`;
const admin = adminClient();

const HOUSEHOLD_TABLES = [
  "activity_events",
  "bill_occurrences",
  "budget_limits",
  "budgets",
  "chores",
  "expense_splits",
  "expenses",
  "household_members",
  "invitations",
  "notification_preferences",
  "notifications",
  "recurring_bill_shares",
  "recurring_bills",
  "settlements",
  "shopping_items",
] as const;
const ALL_TABLES = [...HOUSEHOLD_TABLES, "households", "profiles"].sort();

type User = { id: string; name: string; client: TypedClient };
const users: User[] = [];
let olive: User, pat: User, quin: User, rae: User, xena: User;
let H: string, X: string;
let today: string, monthStart: string;
// Household H's records.
let E: string, ED: string, S: string, B: string, I: string, C: string;
let G: string, INV: string;
let patNotifications: string[];
// Household X's records (Xena's own).
let EX: string, IX: string, CX: string, BX: string;

type Result = { data?: unknown; error: PostgrestError | null };
type Attack = {
  name: string;
  /** The refusal a signed-in outsider or former member gets. */
  code: string;
  run: (client: TypedClient, me: string) => PromiseLike<Result>;
};

/** Plain table access, for tables written without the typed helpers. */
function untyped(client: TypedClient): SupabaseClient {
  return client as unknown as SupabaseClient;
}

function shares(...parts: [string, number][]) {
  return parts.map(([userId, minor]) => ({
    user_id: userId,
    share_minor: minor,
    percentage_bp: null,
  }));
}

function sql(query: string): string {
  const result = psqlAsSuperuser(
    `\\pset tuples_only on\n\\pset format unaligned\n${query}`,
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function lines(query: string): string[] {
  const out = sql(query);
  return out === "" ? [] : out.split("\n");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every row of a household and its people's profiles, as the superuser sees them. */
function snapshot(householdId: string): Record<string, unknown[]> {
  const people = users.map((u) => u.id);
  for (const id of [householdId, ...people]) {
    if (!UUID.test(id)) throw new Error("not a uuid");
  }
  const agg = (from: string, where: string) =>
    `(select coalesce(json_agg(x order by x::text), '[]') from ${from} x where ${where})`;
  const parts = HOUSEHOLD_TABLES.map(
    (t) => `'${t}', ${agg(`public.${t}`, `x.household_id = '${householdId}'`)}`,
  );
  parts.push(
    `'households', ${agg("public.households", `x.id = '${householdId}'`)}`,
  );
  parts.push(
    `'profiles', ${agg("public.profiles", `x.id in (${people.map((p) => `'${p}'`).join(", ")})`)}`,
  );
  return JSON.parse(sql(`select json_build_object(${parts.join(", ")});`));
}

async function createUser(name: string): Promise<User> {
  const email = `authz-${runId}-${name.toLowerCase()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  const user = {
    id: data.user.id,
    name,
    client: await signedInClient(email, password),
  };
  users.push(user);
  return user;
}

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

async function household(owner: User, name: string) {
  return must(
    owner.client.rpc("create_household", {
      household_name: `${name} ${runId}`,
      currency: "INR",
      time_zone: TZ,
    }),
  );
}

/** Another household's records, by their ids: every function and table. */
function attacks(): Attack[] {
  const next = addMonths(monthStart, 1);
  const rpc = (
    name: string,
    code: string,
    run: (c: TypedClient, me: string) => PromiseLike<Result>,
  ): Attack => ({ name, code, run });
  return [
    // Writes that name the household.
    rpc("create_expense", "42501", (c) =>
      c.rpc("create_expense", {
        target_household_id: H,
        title: "Sneaky",
        amount: 100,
        expense_category: "other",
        spent_on: today,
        payer_id: olive.id,
        method: "equal",
        shares: shares([olive.id, 50], [pat.id, 50]),
      }),
    ),
    rpc("record_settlement", "42501", (c, me) =>
      c.rpc("record_settlement", {
        target_household_id: H,
        payer_id: me,
        recipient_id: olive.id,
        amount: 1,
        paid_on: today,
      }),
    ),
    rpc("create_recurring_bill", "42501", (c) =>
      c.rpc("create_recurring_bill", {
        target_household_id: H,
        title: "Sneaky",
        amount: 100,
        bill_category: "rent",
        bill_payer_id: olive.id,
        method: "equal",
        shares: shares([olive.id, 100]),
        repeat_unit: "month",
        repeat_every: 1,
        first_due_on: today,
      }),
    ),
    rpc("add_shopping_item", "42501", (c) =>
      c.rpc("add_shopping_item", {
        target_household_id: H,
        item_name: "Sneaky",
      }),
    ),
    rpc("create_chore", "42501", (c) =>
      c.rpc("create_chore", { target_household_id: H, chore_title: "Sneaky" }),
    ),
    rpc("create_budget", "42501", (c) =>
      c.rpc("create_budget", {
        target_household_id: H,
        budget_kind: "week",
        budget_limit: 100,
      }),
    ),
    rpc("set_notification_preferences", "42501", (c) =>
      c.rpc("set_notification_preferences", {
        target_household_id: H,
        muted_categories: ["expenses"],
      }),
    ),
    rpc("remove_member", "42501", (c) =>
      c.rpc("remove_member", {
        target_household_id: H,
        member_user_id: pat.id,
      }),
    ),
    rpc("transfer_ownership", "42501", (c, me) =>
      c.rpc("transfer_ownership", {
        target_household_id: H,
        new_owner_user_id: me,
      }),
    ),
    rpc("leave_household", "42501", (c) =>
      c.rpc("leave_household", { target_household_id: H }),
    ),
    rpc("delete_household", "42501", (c) =>
      c.rpc("delete_household", { target_household_id: H }),
    ),
    // Writes that name a record: answered as if it didn't exist.
    rpc("update_expense", "HJ009", (c) =>
      c.rpc("update_expense", {
        target_expense_id: E,
        title: "Taken",
        amount: 100,
        expense_category: "other",
        spent_on: today,
        payer_id: olive.id,
        method: "equal",
        shares: shares([olive.id, 100]),
      }),
    ),
    rpc("delete_expense", "HJ009", (c) =>
      c.rpc("delete_expense", { target_expense_id: E }),
    ),
    rpc("restore_expense", "HJ009", (c) =>
      c.rpc("restore_expense", { target_expense_id: ED }),
    ),
    rpc("void_settlement", "HJ014", (c) =>
      c.rpc("void_settlement", { target_settlement_id: S }),
    ),
    rpc("update_recurring_bill", "HJ018", (c) =>
      c.rpc("update_recurring_bill", {
        target_bill_id: B,
        title: "Taken",
        amount: 100,
        bill_category: "rent",
        bill_payer_id: olive.id,
        method: "equal",
        shares: shares([olive.id, 100]),
      }),
    ),
    rpc("reschedule_recurring_bill", "HJ018", (c) =>
      c.rpc("reschedule_recurring_bill", {
        target_bill_id: B,
        repeat_unit: "week",
        repeat_every: 1,
        next_due_on: next,
      }),
    ),
    rpc("pause_recurring_bill", "HJ018", (c) =>
      c.rpc("pause_recurring_bill", { target_bill_id: B }),
    ),
    rpc("resume_recurring_bill", "HJ018", (c) =>
      c.rpc("resume_recurring_bill", { target_bill_id: B }),
    ),
    rpc("end_recurring_bill", "HJ018", (c) =>
      c.rpc("end_recurring_bill", { target_bill_id: B }),
    ),
    rpc("skip_bill_occurrence", "HJ018", (c) =>
      c.rpc("skip_bill_occurrence", {
        target_bill_id: B,
        occurrence_due_on: next,
      }),
    ),
    rpc("unskip_bill_occurrence", "HJ018", (c) =>
      c.rpc("unskip_bill_occurrence", {
        target_bill_id: B,
        occurrence_due_on: monthStart,
      }),
    ),
    rpc("record_bill_payment", "HJ018", (c) =>
      c.rpc("record_bill_payment", {
        target_bill_id: B,
        occurrence_due_on: next,
        title: "Rent",
        amount: 100,
        expense_category: "rent",
        spent_on: today,
        payer_id: olive.id,
        method: "equal",
        shares: shares([olive.id, 100]),
      }),
    ),
    rpc("update_shopping_item", "HJ026", (c) =>
      c.rpc("update_shopping_item", { target_item_id: I, item_name: "Taken" }),
    ),
    rpc("purchase_shopping_item", "HJ026", (c) =>
      c.rpc("purchase_shopping_item", { target_item_id: I }),
    ),
    rpc("reopen_shopping_item", "HJ026", (c) =>
      c.rpc("reopen_shopping_item", { target_item_id: I }),
    ),
    rpc("remove_shopping_item", "HJ026", (c) =>
      c.rpc("remove_shopping_item", { target_item_id: I }),
    ),
    rpc("update_chore", "HJ027", (c) =>
      c.rpc("update_chore", { target_chore_id: C, chore_title: "Taken" }),
    ),
    rpc("complete_chore", "HJ027", (c) =>
      c.rpc("complete_chore", { target_chore_id: C }),
    ),
    rpc("reopen_chore", "HJ027", (c) =>
      c.rpc("reopen_chore", { target_chore_id: C }),
    ),
    rpc("remove_chore", "HJ027", (c) =>
      c.rpc("remove_chore", { target_chore_id: C }),
    ),
    rpc("update_budget", "HJ031", (c) =>
      c.rpc("update_budget", { target_budget_id: G, budget_limit: 1 }),
    ),
    rpc("archive_budget", "HJ031", (c) =>
      c.rpc("archive_budget", { target_budget_id: G }),
    ),
    // Reads.
    rpc("household_balances", "42501", (c) =>
      c.rpc("household_balances", {
        target_household_id: H,
        focus_user_id: pat.id,
      }),
    ),
    rpc("expense_history", "42501", (c) =>
      c.rpc("expense_history", { target_household_id: H }),
    ),
    rpc("household_journal", "42501", (c) =>
      c.rpc("household_journal", { target_household_id: H }),
    ),
    rpc("household_bills", "42501", (c) =>
      c.rpc("household_bills", { target_household_id: H }),
    ),
    rpc("recurring_bill", "HJ018", (c) =>
      c.rpc("recurring_bill", { target_bill_id: B }),
    ),
    rpc("household_budgets", "42501", (c) =>
      c.rpc("household_budgets", {
        target_household_id: H,
        budget_kind: "month",
      }),
    ),
    rpc("household_analytics", "42501", (c) =>
      c.rpc("household_analytics", {
        target_household_id: H,
        date_from: monthStart,
        date_to: today,
      }),
    ),
    // Tables written directly: no grant for any of these.
    rpc("insert household_members (join yourself)", "42501", (c, me) =>
      untyped(c)
        .from("household_members")
        .insert({ household_id: H, user_id: me, role: "owner" }),
    ),
    rpc("update household_members", "42501", (c) =>
      untyped(c)
        .from("household_members")
        .update({ role: "member" })
        .eq("household_id", H),
    ),
    rpc("insert expenses", "42501", (c, me) =>
      untyped(c).from("expenses").insert({
        household_id: H,
        description: "Sneaky",
        amount_minor: 100,
        paid_by: me,
      }),
    ),
    rpc("update settlements", "42501", (c) =>
      untyped(c).from("settlements").update({ amount_minor: 1 }).eq("id", S),
    ),
    rpc("delete expense_splits", "42501", (c) =>
      untyped(c).from("expense_splits").delete().eq("expense_id", E),
    ),
    rpc("delete activity_events", "42501", (c) =>
      untyped(c).from("activity_events").delete().eq("household_id", H),
    ),
    rpc("update notifications", "42501", (c) =>
      untyped(c)
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("household_id", H),
    ),
    // The one insert signed-in people may make, which RLS limits to their own households.
    rpc("insert invitations", "42501", (c) =>
      c.from("invitations").insert({
        household_id: H,
        token_hash: createHash("sha256").update(randomBytes(32)).digest("hex"),
      }),
    ),
  ];
}

/** Updates signed-in people may make, which RLS limits to rows they may change. */
function silentUpdates(): {
  name: string;
  run: (c: TypedClient) => PromiseLike<Result>;
}[] {
  return [
    {
      name: "rename the household",
      run: (c) =>
        c.from("households").update({ name: "Taken" }).eq("id", H).select("id"),
    },
    {
      name: "revoke its invitation",
      run: (c) =>
        c
          .from("invitations")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", INV)
          .select("id"),
    },
    {
      name: "rename a member",
      run: (c) =>
        c
          .from("profiles")
          .update({ display_name: "Taken" })
          .eq("id", pat.id)
          .select("id"),
    },
  ];
}

beforeAll(async () => {
  [olive, pat, quin, rae, xena] = await Promise.all(
    ["Olive", "Pat", "Quin", "Rae", "Xena"].map(createUser),
  );
  today = todayIn(TZ);
  monthStart = periodStart(today, "month");
  H = await household(olive, "Guarded");
  X = await household(xena, "Elsewhere");

  const bytes = randomBytes(32);
  await ok(
    olive.client.from("invitations").insert({
      household_id: H,
      token_hash: createHash("sha256").update(bytes).digest("hex"),
    }),
  );
  for (const member of [pat, quin, rae]) {
    await must(
      member.client.rpc("accept_invite", {
        token: bytes.toString("base64url"),
      }),
    );
  }
  INV = (
    await must(
      olive.client
        .from("invitations")
        .insert({
          household_id: H,
          token_hash: createHash("sha256")
            .update(randomBytes(32))
            .digest("hex"),
        })
        .select("id")
        .single(),
    )
  ).id;

  const expense = (amount: number) => ({
    target_household_id: H,
    title: "Groceries",
    amount,
    expense_category: "groceries" as const,
    spent_on: today,
    payer_id: olive.id,
    method: "equal" as const,
    shares: shares([olive.id, amount / 2], [pat.id, amount / 2]),
  });
  E = await must(olive.client.rpc("create_expense", expense(90000)));
  ED = await must(olive.client.rpc("create_expense", expense(5000)));
  await ok(olive.client.rpc("delete_expense", { target_expense_id: ED }));
  S = await must(
    pat.client.rpc("record_settlement", {
      target_household_id: H,
      payer_id: pat.id,
      recipient_id: olive.id,
      amount: 1000,
      paid_on: today,
    }),
  );
  const firstDue = addMonths(monthStart, -1);
  B = await must(
    olive.client.rpc("create_recurring_bill", {
      target_household_id: H,
      title: "Rent",
      amount: 3000000,
      bill_category: "rent",
      bill_payer_id: olive.id,
      method: "equal",
      shares: shares([olive.id, 1500000], [pat.id, 1500000]),
      repeat_unit: "month",
      repeat_every: 1,
      first_due_on: firstDue,
    }),
  );
  await must(
    olive.client.rpc("record_bill_payment", {
      target_bill_id: B,
      occurrence_due_on: firstDue,
      title: "Rent",
      amount: 3000000,
      expense_category: "rent",
      spent_on: today,
      payer_id: olive.id,
      method: "equal",
      shares: shares([olive.id, 1500000], [pat.id, 1500000]),
    }),
  );
  await ok(
    olive.client.rpc("skip_bill_occurrence", {
      target_bill_id: B,
      occurrence_due_on: monthStart,
    }),
  );
  I = await must(
    olive.client.rpc("add_shopping_item", {
      target_household_id: H,
      item_name: "Milk",
    }),
  );
  C = await must(
    olive.client.rpc("create_chore", {
      target_household_id: H,
      chore_title: "Bins",
      chore_assignee_id: pat.id,
    }),
  );
  G = await must(
    olive.client.rpc("create_budget", {
      target_household_id: H,
      budget_kind: "month",
      budget_limit: 500000,
    }),
  );
  await ok(
    pat.client.rpc("set_notification_preferences", {
      target_household_id: H,
      muted_categories: ["shopping"],
    }),
  );
  // Quin was a member, with nothing owed, and has left.
  await ok(quin.client.rpc("leave_household", { target_household_id: H }));

  const notes = await must(
    admin.from("notifications").select("id").eq("user_id", pat.id),
  );
  patNotifications = notes.map((n) => n.id);

  // Xena's own records in X.
  EX = await must(
    xena.client.rpc("create_expense", {
      target_household_id: X,
      title: "Lunch",
      amount: 100,
      expense_category: "dining",
      spent_on: today,
      payer_id: xena.id,
      method: "equal",
      shares: shares([xena.id, 100]),
    }),
  );
  IX = await must(
    xena.client.rpc("add_shopping_item", {
      target_household_id: X,
      item_name: "Tea",
    }),
  );
  CX = await must(
    xena.client.rpc("create_chore", {
      target_household_id: X,
      chore_title: "Dust",
    }),
  );
  BX = await must(
    xena.client.rpc("create_recurring_bill", {
      target_household_id: X,
      title: "Phone",
      amount: 100,
      bill_category: "utilities",
      bill_payer_id: xena.id,
      method: "equal",
      shares: shares([xena.id, 100]),
      repeat_unit: "month",
      repeat_every: 1,
      first_due_on: monthStart,
    }),
  );
}, 90_000);

afterAll(async () => {
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await admin.from("households").delete().in("created_by", ids);
    await admin.from("profiles").delete().in("id", ids);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  }
});

describe("the catalog", () => {
  it("has RLS on every table, and no views", () => {
    expect(
      lines(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`),
    ).toEqual([]);
    // A view would read its tables as its owner, past RLS.
    expect(
      lines(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('v', 'm', 'f') order by 1`),
    ).toEqual([]);
    expect(
      lines(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`),
    ).toEqual(ALL_TABLES);
  });

  it("gives anon and PUBLIC nothing on any table, and authenticated SELECT plus four column grants", () => {
    const tableGrants = (role: string) =>
      lines(`select c.relname || ':' || x.privilege_type
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
             cross join lateral aclexplode(c.relacl) x
             where n.nspname = 'public' and x.grantee = ${role} order by 1`);
    const columnGrants = (role: string) =>
      lines(`select c.relname || '.' || a.attname || ':' || x.privilege_type
             from pg_attribute a join pg_class c on c.oid = a.attrelid
             join pg_namespace n on n.oid = c.relnamespace
             cross join lateral aclexplode(a.attacl) x
             where n.nspname = 'public' and x.grantee = ${role} order by 1`);
    expect(tableGrants("'anon'::regrole")).toEqual([]);
    expect(tableGrants("0")).toEqual([]);
    expect(columnGrants("'anon'::regrole")).toEqual([]);
    expect(columnGrants("0")).toEqual([]);
    expect(tableGrants("'authenticated'::regrole")).toEqual(
      ALL_TABLES.map((t) => `${t}:SELECT`),
    );
    expect(columnGrants("'authenticated'::regrole")).toEqual([
      "households.currency_code:UPDATE",
      "households.name:UPDATE",
      "households.timezone:UPDATE",
      "invitations.expires_at:INSERT",
      "invitations.household_id:INSERT",
      "invitations.max_uses:INSERT",
      "invitations.revoked_at:UPDATE",
      "invitations.token_hash:INSERT",
      "profiles.avatar_url:UPDATE",
      "profiles.display_name:UPDATE",
    ]);
  });

  it("lets anon run only the health check, and PUBLIC nothing", () => {
    expect(
      lines(`select n.nspname || '.' || p.proname from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('public', 'private')
               and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1`),
    ).toEqual(["public.health_check"]);
    expect(
      lines(`select n.nspname || '.' || p.proname from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             cross join lateral aclexplode(p.proacl) x
             where n.nspname in ('public', 'private') and x.grantee = 0`),
    ).toEqual([]);
    // Functions with no ACL at all default to EXECUTE for PUBLIC.
    expect(
      lines(`select n.nspname || '.' || p.proname from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('public', 'private') and p.proacl is null`),
    ).toEqual([]);
    expect(sql(`select has_schema_privilege('anon', 'private', 'USAGE')`)).toBe(
      "f",
    );
  });

  it("pins search_path on every function, and limits the private definer functions signed-in people can run", () => {
    expect(
      lines(`select n.nspname || '.' || p.proname from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('public', 'private')
               and not coalesce(p.proconfig, '{}') @> array['search_path=""']`),
    ).toEqual([]);
    // Each answers only about the caller's own memberships.
    expect(
      lines(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'private' and p.prosecdef
               and has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1`),
    ).toEqual([
      "household_role",
      "is_household_member",
      "shares_household_with",
    ]);
  });

  it("keeps the D14 procedure for operators (the service role) only", () => {
    expect(
      sql(`select string_agg(r || '=' || has_function_privilege(r, 'private.anonymise_account(uuid)', 'EXECUTE'), ',')
           from unnest(array['anon', 'authenticated', 'service_role']) r`),
    ).toBe("anon=false,authenticated=false,service_role=true");
  });

  it("keeps the private schema out of the Data API, and has no storage buckets", async () => {
    const { error } = await untyped(olive.client)
      .schema("private")
      .rpc("anonymise_account", { target_user_id: pat.id });
    expect(error?.code).toBe("PGRST106");
    expect(sql(`select count(*) from storage.buckets`)).toBe("0");
  });
});

describe("another household's records", () => {
  it.each([
    ["someone outside it", () => xena],
    ["someone who has left it", () => quin],
  ])(
    "are refused to %s, and nothing changes",
    async (_label, who) => {
      const attacker = who();
      const before = snapshot(H);
      // The snapshot holds every kind of record, so "unchanged" means something.
      const counts = Object.fromEntries(
        Object.entries(before).map(([table, rows]) => [table, rows.length]),
      );
      expect(counts).toMatchObject({
        households: 1,
        household_members: 4,
        invitations: 2,
        expenses: 3,
        settlements: 1,
        recurring_bills: 1,
        recurring_bill_shares: 2,
        bill_occurrences: 2,
        shopping_items: 1,
        chores: 1,
        budgets: 1,
        budget_limits: 1,
        profiles: 5,
      });
      for (const table of [
        "expense_splits",
        "activity_events",
        "notifications",
        "notification_preferences",
      ]) {
        expect(counts[table], table).toBeGreaterThan(0);
      }

      const outcomes: Record<string, string | null | undefined> = {};
      const expected: Record<string, string> = {};
      for (const attack of attacks()) {
        const { error } = await attack.run(attacker.client, attacker.id);
        outcomes[attack.name] = error?.code ?? null;
        expected[attack.name] = attack.code;
      }
      expect(outcomes).toEqual(expected);

      for (const update of silentUpdates()) {
        const { data, error } = await update.run(attacker.client);
        expect({ name: update.name, error, data }).toEqual({
          name: update.name,
          error: null,
          data: [],
        });
      }
      expect(
        await must(
          attacker.client.rpc("mark_notifications_read", {
            target_notification_ids: patNotifications,
          }),
        ),
      ).toBe(0);
      expect(patNotifications.length).toBeGreaterThan(0);

      // Nothing is readable: every table, its people's profiles, notifications.
      for (const table of [...HOUSEHOLD_TABLES, "households"]) {
        const column = table === "households" ? "id" : "household_id";
        const { data, error } = await untyped(attacker.client)
          .from(table)
          .select("*")
          .eq(column, H);
        expect({ table, error, rows: data }).toEqual({
          table,
          error: null,
          rows: [],
        });
      }
      const profiles = await must(
        attacker.client
          .from("profiles")
          .select("id")
          .in("id", [olive.id, pat.id, rae.id]),
      );
      expect(profiles).toEqual([]);
      const mine = await must(
        attacker.client.rpc("my_notifications", { page_size: 100 }),
      );
      expect(JSON.stringify(mine)).not.toContain(H);
      const theirs = await must(
        attacker.client.rpc("my_notifications", {
          target_notification_id: patNotifications[0],
        }),
      );
      expect((theirs as { rows: unknown[] }).rows).toEqual([]);

      expect(snapshot(H)).toEqual(before);
    },
    60_000,
  );

  it("are refused to someone signed out, as is every function but the health check", async () => {
    const anon = anonClient();
    const before = snapshot(H);
    const outcomes: Record<string, string | null | undefined> = {};
    for (const attack of attacks()) {
      const { error } = await attack.run(anon, olive.id);
      outcomes[attack.name] = error?.code ?? null;
    }
    for (const update of silentUpdates()) {
      outcomes[update.name] = (await update.run(anon)).error?.code ?? null;
    }
    for (const [name, run] of [
      [
        "mark_notifications_read",
        () => anon.rpc("mark_notifications_read", {}),
      ],
      ["my_notifications", () => anon.rpc("my_notifications", {})],
      [
        "my_unread_notification_count",
        () => anon.rpc("my_unread_notification_count"),
      ],
      [
        "create_household",
        () =>
          anon.rpc("create_household", {
            household_name: "Anon",
            currency: "INR",
            time_zone: TZ,
          }),
      ],
      ["accept_invite", () => anon.rpc("accept_invite", { token: "x" })],
      [
        "get_invite_preview",
        () => anon.rpc("get_invite_preview", { token: "x" }),
      ],
    ] as const) {
      outcomes[name] = (await run()).error?.code ?? null;
    }
    for (const table of ALL_TABLES) {
      outcomes[`select ${table}`] =
        (await untyped(anon).from(table).select("*").limit(1)).error?.code ??
        null;
    }
    expect(
      Object.entries(outcomes).filter(([, code]) => code !== "42501"),
    ).toEqual([]);
    expect(await must(anon.rpc("health_check"))).toBe(true);
    expect(snapshot(H)).toEqual(before);
  }, 60_000);
});

describe("a member's role", () => {
  it("can't do what's the owner's, the person's who added it, or the two people's in a settlement", async () => {
    const before = snapshot(H);
    const outcomes: Record<string, string | null | undefined> = {};
    const refused: [string, () => PromiseLike<Result>][] = [
      [
        "delete_household",
        () => rae.client.rpc("delete_household", { target_household_id: H }),
      ],
      [
        "transfer_ownership",
        () =>
          rae.client.rpc("transfer_ownership", {
            target_household_id: H,
            new_owner_user_id: rae.id,
          }),
      ],
      [
        "remove_member",
        () =>
          rae.client.rpc("remove_member", {
            target_household_id: H,
            member_user_id: pat.id,
          }),
      ],
      [
        "restore_expense",
        () => rae.client.rpc("restore_expense", { target_expense_id: ED }),
      ],
      [
        "update_expense",
        () =>
          rae.client.rpc("update_expense", {
            target_expense_id: E,
            title: "Taken",
            amount: 100,
            expense_category: "other",
            spent_on: today,
            payer_id: rae.id,
            method: "equal",
            shares: shares([pat.id, 100]),
          }),
      ],
      [
        "delete_expense",
        () => rae.client.rpc("delete_expense", { target_expense_id: E }),
      ],
      [
        "record_settlement for others",
        () =>
          rae.client.rpc("record_settlement", {
            target_household_id: H,
            payer_id: pat.id,
            recipient_id: olive.id,
            amount: 1,
            paid_on: today,
          }),
      ],
      [
        "void_settlement",
        () => rae.client.rpc("void_settlement", { target_settlement_id: S }),
      ],
      [
        "update_chore",
        () =>
          rae.client.rpc("update_chore", {
            target_chore_id: C,
            chore_title: "Taken",
          }),
      ],
      [
        "update_recurring_bill",
        () =>
          rae.client.rpc("update_recurring_bill", {
            target_bill_id: B,
            title: "Taken",
            amount: 100,
            bill_category: "rent",
            bill_payer_id: olive.id,
            method: "equal",
            shares: shares([olive.id, 100]),
          }),
      ],
      [
        "pause_recurring_bill",
        () => rae.client.rpc("pause_recurring_bill", { target_bill_id: B }),
      ],
      [
        "end_recurring_bill",
        () => rae.client.rpc("end_recurring_bill", { target_bill_id: B }),
      ],
    ];
    for (const [name, run] of refused)
      outcomes[name] = (await run()).error?.code ?? null;
    expect(
      Object.entries(outcomes).filter(([, code]) => code !== "42501"),
    ).toEqual([]);

    const renamed = await rae.client
      .from("households")
      .update({ name: "Taken" })
      .eq("id", H)
      .select("id");
    expect({ error: renamed.error, data: renamed.data }).toEqual({
      error: null,
      data: [],
    });
    expect(snapshot(H)).toEqual(before);
  }, 60_000);
});

describe("references across households", () => {
  it("refuses another household's people and records inside your own", async () => {
    const beforeH = snapshot(H);
    const beforeX = snapshot(X);
    const outcomes: Record<string, string | null | undefined> = {};
    const expected: Record<string, string> = {};
    const cases: [string, string, () => PromiseLike<Result>][] = [
      [
        "expense paid by an outsider",
        "HJ007",
        () =>
          xena.client.rpc("create_expense", {
            target_household_id: X,
            title: "Mixed",
            amount: 100,
            expense_category: "other",
            spent_on: today,
            payer_id: olive.id,
            method: "equal",
            shares: shares([xena.id, 100]),
          }),
      ],
      [
        "expense shared with an outsider",
        "HJ007",
        () =>
          xena.client.rpc("create_expense", {
            target_household_id: X,
            title: "Mixed",
            amount: 100,
            expense_category: "other",
            spent_on: today,
            payer_id: xena.id,
            method: "equal",
            shares: shares([xena.id, 50], [olive.id, 50]),
          }),
      ],
      [
        "expense edited to an outsider",
        "HJ007",
        () =>
          xena.client.rpc("update_expense", {
            target_expense_id: EX,
            title: "Mixed",
            amount: 100,
            expense_category: "other",
            spent_on: today,
            payer_id: olive.id,
            method: "equal",
            shares: shares([xena.id, 100]),
          }),
      ],
      [
        "settlement with an outsider",
        "HJ016",
        () =>
          xena.client.rpc("record_settlement", {
            target_household_id: X,
            payer_id: xena.id,
            recipient_id: olive.id,
            amount: 100,
            paid_on: today,
          }),
      ],
      [
        "item for an outsider",
        "HJ030",
        () =>
          xena.client.rpc("add_shopping_item", {
            target_household_id: X,
            item_name: "Mixed",
            item_assignee_id: olive.id,
          }),
      ],
      [
        "item given to an outsider",
        "HJ030",
        () =>
          xena.client.rpc("update_shopping_item", {
            target_item_id: IX,
            item_name: "Tea",
            item_assignee_id: olive.id,
          }),
      ],
      [
        "chore for an outsider",
        "HJ030",
        () =>
          xena.client.rpc("create_chore", {
            target_household_id: X,
            chore_title: "Mixed",
            chore_assignee_id: olive.id,
          }),
      ],
      [
        "chore given to an outsider",
        "HJ030",
        () =>
          xena.client.rpc("update_chore", {
            target_chore_id: CX,
            chore_title: "Dust",
            chore_assignee_id: olive.id,
          }),
      ],
      [
        "bill paid by an outsider",
        "HJ007",
        () =>
          xena.client.rpc("create_recurring_bill", {
            target_household_id: X,
            title: "Mixed",
            amount: 100,
            bill_category: "utilities",
            bill_payer_id: olive.id,
            method: "equal",
            shares: shares([xena.id, 100]),
            repeat_unit: "month",
            repeat_every: 1,
            first_due_on: monthStart,
          }),
      ],
      [
        "bill changed to an outsider",
        "HJ007",
        () =>
          xena.client.rpc("update_recurring_bill", {
            target_bill_id: BX,
            title: "Phone",
            amount: 100,
            bill_category: "utilities",
            bill_payer_id: olive.id,
            method: "equal",
            shares: shares([xena.id, 100]),
          }),
      ],
      [
        "bill recorded as paid by an outsider",
        "HJ007",
        () =>
          xena.client.rpc("record_bill_payment", {
            target_bill_id: BX,
            occurrence_due_on: monthStart,
            title: "Phone",
            amount: 100,
            expense_category: "utilities",
            spent_on: today,
            payer_id: olive.id,
            method: "equal",
            shares: shares([xena.id, 100]),
          }),
      ],
      [
        "ownership to an outsider",
        "HJ003",
        () =>
          xena.client.rpc("transfer_ownership", {
            target_household_id: X,
            new_owner_user_id: olive.id,
          }),
      ],
      [
        "removing an outsider",
        "HJ003",
        () =>
          xena.client.rpc("remove_member", {
            target_household_id: X,
            member_user_id: olive.id,
          }),
      ],
    ];
    for (const [name, code, run] of cases) {
      outcomes[name] = (await run()).error?.code ?? null;
      expected[name] = code;
    }
    expect(outcomes).toEqual(expected);

    // Balances focused on an outsider say nothing about them.
    const focused = parseBalancesPayload(
      await must(
        xena.client.rpc("household_balances", {
          target_household_id: X,
          focus_user_id: olive.id,
        }),
      ),
    );
    expect(focused).not.toBeNull();
    expect(focused!.people.map((p) => p.userId)).toEqual([xena.id]);
    expect(focused!.entries).toEqual([]);
    expect(focused!.settlementEntries).toEqual([]);

    expect(snapshot(H)).toEqual(beforeH);
    expect(snapshot(X)).toEqual(beforeX);
  }, 60_000);
});
