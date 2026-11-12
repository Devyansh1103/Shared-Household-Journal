// Expense history (roadmap Phase 12) as real signed-in users against the local
// stack: search, every filter, every sort, pages, the summary against an
// independent tally, household isolation and refused input, and that reading
// history never changes money (balances, splits, settlements).
// Needs `npm run db:start`, then `npm run test:db`. Everything is created for
// this run and removed afterwards.
//
// Requests go through the app's own pipeline (parseHistoryQuery →
// expenseHistoryArgs → expense_history → parseHistoryPayload → checkHistory),
// so the URL rules and the database are tested together.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeSplit } from "@/domain/money/split";
import { parseBalancesPayload } from "@/lib/balances/parse";
import { sharesJson } from "@/lib/expenses/form";
import {
  expenseHistoryArgs,
  HISTORY_PAGE_SIZE,
  parseHistoryQuery,
  type RawHistoryQuery,
} from "@/lib/expenses/history";
import {
  averageOf,
  checkHistory,
  parseHistoryPayload,
} from "@/lib/expenses/history-payload";
import type { Database } from "@/lib/supabase/database.types";
import {
  adminClient,
  anonClient,
  signedInClient,
  type TypedClient,
} from "./support/local-supabase";

type Category = Database["public"]["Enums"]["expense_category"];

const PERMISSION_DENIED = "42501";
const INVALID_PARAMETER = "22023";
const INVALID_TEXT = "22P02";
const NO_SUCH_EXPENSE = "HJ009";

const runId = randomUUID().slice(0, 8);
const password = `hist-${randomUUID()}`;
const admin = adminClient();

type User = { id: string; client: TypedClient };
const users: User[] = [];
let olive: User, pat: User, quin: User, xena: User;
let H: string, X: string, P: string;
/** H's expenses by a short name. */
const ids: Record<string, string> = {};

function expectError(error: PostgrestError | null, code: string) {
  expect(error, `expected Postgres error ${code}`).not.toBeNull();
  expect(error?.code).toBe(code);
}

