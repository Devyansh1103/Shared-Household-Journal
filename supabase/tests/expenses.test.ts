// Phase 8: expenses and splits, as real signed-in users against the local stack.
// Needs `npm run db:start`, then `npm run test:db`.
//
// Household H: olive (owner), pat and quin (members). Household X: xena (owner).
// Everything is created for this run and removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  signedInClient,
  type TypedClient,
} from "./support/local-supabase";
import type { Database } from "@/lib/supabase/database.types";

type Category = Database["public"]["Enums"]["expense_category"];
type Method = Database["public"]["Enums"]["split_method"];
type ShareJson = {
  user_id: string;
  share_minor: number;
  percentage_bp?: number | null;
};

const PERMISSION_DENIED = "42501";
const CHECK_VIOLATION = "23514";
const INVALID_TEXT = "22P02";
const BALANCE_NOT_ZERO = "HJ006";
const NOT_ACTIVE_MEMBER = "HJ007";
const INVALID_SPLIT = "HJ008";
const NO_SUCH_EXPENSE = "HJ009";
const STALE = "HJ010";
const WRONG_STATE = "HJ011";
const CURRENCY_LOCKED = "HJ012";

const runId = randomUUID().slice(0, 8);
const password = `exp-${randomUUID()}`;
const admin = adminClient();

type User = { id: string; client: TypedClient };
let olive: User, pat: User, quin: User, xena: User;
let H: string, X: string;

function expectError(error: PostgrestError | null, code: string) {
  expect(error, `expected Postgres error ${code}`).not.toBeNull();
  expect(error?.code).toBe(code);
}