async function createUser(name: string): Promise<User> {
  const email = `hist-${runId}-${name.toLowerCase()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  const user = {
    id: data.user.id,
    client: await signedInClient(email, password),
  };
  users.push(user);
  return user;
}

async function household(owner: User, name: string, currency = "INR") {
  const { data, error } = await owner.client.rpc("create_household", {
    household_name: `${name} ${runId}`,
    currency,
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

async function addExpense(
  creator: User,
  householdId: string,
  args: {
    title: string;
    amount: number;
    category: Category;
    date: string;
    payer: User;
    sharers: User[];
  },
): Promise<string> {
  const split = computeSplit({
    method: "equal",
    total: BigInt(args.amount),
    participants: args.sharers.map((u) => u.id),
  });
  if (!split.ok) throw new Error(split.error);
  const { data, error } = await creator.client.rpc("create_expense", {
    target_household_id: householdId,
    title: args.title,
    amount: args.amount,
    expense_category: args.category,
    spent_on: args.date,
    payer_id: args.payer.id,
    method: "equal",
    shares: sharesJson(split.shares),
  });
  if (error) throw error;
  return data;
}

const EMPTY: RawHistoryQuery = {
  q: "",
  range: "",
  from: "",
  to: "",
  category: [],
  payer: [],
  min: "",
  max: "",
  status: "",
  sort: "",
  page: "",
};

/** One page of history, through the app's pipeline, checked. */
async function history(
  user: User,
  householdId: string,
  query: Partial<RawHistoryQuery> = {},
  { today = "2026-11-12", exponent = 2 } = {},
) {
  const parsed = parseHistoryQuery(
    { ...EMPTY, ...query },
    { today, exponent, payerIds: users.map((u) => u.id) },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const { data, error } = await user.client.rpc(
    "expense_history",
    expenseHistoryArgs(householdId, parsed.filters),
  );
  if (error) throw error;
  const page = parseHistoryPayload(data);
  if (!page) throw new Error("expense_history returned an unexpected shape");
  expect(
    checkHistory(page, {
      householdId,
      filters: parsed.filters,
      pageSize: HISTORY_PAGE_SIZE,
    }),
  ).toEqual({ ok: true });
  return page;
}

/** The names (see `ids`) of the rows on a page, in order. */
async function names(
  query: Partial<RawHistoryQuery> = {},
  options?: { today?: string },
) {
  const page = await history(pat, H, query, options);
  const byId = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  return page.rows.map((r) => byId[r.id] ?? r.description);
}

/** The household's rows read past RLS, in an order Postgres gives directly. */
async function referenceOrder(
  householdId: string,
  order: [keyof Database["public"]["Tables"]["expenses"]["Row"], boolean][],
) {
  let query = admin
    .from("expenses")
    .select("id, amount_minor, deleted_at")
    .eq("household_id", householdId);
  for (const [column, ascending] of order) {
    query = query.order(column, { ascending });
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  [olive, pat, quin, xena] = await Promise.all(
    ["Olive", "Pat", "Quin", "Xena"].map(createUser),
  );
  H = await household(olive, "History home");
  X = await household(xena, "Other home");
  P = await household(olive, "Paging home");
  await join(olive, H, pat, quin);

  const everyone = [olive, pat, quin];
  // Created in this order, so "recently added" is this list reversed.
  const seed: [string, Parameters<typeof addExpense>[2]][] = [
    [
      "electricity",
      {
        title: "Electricity bill",
        amount: 240000,
        category: "utilities",
        date: "2026-11-03",
        payer: olive,
        sharers: everyone,
      },
    ],
    [
      "groceries",
      {
        title: "Groceries: milk and bread",
        amount: 85050,
        category: "groceries",
        date: "2026-11-10",
        payer: pat,
        sharers: everyone,
      },
    ],
    [
      "rent",
      {
        title: "Rent November",
        amount: 3000000,
        category: "rent",
        date: "2026-11-01",
        payer: olive,
        sharers: everyone,
      },
    ],
    [
      "internet",
      {
        title: "Internet",
        amount: 99900,
        category: "internet",
        date: "2026-10-15",
        payer: quin,
        sharers: everyone,
      },
    ],
    [
      "dinner",
      {
        title: "Dinner out",
        amount: 240000,
        category: "dining",
        date: "2026-10-31",
        payer: pat,
        sharers: [pat, quin],
      },
    ],
    [
      "taxi",
      {
        title: "Taxi to airport",
        amount: 65000,
        category: "transport",
        date: "2026-11-10",
        payer: olive,
        sharers: [olive],
      },
    ],
    [
      "oldRent",
      {
        title: "Old rent",
        amount: 3000000,
        category: "rent",
        date: "2026-09-01",
        payer: olive,
        sharers: everyone,
      },
    ],
    [
      "deposit",
      {
        title: "ELECTRICITY deposit",
        amount: 120000,
        category: "utilities",
        date: "2026-08-20",
        payer: quin,
        sharers: everyone,
      },
    ],
    [
      "snacks",
      {
        title: "Snacks_50% off",
        amount: 12000,
        category: "other",
        date: "2026-11-11",
        payer: pat,
        sharers: [pat],
      },
    ],
  ];
  for (const [name, args] of seed)
    ids[name] = await addExpense(args.payer, H, args);
  const deleted = await olive.client.rpc("delete_expense", {
    target_expense_id: ids.oldRent,
  });
  if (deleted.error) throw deleted.error;

  // Another household with a look-alike expense, to prove isolation.
  await addExpense(xena, X, {
    title: "Electricity bill",
    amount: 240000,
    category: "utilities",
    date: "2026-11-03",
    payer: xena,
    sharers: [xena],
  });

  // 60 expenses with many equal dates and amounts, to page through.
  for (let i = 0; i < 60; i++) {
    await addExpense(olive, P, {
      title: `Item ${i}`,
      amount: [100, 200, 300][i % 3],
      category: "other",
      date: ["2026-11-01", "2026-11-02"][i % 2],
      payer: olive,
      sharers: [olive],
    });
  }
}, 120_000);

afterAll(async () => {
  const userIds = users.map((u) => u.id);
  if (userIds.length) {
    await admin.from("households").delete().in("created_by", userIds);
    await admin.from("profiles").delete().in("id", userIds);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  }
});

describe("search", () => {
  it("finds descriptions anywhere, ignoring case", async () => {
    expect(await names({ q: "electricity" })).toEqual([
      "electricity",
      "deposit",
    ]);
    expect(await names({ q: "MILK" })).toEqual(["groceries"]);
    expect(await names({ q: "Rent Nov" })).toEqual(["rent"]);
  });

  it("ignores spaces at the ends and runs of spaces inside", async () => {
    expect(await names({ q: "   Taxi    to  " })).toEqual(["taxi"]);
  });

  it("finds category names from the start of a word", async () => {
    // "Taxi to airport" doesn't say "transport"; its category does.
    expect(await names({ q: "transport" })).toEqual(["taxi"]);
    expect(await names({ q: "dini" })).toEqual(["dinner"]);
  });

  it("treats % and _ as plain characters, never as wildcards", async () => {
    expect(await names({ q: "%" })).toEqual(["snacks"]);
    expect(await names({ q: "_" })).toEqual(["snacks"]);
    expect(await names({ q: "50% off" })).toEqual(["snacks"]);
  });

  it("shows everything for an empty search, and nothing for no match", async () => {
    const all = await history(pat, H, { q: "  " });
    expect(all.totalCount).toBe(8);
    const none = await history(pat, H, { q: "zzz" });
    expect(none).toMatchObject({
      totalCount: 0,
      totalMinor: BigInt(0),
      averageMinor: null,
      largest: null,
      page: 1,
      pageCount: 1,
      rows: [],
    });
  });

  it("never finds another household's expenses", async () => {
    const mine = await history(pat, H, { q: "electricity bill" });
    expect(mine.rows.map((r) => r.id)).toEqual([ids.electricity]);
    const theirs = await history(xena, X, { q: "electricity" });
    expect(theirs.rows).toHaveLength(1);
    expect(theirs.rows[0].householdId).toBe(X);
  });
});

describe("filters", () => {
  it("today, this week, this month and the previous month", async () => {
    expect(await names({ range: "today" }, { today: "2026-11-10" })).toEqual([
      "taxi",
      "groceries",
    ]);
    // Thursday 12 November: the week of Monday 9 to Sunday 15 (D25).
    expect(await names({ range: "week" })).toEqual([
      "snacks",
      "taxi",
      "groceries",
    ]);
    expect(await names({ range: "month" })).toEqual([
      "snacks",
      "taxi",
      "groceries",
      "electricity",
      "rent",
    ]);
    expect(await names({ range: "last-month" })).toEqual([
      "dinner",
      "internet",
    ]);
  });

  it("custom dates, with both ends included", async () => {
    expect(
      await names({ range: "custom", from: "2026-10-31", to: "2026-11-01" }),
    ).toEqual(["rent", "dinner"]);
    expect(await names({ from: "2026-11-10" })).toEqual([
      "snacks",
      "taxi",
      "groceries",
    ]);
    expect(await names({ to: "2026-10-15" })).toEqual(["internet", "deposit"]);
  });

  it("categories, payers and amounts, each and together", async () => {
    expect(await names({ category: ["rent", "internet"] })).toEqual([
      "rent",
      "internet",
    ]);
    expect(await names({ payer: [quin.id] })).toEqual(["internet", "deposit"]);
    // Exact minor units, both ends counted: ₹2,400.00 itself is included.
    expect(await names({ min: "2400" })).toEqual([
      "electricity",
      "rent",
      "dinner",
    ]);
    expect(await names({ max: "850.50" })).toEqual([
      "snacks",
      "taxi",
      "groceries",
    ]);
    expect(await names({ min: "650", max: "650.00" })).toEqual(["taxi"]);
    expect(
      await names({ range: "month", payer: [olive.id], min: "1000" }),
    ).toEqual(["electricity", "rent"]);
  });

  it("shows deleted expenses only when asked (D7)", async () => {
    expect(await names({ status: "deleted" })).toEqual(["oldRent"]);
    expect(await names({ q: "old" })).toEqual([]);
    expect(await names({ q: "old", status: "deleted" })).toEqual(["oldRent"]);
  });

  it("refuses an empty range, whether from the app or straight to the database", async () => {
    const parsed = parseHistoryQuery(
      {
        ...EMPTY,
        range: "custom",
        from: "2026-11-10",
        to: "2026-11-01",
        min: "5",
        max: "1",
      },
      { today: "2026-11-12", exponent: 2, payerIds: [] },
    );
    expect(parsed.ok).toBe(false);
    for (const args of [
      { date_from: "2026-11-10", date_to: "2026-11-01" },
      { amount_min: 500, amount_max: 100 },
    ]) {
      const { error } = await pat.client.rpc("expense_history", {
        target_household_id: H,
        ...args,
      });
      expectError(error, INVALID_PARAMETER);
    }
  });

  it("reads amounts in the household's own currency (D1, D2)", async () => {
    const yen = await household(xena, "Yen home", "JPY");
    await addExpense(xena, yen, {
      title: "Tea",
      amount: 1500,
      category: "dining",
      date: "2026-11-05",
      payer: xena,
      sharers: [xena],
    });
    // ¥1,500 is 1500 minor units; decimals aren't allowed in yen.
    const page = await history(xena, yen, { min: "1500" }, { exponent: 0 });
    expect(page.rows.map((r) => r.amountMinor)).toEqual([BigInt(1500)]);
    expect(
      parseHistoryQuery(
        { ...EMPTY, min: "1500.5" },
        { today: "2026-11-12", exponent: 0, payerIds: [] },
      ).ok,
    ).toBe(false);
  });
});

describe("sorting", () => {
  it("matches the documented order for every sort, ties included", async () => {
    for (const sort of ["newest", "oldest", "highest", "lowest", "recent"]) {
      const expected = (await referenceOrder(H, orders(sort)))
        .filter((r) => r.deleted_at === null)
        .map((r) => r.id);
      const page = await history(pat, H, { sort });
      expect(
        page.rows.map((r) => r.id),
        sort,
      ).toEqual(expected);
    }
  });

  it("breaks ties the same way every time", async () => {
    // Same date (10 Nov): taxi was added after groceries, so it's newer.
    expect(
      await names({ range: "custom", from: "2026-11-10", to: "2026-11-10" }),
    ).toEqual(["taxi", "groceries"]);
    // Same amount (₹2,400): electricity's date is later, so it comes first.
    expect(await names({ min: "2400", max: "2400", sort: "highest" })).toEqual([
      "electricity",
      "dinner",
    ]);
    expect(await names({ min: "2400", max: "2400", sort: "lowest" })).toEqual([
      "electricity",
      "dinner",
    ]);
    for (let i = 0; i < 3; i++) {
      expect(await names({ sort: "highest" })).toEqual(
        await names({ sort: "highest" }),
      );
    }
  });

  it("sorts within the filters", async () => {
    expect(await names({ range: "month", sort: "highest" })).toEqual([
      "rent",
      "electricity",
      "groceries",
      "taxi",
      "snacks",
    ]);
    expect(await names({ range: "month", sort: "oldest" })).toEqual([
      "rent",
      "electricity",
      "groceries",
      "taxi",
      "snacks",
    ]);
  });
});

describe("pages", () => {
  it("cover every expense exactly once, in one order, with many ties", async () => {
    for (const sort of ["newest", "oldest", "highest", "lowest", "recent"]) {
      const pages = await Promise.all(
        ["1", "2", "3"].map((page) => history(olive, P, { sort, page })),
      );
      expect(
        pages.map((p) => p.rows.length),
        sort,
      ).toEqual([25, 25, 10]);
      expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
      const seen = pages.flatMap((p) => p.rows.map((r) => r.id));
      expect(new Set(seen).size, sort).toBe(60);
      const expected = (await referenceOrder(P, orders(sort))).map((r) => r.id);
      expect(seen, sort).toEqual(expected);
    }
  });

  it("answers a page past the end with the last page", async () => {
    const last = await history(olive, P, { page: "9" });
    expect(last).toMatchObject({ page: 3, pageCount: 3 });
    expect(last.rows).toHaveLength(10);
  });

  it("fits a page that a new filter or search no longer has", async () => {
    // On page 3, then a filter leaves 20 expenses: the last page is 1.
    const filtered = await history(olive, P, { page: "3", min: "3", max: "3" });
    expect(filtered).toMatchObject({ page: 1, pageCount: 1, totalCount: 20 });
    const searched = await history(olive, P, { page: "3", q: "Item 1" });
    // "Item 1", "Item 10" … "Item 19".
    expect(searched).toMatchObject({ page: 1, totalCount: 11 });
  });

  it("is one empty page when nothing matches", async () => {
    expect(await history(olive, P, { q: "nothing", page: "2" })).toMatchObject({
      page: 1,
      pageCount: 1,
      totalCount: 0,
      rows: [],
    });
  });
});

/**
 * Each sort as plain Postgres ordering of the table, column by column: a
 * reference independent of the function's own query.
 */
function orders(sort: string) {
  const map: Record<
    string,
    [keyof Database["public"]["Tables"]["expenses"]["Row"], boolean][]
  > = {
    newest: [
      ["expense_date", false],
      ["created_at", false],
      ["id", false],
    ],
    oldest: [
      ["expense_date", true],
      ["created_at", true],
      ["id", true],
    ],
    highest: [
      ["amount_minor", false],
      ["expense_date", false],
      ["created_at", false],
      ["id", false],
    ],
    lowest: [
      ["amount_minor", true],
      ["expense_date", false],
      ["created_at", false],
      ["id", false],
    ],
    recent: [
      ["created_at", false],
      ["expense_date", false],
      ["id", false],
    ],
  };
  return map[sort];
}

describe("the summary", () => {
  it("adds up exactly what matches, independently tallied", async () => {
    const { data, error } = await admin
      .from("expenses")
      .select("id, amount_minor, deleted_at, expense_date, paid_by")
      .eq("household_id", H);
    if (error) throw error;
    const counted = data.filter((e) => e.deleted_at === null);

    type Expense = NonNullable<typeof data>[number];
    const cases: [Partial<RawHistoryQuery>, (e: Expense) => boolean][] = [
      [{}, () => true],
      [
        { range: "month" },
        (e) => e.expense_date >= "2026-11-01" && e.expense_date <= "2026-11-30",
      ],
      [
        { payer: [olive.id, pat.id] },
        (e) => [olive.id, pat.id].includes(e.paid_by),
      ],
      [{ min: "700" }, (e) => e.amount_minor >= 70000],
    ];
    for (const [query, keep] of cases) {
      const matching = counted.filter(keep);
      const total = matching.reduce(
        (s, e) => s + BigInt(e.amount_minor),
        BigInt(0),
      );
      const page = await history(pat, H, query);
      expect(page.totalCount, JSON.stringify(query)).toBe(matching.length);
      expect(page.totalMinor).toBe(total);
      expect(page.averageMinor).toBe(averageOf(total, matching.length));
      expect(page.largest?.amountMinor).toBe(
        matching.reduce(
          (m, e) => (BigInt(e.amount_minor) > m ? BigInt(e.amount_minor) : m),
          BigInt(0),
        ),
      );
      // The household's own figures, whatever the filters.
      expect(page.householdCount).toBe(counted.length);
      expect(page.householdTotalMinor).toBe(
        counted.reduce((s, e) => s + BigInt(e.amount_minor), BigInt(0)),
      );
      expect(page.householdDeletedCount).toBe(1);
    }
  });

  it("agrees with the balances' total spent", async () => {
    const { data, error } = await pat.client.rpc("household_balances", {
      target_household_id: H,
    });
    if (error) throw error;
    const balances = parseBalancesPayload(data)!;
    const page = await history(pat, H);
    expect(page.householdTotalMinor).toBe(balances.totalMinor);
    expect(page.householdCount).toBe(balances.expenseCount);
  });
});

describe("access", () => {
  it("is refused for non-members, forged household ids and anonymous callers", async () => {
    expectError(
      (await xena.client.rpc("expense_history", { target_household_id: H }))
        .error,
      PERMISSION_DENIED,
    );
    expectError(
      (await pat.client.rpc("expense_history", { target_household_id: X }))
        .error,
      PERMISSION_DENIED,
    );
    const anon = await anonClient().rpc("expense_history", {
      target_household_id: H,
    });
    expect(anon.error).not.toBeNull();
    expect(anon.data).toBeNull();
  });

  it("can't reach another household by filtering on its people", async () => {
    // Xena's id as a payer in H: nothing, not Xena's expenses.
    const { data, error } = await pat.client.rpc("expense_history", {
      target_household_id: H,
      payers: [xena.id],
    });
    expect(error).toBeNull();
    expect(parseHistoryPayload(data)?.rows).toEqual([]);
  });

  it("refuses input that can't be right", async () => {
    const bad: [Record<string, unknown>, string][] = [
      [{ sort_order: "random" }, INVALID_PARAMETER],
      [{ page_size: 500 }, INVALID_PARAMETER],
      [{ page_number: 0 }, INVALID_PARAMETER],
      [{ search_text: "x".repeat(121) }, INVALID_PARAMETER],
      [{ categories: ["fun"] }, INVALID_TEXT],
      [{ payers: ["not-a-uuid"] }, INVALID_TEXT],
    ];
    for (const [args, code] of bad) {
      const { error } = await pat.client.rpc("expense_history", {
        target_household_id: H,
        ...args,
      } as never);
      expectError(error, code);
    }
  });

  it("keeps an expense's page and its changes to members with the rights (D6)", async () => {
    const outsider = await xena.client
      .from("expenses")
      .select("id")
      .eq("id", ids.rent);
    expect(outsider.data).toEqual([]);
    expectError(
      (await xena.client.rpc("delete_expense", { target_expense_id: ids.rent }))
        .error,
      NO_SUCH_EXPENSE,
    );
    // Pat didn't create or pay for the rent, and isn't the owner.
    expectError(
      (await pat.client.rpc("delete_expense", { target_expense_id: ids.rent }))
        .error,
      PERMISSION_DENIED,
    );
  });
});

describe("money stays as it was", () => {
  it("reading history changes no expense, split, balance or settlement", async () => {
    const snapshot = async () => {
      const [expenses, splits, settlements, balances] = await Promise.all([
        admin.from("expenses").select("*").eq("household_id", H).order("id"),
        admin
          .from("expense_splits")
          .select("*")
          .eq("household_id", H)
          .order("expense_id")
          .order("user_id"),
        admin.from("settlements").select("*").eq("household_id", H).order("id"),
        pat.client.rpc("household_balances", { target_household_id: H }),
      ]);
      return {
        expenses: expenses.data,
        splits: splits.data,
        settlements: settlements.data,
        balances: balances.data,
      };
    };
    // A settlement too, so its effect can be seen to stay.
    const recorded = await quin.client.rpc("record_settlement", {
      target_household_id: H,
      payer_id: quin.id,
      recipient_id: olive.id,
      amount: 1000,
      paid_on: "2026-11-12",
    });
    expect(recorded.error).toBeNull();

    const before = await snapshot();
    for (const sort of ["newest", "highest", "lowest"]) {
      await history(pat, H, { sort, q: "e", page: "2" });
      await history(olive, H, { status: "deleted", sort });
    }
    expect(await snapshot()).toEqual(before);
  });

  it("follows a deletion: the totals and the balances drop by the same amount", async () => {
    const [historyBefore, balancesBefore] = await Promise.all([
      history(pat, H),
      pat.client.rpc("household_balances", { target_household_id: H }),
    ]);
    const deleted = await pat.client.rpc("delete_expense", {
      target_expense_id: ids.snacks,
    });
    expect(deleted.error).toBeNull();
    const [historyAfter, balancesAfter] = await Promise.all([
      history(pat, H),
      pat.client.rpc("household_balances", { target_household_id: H }),
    ]);
    const amount = BigInt(12000);
    expect(historyAfter.totalMinor).toBe(historyBefore.totalMinor - amount);
    expect(historyAfter.householdDeletedCount).toBe(2);
    const spent = (data: unknown) => parseBalancesPayload(data)!.totalMinor;
    expect(spent(balancesAfter.data)).toBe(spent(balancesBefore.data) - amount);
    // Settlements are separate records and still count (D8).
    expect(parseBalancesPayload(balancesAfter.data)!.settlementCount).toBe(1);
    expect(await names({ status: "deleted" })).toEqual(["snacks", "oldRent"]);
  });
});