async function createUser(name: string): Promise<User> {
  const email = `exp-${runId}-${name}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  return { id: data.user.id, client: await signedInClient(email, password) };
}

async function household(owner: User, name: string): Promise<string> {
  const { data, error } = await owner.client.rpc("create_household", {
    household_name: `${name} ${runId}`,
    currency: "INR",
    time_zone: "Asia/Kolkata",
  });
  if (error) throw error;
  return data;
}

async function join(owner: User, householdId: string, ...members: User[]) {
  const bytes = randomBytes(32);
  const insert = await owner.client.from("invitations").insert({
    household_id: householdId,
    token_hash: createHash("sha256").update(bytes).digest("hex"),
  });
  if (insert.error) throw insert.error;
  for (const member of members) {
    const { error } = await member.client.rpc("accept_invite", {
      token: bytes.toString("base64url"),
    });
    if (error) throw error;
  }
}

type ExpenseArgs = {
  household?: string;
  title?: string;
  amount?: number;
  category?: Category;
  date?: string;
  payer?: string;
  method?: Method;
  shares?: ShareJson[];
  key?: string;
};

function expenseArgs(args: ExpenseArgs) {
  return {
    target_household_id: args.household ?? H,
    title: args.title ?? "Groceries run",
    amount: args.amount ?? 9000,
    expense_category: args.category ?? "groceries",
    spent_on: args.date ?? "2026-11-10",
    payer_id: args.payer ?? olive.id,
    method: args.method ?? "equal",
    shares: args.shares ?? [
      { user_id: olive.id, share_minor: 3000 },
      { user_id: pat.id, share_minor: 3000 },
      { user_id: quin.id, share_minor: 3000 },
    ],
    request_key: args.key,
  };
}

async function createExpense(user: User, args: ExpenseArgs = {}) {
  const { data, error } = await user.client.rpc(
    "create_expense",
    expenseArgs(args),
  );
  if (error) throw error;
  return data;
}

async function updateArgs(expenseId: string, args: ExpenseArgs = {}) {
  const base = expenseArgs(args);
  return {
    target_expense_id: expenseId,
    title: base.title,
    amount: base.amount,
    expense_category: base.expense_category,
    spent_on: base.spent_on,
    payer_id: base.payer_id,
    method: base.method,
    shares: base.shares,
  };
}

async function row(expenseId: string) {
  const { data, error } = await admin
    .from("expenses")
    .select("*, expense_splits(user_id, share_minor, percentage_bp)")
    .eq("id", expenseId)
    .single();
  if (error) throw error;
  return data;
}

async function events(expenseId: string) {
  const { data, error } = await admin
    .from("activity_events")
    .select("type, actor_id, summary")
    .eq("entity_id", expenseId)
    .order("created_at");
  if (error) throw error;
  return data;
}

async function expenseCount(householdId: string) {
  const { count, error } = await admin
    .from("expenses")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId);
  if (error) throw error;
  return count ?? 0;
}

beforeAll(async () => {
  [olive, pat, quin, xena] = await Promise.all(
    ["Olive", "Pat", "Quin", "Xena"].map(createUser),
  );
  H = await household(olive, "Expense home");
  X = await household(xena, "Other home");
  await join(olive, H, pat, quin);
}, 60_000);

afterAll(async () => {
  const ids = [olive, pat, quin, xena].filter(Boolean).map((u) => u.id);
  if (ids.length) {
    await admin.from("households").delete().in("created_by", ids);
    await admin.from("profiles").delete().in("id", ids);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  }
});

describe("create_expense", () => {
  it("records the expense, its splits and the creator from the session", async () => {
    const id = await createExpense(pat, { payer: olive.id });
    const saved = await row(id);
    expect(saved).toMatchObject({
      household_id: H,
      description: "Groceries run",
      amount_minor: 9000,
      category: "groceries",
      expense_date: "2026-11-10",
      paid_by: olive.id,
      split_method: "equal",
      created_by: pat.id,
      deleted_at: null,
    });
    const total = saved.expense_splits.reduce((s, x) => s + x.share_minor, 0);
    expect(total).toBe(9000);

    const [event] = await events(id);
    expect(event).toMatchObject({ type: "expense_created", actor_id: pat.id });
    expect(event.summary).toMatchObject({
      after: { amount_minor: 9000, paid_by: olive.id },
    });
  });

  it("returns the same expense for a repeated request key", async () => {
    const key = randomUUID();
    const before = await expenseCount(H);
    const [a, b] = await Promise.all([
      createExpense(olive, { key }),
      createExpense(olive, { key }),
    ]);
    expect(b).toBe(a);
    expect(await createExpense(olive, { key })).toBe(a);
    expect(await expenseCount(H)).toBe(before + 1);
  });

  it("supports percentage and custom splits, with the payer left out", async () => {
    const percentage = await createExpense(olive, {
      amount: 100,
      method: "percentage",
      shares: [
        { user_id: pat.id, share_minor: 33, percentage_bp: 3333 },
        { user_id: quin.id, share_minor: 67, percentage_bp: 6667 },
      ],
    });
    expect((await row(percentage)).expense_splits).toHaveLength(2);

    const custom = await createExpense(olive, {
      amount: 1000,
      method: "custom",
      shares: [
        { user_id: olive.id, share_minor: 0 },
        { user_id: quin.id, share_minor: 1000 },
      ],
    });
    expect((await row(custom)).split_method).toBe("custom");
  });

  it("rejects bad amounts, descriptions and categories", async () => {
    const before = await expenseCount(H);
    const attempt = (args: Record<string, unknown>) =>
      olive.client.rpc("create_expense", {
        ...expenseArgs({}),
        ...args,
      } as never);

    for (const amount of [0, -100, 1000000000000]) {
      const shares = [{ user_id: olive.id, share_minor: amount }];
      expectError((await attempt({ amount, shares })).error, CHECK_VIOLATION);
    }
    expectError((await attempt({ title: "" })).error, CHECK_VIOLATION);
    expectError((await attempt({ title: " padded " })).error, CHECK_VIOLATION);
    expectError(
      (await attempt({ title: "x".repeat(121) })).error,
      CHECK_VIOLATION,
    );
    expectError(
      (await attempt({ expense_category: "fun" })).error,
      INVALID_TEXT,
    );
    expectError((await attempt({ method: "random" })).error, INVALID_TEXT);
    expectError((await attempt({ spent_on: "2026-02-30" })).error, "22008");
    expect(await expenseCount(H)).toBe(before);
  });

  it("rejects splits that don't reconcile or don't match their method", async () => {
    const before = await expenseCount(H);
    const bad: ExpenseArgs[] = [
      // one unit short
      {
        shares: [
          { user_id: olive.id, share_minor: 4500 },
          { user_id: pat.id, share_minor: 4499 },
        ],
      },
      // no participants
      { shares: [] },
      // duplicate participant
      {
        shares: [
          { user_id: pat.id, share_minor: 4500 },
          { user_id: pat.id, share_minor: 4500 },
        ],
      },
      // "equal" shares that differ by more than one unit
      {
        shares: [
          { user_id: olive.id, share_minor: 4502 },
          { user_id: pat.id, share_minor: 4498 },
        ],
      },
      // percentages that don't total 100%
      {
        method: "percentage",
        shares: [
          { user_id: olive.id, share_minor: 4500, percentage_bp: 5000 },
          { user_id: pat.id, share_minor: 4500, percentage_bp: 4000 },
        ],
      },
      // shares that don't follow their percentages
      {
        method: "percentage",
        shares: [
          { user_id: olive.id, share_minor: 9000, percentage_bp: 5000 },
          { user_id: pat.id, share_minor: 0, percentage_bp: 5000 },
        ],
      },
      // percentages on a custom split
      {
        method: "custom",
        shares: [
          { user_id: olive.id, share_minor: 9000, percentage_bp: 10000 },
        ],
      },
      // negative share
      {
        method: "custom",
        shares: [
          { user_id: olive.id, share_minor: 10000 },
          { user_id: pat.id, share_minor: -1000 },
        ],
      },
      // malformed share
      { shares: [{ user_id: "not-a-uuid", share_minor: 9000 }] },
    ];
    for (const args of bad) {
      const { error } = await olive.client.rpc(
        "create_expense",
        expenseArgs(args) as never,
      );
      expectError(error, INVALID_SPLIT);
    }
    expect(await expenseCount(H)).toBe(before);
  });

  it("requires the payer and every participant to be active members", async () => {
    const payer = await olive.client.rpc(
      "create_expense",
      expenseArgs({ payer: xena.id }),
    );
    expectError(payer.error, NOT_ACTIVE_MEMBER);

    const participant = await olive.client.rpc(
      "create_expense",
      expenseArgs({
        shares: [
          { user_id: olive.id, share_minor: 4500 },
          { user_id: xena.id, share_minor: 4500 },
        ],
      }),
    );
    expectError(participant.error, NOT_ACTIVE_MEMBER);
  });

  it("can't be used for a household the caller isn't in, or without a session", async () => {
    const before = await expenseCount(H);
    const outsider = await xena.client.rpc("create_expense", expenseArgs({}));
    expectError(outsider.error, PERMISSION_DENIED);

    const anon = await anonClient().rpc("create_expense", expenseArgs({}));
    expect(anon.error).not.toBeNull();
    expect(await expenseCount(H)).toBe(before);
  });
});

describe("reading expenses", () => {
  it("is limited to active members of the household", async () => {
    await createExpense(olive);
    const mine = await pat.client.from("expenses").select("household_id");
    expect(mine.data?.length).toBeGreaterThan(0);
    expect(mine.data?.every((e) => e.household_id === H)).toBe(true);

    const theirs = await xena.client
      .from("expenses")
      .select("id")
      .eq("household_id", H);
    expect(theirs.data).toEqual([]);
    const splits = await xena.client
      .from("expense_splits")
      .select("expense_id")
      .eq("household_id", H);
    expect(splits.data).toEqual([]);

    const anon = await anonClient().from("expenses").select("id").limit(1);
    expectError(anon.error, PERMISSION_DENIED);
  });
});

describe("direct table writes", () => {
  it("are refused for signed-in users, so every change goes through the functions", async () => {
    const id = await createExpense(olive);
    const insert = await olive.client.from("expenses").insert({
      household_id: H,
      description: "Direct",
      amount_minor: 100,
      category: "other",
      expense_date: "2026-11-10",
      paid_by: olive.id,
      split_method: "custom",
      created_by: pat.id,
    });
    expectError(insert.error, PERMISSION_DENIED);

    const update = await olive.client
      .from("expenses")
      .update({ amount_minor: 1 })
      .eq("id", id);
    expectError(update.error, PERMISSION_DENIED);

    const del = await olive.client.from("expenses").delete().eq("id", id);
    expectError(del.error, PERMISSION_DENIED);

    const split = await olive.client
      .from("expense_splits")
      .update({ share_minor: 0 })
      .eq("expense_id", id);
    expectError(split.error, PERMISSION_DENIED);
  });

  it("can't break the money invariants even with the service role", async () => {
    const orphan = await admin.from("expenses").insert({
      household_id: H,
      description: "No splits",
      amount_minor: 100,
      category: "other",
      expense_date: "2026-11-10",
      paid_by: olive.id,
      split_method: "custom",
      created_by: olive.id,
    });
    expectError(orphan.error, INVALID_SPLIT);

    const id = await createExpense(olive);
    const removeShare = await admin
      .from("expense_splits")
      .delete()
      .eq("expense_id", id)
      .eq("user_id", pat.id);
    expectError(removeShare.error, INVALID_SPLIT);

    const changeAmount = await admin
      .from("expenses")
      .update({ amount_minor: 9001 })
      .eq("id", id);
    expectError(changeAmount.error, INVALID_SPLIT);
  });
});

describe("update_expense (D6)", () => {
  it("lets the creator, the payer and the owner edit, and nobody else", async () => {
    // Created by pat, paid by quin: pat, quin and olive (owner) may edit.
    const id = await createExpense(pat, { payer: quin.id });
    for (const editor of [pat, quin, olive]) {
      const { error } = await editor.client.rpc(
        "update_expense",
        await updateArgs(id, {
          payer: quin.id,
          title: `Edited by ${editor.id.slice(0, 4)}`,
        }),
      );
      expect(error).toBeNull();
    }

    // Created by pat, paid by pat: quin is neither, so quin may not.
    const other = await createExpense(pat, { payer: pat.id });
    const denied = await quin.client.rpc(
      "update_expense",
      await updateArgs(other, { payer: pat.id, title: "Hijack" }),
    );
    expectError(denied.error, PERMISSION_DENIED);
    expect((await row(other)).description).toBe("Groceries run");
  });

  it("can't touch another household's expense, and says only 'not found'", async () => {
    const id = await createExpense(olive);
    const { error } = await xena.client.rpc(
      "update_expense",
      await updateArgs(id, { household: X }),
    );
    expectError(error, NO_SUCH_EXPENSE);
    const missing = await olive.client.rpc(
      "update_expense",
      await updateArgs(randomUUID()),
    );
    expectError(missing.error, NO_SUCH_EXPENSE);
  });

  it("keeps the household and creator, and journals old and new values", async () => {
    const id = await createExpense(pat);
    const { error } = await olive.client.rpc("update_expense", {
      ...(await updateArgs(id, {
        amount: 1000,
        method: "custom",
        category: "utilities",
        shares: [
          { user_id: olive.id, share_minor: 250 },
          { user_id: pat.id, share_minor: 750 },
        ],
      })),
    });
    expect(error).toBeNull();

    const saved = await row(id);
    expect(saved).toMatchObject({
      household_id: H,
      created_by: pat.id,
      amount_minor: 1000,
      category: "utilities",
      split_method: "custom",
    });
    expect(saved.expense_splits).toHaveLength(2);

    const updated = (await events(id)).find(
      (e) => e.type === "expense_updated",
    );
    expect(updated?.actor_id).toBe(olive.id);
    expect(updated?.summary).toMatchObject({
      before: {
        amount_minor: 9000,
        category: "groceries",
        split_method: "equal",
      },
      after: {
        amount_minor: 1000,
        category: "utilities",
        split_method: "custom",
      },
    });
  });

  it("refuses to overwrite a change made since the form was loaded", async () => {
    const id = await createExpense(olive);
    const loaded = (await row(id)).updated_at;
    await olive.client.rpc(
      "update_expense",
      await updateArgs(id, { title: "First edit" }),
    );

    // Olive (creator, payer and owner) edits again from a form loaded earlier.
    const stale = await olive.client.rpc("update_expense", {
      ...(await updateArgs(id, { title: "Second edit" })),
      expected_updated_at: loaded,
    });
    expect(stale.error?.code).toBe(STALE);
    expect((await row(id)).description).toBe("First edit");

    const fresh = await olive.client.rpc("update_expense", {
      ...(await updateArgs(id, { title: "Third edit" })),
      expected_updated_at: (await row(id)).updated_at,
    });
    expect(fresh.error).toBeNull();
  });

  it("re-checks the split and the payer", async () => {
    const id = await createExpense(olive);
    const split = await olive.client.rpc(
      "update_expense",
      await updateArgs(id, { amount: 9001 }),
    );
    expectError(split.error, INVALID_SPLIT);
    const payer = await olive.client.rpc(
      "update_expense",
      await updateArgs(id, { payer: xena.id }),
    );
    expectError(payer.error, NOT_ACTIVE_MEMBER);
    expect((await row(id)).amount_minor).toBe(9000);
  });
});

describe("delete_expense and restore_expense (D6, D7)", () => {
  it("soft-deletes for the creator, payer or owner, keeps the row, and journals it", async () => {
    const id = await createExpense(pat, { payer: pat.id });
    const denied = await quin.client.rpc("delete_expense", {
      target_expense_id: id,
    });
    expectError(denied.error, PERMISSION_DENIED);
    const outsider = await xena.client.rpc("delete_expense", {
      target_expense_id: id,
    });
    expectError(outsider.error, NO_SUCH_EXPENSE);

    const { error } = await pat.client.rpc("delete_expense", {
      target_expense_id: id,
    });
    expect(error).toBeNull();
    const saved = await row(id);
    expect(saved.deleted_at).not.toBeNull();
    expect(saved.deleted_by).toBe(pat.id);
    expect(saved.expense_splits).toHaveLength(3);

    // Still readable by members (D7).
    const visible = await quin.client
      .from("expenses")
      .select("deleted_at")
      .eq("id", id)
      .single();
    expect(visible.data?.deleted_at).not.toBeNull();

    const twice = await pat.client.rpc("delete_expense", {
      target_expense_id: id,
    });
    expectError(twice.error, WRONG_STATE);
    const edit = await pat.client.rpc(
      "update_expense",
      await updateArgs(id, { payer: pat.id }),
    );
    expectError(edit.error, WRONG_STATE);

    expect((await events(id)).map((e) => e.type)).toEqual([
      "expense_created",
      "expense_deleted",
    ]);
  });

  it("lets only the owner restore", async () => {
    const id = await createExpense(pat, { payer: pat.id });
    await pat.client.rpc("delete_expense", { target_expense_id: id });

    const byMember = await pat.client.rpc("restore_expense", {
      target_expense_id: id,
    });
    expectError(byMember.error, PERMISSION_DENIED);

    const byOwner = await olive.client.rpc("restore_expense", {
      target_expense_id: id,
    });
    expect(byOwner.error).toBeNull();
    const saved = await row(id);
    expect(saved.deleted_at).toBeNull();
    expect(saved.deleted_by).toBeNull();

    const notDeleted = await olive.client.rpc("restore_expense", {
      target_expense_id: id,
    });
    expectError(notDeleted.error, WRONG_STATE);
    expect((await events(id)).at(-1)?.type).toBe("expense_restored");
  });
});

describe("currency lock (D1)", () => {
  it("allows changing the currency only while the household has no expenses", async () => {
    const fresh = await household(xena, "Currency home");
    const before = await xena.client
      .from("households")
      .update({ currency_code: "EUR" })
      .eq("id", fresh)
      .select("currency_code");
    expect(before.data).toEqual([{ currency_code: "EUR" }]);

    await createExpense(xena, {
      household: fresh,
      payer: xena.id,
      shares: [{ user_id: xena.id, share_minor: 9000 }],
    });
    const after = await xena.client
      .from("households")
      .update({ currency_code: "INR" })
      .eq("id", fresh);
    expectError(after.error, CURRENCY_LOCKED);

    // Other owner updates still work.
    const rename = await xena.client
      .from("households")
      .update({ name: `Renamed ${runId}` })
      .eq("id", fresh)
      .select("name");
    expect(rename.error).toBeNull();
  });
});

describe("zero balance to leave or be removed (D13, O8)", () => {
  it("blocks leaving and removal while a balance is owed, and allows both at zero", async () => {
    const home = await household(olive, "Balance home");
    const extra = await createUser("Rae");
    await join(olive, home, pat, extra);

    // Olive pays ₹90 for olive, pat and rae: pat and rae each owe ₹30.
    const id = await createExpense(olive, {
      household: home,
      shares: [
        { user_id: olive.id, share_minor: 3000 },
        { user_id: pat.id, share_minor: 3000 },
        { user_id: extra.id, share_minor: 3000 },
      ],
    });

    const leave = await pat.client.rpc("leave_household", {
      target_household_id: home,
    });
    expectError(leave.error, BALANCE_NOT_ZERO);
    const remove = await olive.client.rpc("remove_member", {
      target_household_id: home,
      member_user_id: extra.id,
    });
    expectError(remove.error, BALANCE_NOT_ZERO);

    // Deleted expenses stop counting (D7), so balances are zero again.
    await olive.client.rpc("delete_expense", { target_expense_id: id });
    expect(
      (await pat.client.rpc("leave_household", { target_household_id: home }))
        .error,
    ).toBeNull();
    expect(
      (
        await olive.client.rpc("remove_member", {
          target_household_id: home,
          member_user_id: extra.id,
        })
      ).error,
    ).toBeNull();

    // Restoring would change a former member's balance, so it's refused.
    const restore = await olive.client.rpc("restore_expense", {
      target_expense_id: id,
    });
    expectError(restore.error, NOT_ACTIVE_MEMBER);

    await admin.from("households").delete().eq("id", home);
    await admin.from("profiles").delete().eq("id", extra.id);
    await admin.auth.admin.deleteUser(extra.id);
  });
});
