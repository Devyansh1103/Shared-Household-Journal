// Budgets and household analytics (roadmap Phase 16; O3 and D29 decided
// 2026-11-13) as real signed-in users against the local stack: the period
// rules (compared with src/lib/budgets/period.ts), adding, changing and
// removing budgets (any active member), one active budget per category and
// period, limits that past periods keep, what counts as spending (deleted
// expenses, settlements, bills not yet recorded, recorded bills once, the
// expense date and month edges), the analytics figures (categories, the
// trend, paid against share, filters, the comparison, the largest), other
// households and people who leave, the journal and deleting the household.
// Every answer is parsed and checked with the app's own code.
//
// Needs `npm run db:start`, then `npm run test:db`. Everything is created for
// this run and removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeSplit } from "@/domain/money/split";
import {
  checkAnalytics,
  parseAnalytics,
  type Analytics,
} from "@/lib/analytics/payload";
import { averageMinor } from "@/lib/analytics/figures";
import { addDays, addMonths } from "@/lib/bills/schedule";
import {
  checkHouseholdBudgets,
  parseHouseholdBudgets,
  type HouseholdBudgets,
} from "@/lib/budgets/payload";
import {
  periodEnd,
  periodStart,
  type BudgetPeriod,
} from "@/lib/budgets/period";
import type { ExpenseCategory } from "@/lib/expenses/categories";
import { todayIn } from "@/lib/expenses/dates";
import { sharesJson } from "@/lib/expenses/form";
import { checkJournal, parseJournalPayload } from "@/lib/journal/payload";
import {
  adminClient,
  anonClient,
  psqlAsSuperuser,
  signedInClient,
  type TypedClient,
} from "./support/local-supabase";

const PERMISSION_DENIED = "42501";
const CHECK_VIOLATION = "23514";
const INVALID = "22023";
const REMOVED = "HJ028";
const CHANGED = "HJ029";
const NO_SUCH_BUDGET = "HJ031";
const DUPLICATE = "HJ032";

const runId = randomUUID().slice(0, 8);
const password = `budget-${randomUUID()}`;
const admin = adminClient();
const TZ = "Asia/Kolkata";

type User = { id: string; name: string; client: TypedClient };
const users: User[] = [];
let olive: User, pat: User, quin: User, xena: User;
let H: string, X: string;
let today: string;
let monthStart: string;
let lastMonthStart: string;

function expectError(error: PostgrestError | null, code: string) {
  expect(error, `expected Postgres error ${code}`).not.toBeNull();
  expect(error?.code).toBe(code);
}

async function createUser(name: string): Promise<User> {
  const email = `budget-${runId}-${name.toLowerCase()}@example.com`;
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

async function household(owner: User, name: string, timeZone = TZ) {
  const { data, error } = await owner.client.rpc("create_household", {
    household_name: `${name} ${runId}`,
    currency: "INR",
    time_zone: timeZone,
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
  user: User,
  householdId: string,
  input: {
    amount: number;
    category?: ExpenseCategory;
    date: string;
    payer?: User;
    people?: User[];
    title?: string;
  },
) {
  const split = computeSplit({
    method: "equal",
    total: BigInt(input.amount),
    participants: (input.people ?? [olive, pat]).map((p) => p.id),
  });
  if (!split.ok) throw new Error(split.error);
  const { data, error } = await user.client.rpc("create_expense", {
    target_household_id: householdId,
    title: input.title ?? "Shared cost",
    amount: input.amount,
    expense_category: input.category ?? "groceries",
    spent_on: input.date,
    payer_id: (input.payer ?? olive).id,
    method: "equal",
    shares: sharesJson(split.shares),
  });
  if (error) throw error;
  return data;
}

async function addBudget(
  user: User,
  householdId: string,
  input: {
    period?: BudgetPeriod;
    limit?: number;
    category?: ExpenseCategory;
    key?: string;
  } = {},
) {
  const { data, error } = await user.client.rpc("create_budget", {
    target_household_id: householdId,
    budget_kind: input.period ?? "month",
    budget_limit: input.limit ?? 1000000,
    ...(input.category ? { budget_category: input.category } : {}),
    ...(input.key ? { request_key: input.key } : {}),
  });
  if (error) throw error;
  return data;
}

/** The budgets page's data, parsed and checked as the app does. */
async function budgetsOf(
  user: User,
  householdId: string,
  period: BudgetPeriod = "month",
  onDate: string | null = null,
): Promise<HouseholdBudgets> {
  const { data, error } = await user.client.rpc("household_budgets", {
    target_household_id: householdId,
    budget_kind: period,
    ...(onDate ? { on_date: onDate } : {}),
  });
  if (error) throw error;
  const parsed = parseHouseholdBudgets(data);
  if (!parsed)
    throw new Error("household_budgets returned an unexpected shape");
  const check = checkHouseholdBudgets(parsed, { householdId, period, onDate });
  if (!check.ok) throw new Error(`household_budgets failed ${check.code}`);
  return parsed;
}

type Asked = Parameters<typeof checkAnalytics>[1];

/** The analytics page's data, parsed and checked as the app does. */
async function analyticsOf(
  user: User,
  householdId: string,
  asked: Partial<Asked> & { from: string; to: string },
): Promise<Analytics> {
  const full: Asked = {
    compareFrom: null,
    compareTo: null,
    category: null,
    payer: null,
    ...asked,
  };
  const { data, error } = await user.client.rpc("household_analytics", {
    target_household_id: householdId,
    date_from: full.from,
    date_to: full.to,
    ...(full.category ? { category_filter: full.category } : {}),
    ...(full.payer ? { payer_filter: full.payer } : {}),
    ...(full.compareFrom && full.compareTo
      ? { compare_from: full.compareFrom, compare_to: full.compareTo }
      : {}),
  });
  if (error) throw error;
  const parsed = parseAnalytics(data);
  if (!parsed)
    throw new Error("household_analytics returned an unexpected shape");
  const check = checkAnalytics(parsed, full);
  if (!check.ok) throw new Error(`household_analytics failed ${check.code}`);
  return parsed;
}

async function eventsFor(entityId: string) {
  const { data, error } = await admin
    .from("activity_events")
    .select("type, actor_id, summary")
    .eq("entity_id", entityId)
    .order("created_at")
    .order("id");
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  [olive, pat, quin, xena] = await Promise.all(
    ["Olive", "Pat", "Quin", "Xena"].map(createUser),
  );
  H = await household(olive, "Budget home");
  X = await household(xena, "Other home");
  await join(olive, H, pat, quin);
  today = todayIn(TZ);
  monthStart = periodStart(today, "month");
  lastMonthStart = addMonths(monthStart, -1);
}, 60_000);

afterAll(async () => {
  const ids = users.map((u) => u.id);
  if (ids.length) {
    // Households cascade to budgets, limits, expenses and the journal (D14).
    await admin.from("households").delete().in("created_by", ids);
    await admin.from("profiles").delete().in("id", ids);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  }
});

describe("periods", () => {
  it("agree with src/lib/budgets/period.ts for every day over two years", () => {
    const result = psqlAsSuperuser(`
\\pset tuples_only on
\\pset format unaligned
select d::date || '|' || k || '|' || private.budget_period_start(d::date, k::public.budget_period)
  || '|' || private.budget_period_end(private.budget_period_start(d::date, k::public.budget_period), k::public.budget_period)
from generate_series('2027-12-20'::date, '2029-01-10'::date, interval '1 day') d,
  unnest(array['week', 'month', 'quarter']) k;
`);
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(1000);
    const wrong = lines.filter((line) => {
      const [day, kind, start, end] = line.split("|");
      const p = kind as BudgetPeriod;
      return periodStart(day, p) !== start || periodEnd(start, p) !== end;
    });
    expect(wrong).toEqual([]);
  });
});

describe("adding, changing and removing budgets", () => {
  it("lets any active member add one, from the current period, and journals it", async () => {
    const H2 = await household(olive, "Add");
    await join(olive, H2, pat);
    const id = await addBudget(pat, H2, {
      category: "groceries",
      limit: 800000,
    });
    const { data } = await admin
      .from("budgets")
      .select("*")
      .eq("id", id)
      .single();
    expect(data).toMatchObject({
      household_id: H2,
      category: "groceries",
      period: "month",
      starts_on: monthStart,
      created_by: pat.id,
      archived_at: null,
    });
    expect(await eventsFor(id)).toEqual([
      {
        type: "budget_created",
        actor_id: pat.id,
        summary: {
          category: "groceries",
          period: "month",
          limit_minor: 800000,
          starts_on: monthStart,
        },
      },
    ]);
  });

  it("adds once for a repeated submission, and one active budget per category and period", async () => {
    const H2 = await household(olive, "Unique");
    await join(olive, H2, pat);
    const key = randomUUID();
    const first = await addBudget(olive, H2, { key });
    expect(await addBudget(olive, H2, { key })).toBe(first);
    const concurrent = randomUUID();
    const ids = await Promise.all(
      Array.from({ length: 3 }, () =>
        addBudget(pat, H2, { category: "rent", key: concurrent }),
      ),
    );
    expect(new Set(ids).size).toBe(1);
    // Everything, monthly, again (someone else, a new key): refused.
    const again = await pat.client.rpc("create_budget", {
      target_household_id: H2,
      budget_kind: "month",
      budget_limit: 5,
    });
    expectError(again.error, DUPLICATE);
    // The same category for another period, or another category: fine.
    await addBudget(pat, H2, { category: "rent", period: "week" });
    await addBudget(pat, H2, { category: "dining" });
    await addBudget(pat, H2, { period: "quarter" });
    const { count } = await admin
      .from("budgets")
      .select("id", { count: "exact", head: true })
      .eq("household_id", H2);
    expect(count).toBe(5);
  });

  it("refuses limits that aren't positive or are too large, and non-members", async () => {
    for (const limit of [0, -100, 1_000_000_000_000]) {
      const { error } = await olive.client.rpc("create_budget", {
        target_household_id: H,
        budget_kind: "week",
        budget_limit: limit,
        budget_category: "transport",
      });
      expectError(error, CHECK_VIOLATION);
    }
    const { count } = await admin
      .from("budgets")
      .select("id", { count: "exact", head: true })
      .eq("household_id", H)
      .eq("category", "transport");
    expect(count).toBe(0);
    for (const client of [xena.client, anonClient()]) {
      const { error } = await client.rpc("create_budget", {
        target_household_id: H,
        budget_kind: "month",
        budget_limit: 100,
      });
      expectError(error, PERMISSION_DENIED);
    }
  });

  it("changes a limit from the current period on; past periods keep theirs", async () => {
    const H2 = await household(olive, "Limits");
    await join(olive, H2, pat);
    const id = await addBudget(olive, H2, {
      category: "groceries",
      limit: 500000,
    });
    // As if it had been added last month (a fixture, through the service role).
    await admin.from("budget_limits").delete().eq("budget_id", id);
    await admin
      .from("budgets")
      .update({ starts_on: lastMonthStart })
      .eq("id", id);
    await admin.from("budget_limits").insert({
      budget_id: id,
      household_id: H2,
      starts_on: lastMonthStart,
      limit_minor: 500000,
      set_by: olive.id,
    });
    const before = (await budgetsOf(pat, H2)).budgets[0];
    const changed = await pat.client.rpc("update_budget", {
      target_budget_id: id,
      budget_limit: 650000,
      expected_updated_at: before.updatedAt,
    });
    expect(changed.error).toBeNull();
    expect((await budgetsOf(pat, H2)).budgets[0].limitMinor).toBe(
      BigInt(650000),
    );
    expect(
      (await budgetsOf(pat, H2, "month", lastMonthStart)).budgets[0].limitMinor,
    ).toBe(BigInt(500000));
    expect((await eventsFor(id)).at(-1)).toMatchObject({
      type: "budget_updated",
      actor_id: pat.id,
      summary: {
        before_limit_minor: 500000,
        after_limit_minor: 650000,
        from_on: monthStart,
      },
    });
    // The same limit again: nothing, no event. A stale page: refused.
    const now = (await budgetsOf(pat, H2)).budgets[0];
    await olive.client.rpc("update_budget", {
      target_budget_id: id,
      budget_limit: 650000,
    });
    expect(await eventsFor(id)).toHaveLength(2);
    const stale = await olive.client.rpc("update_budget", {
      target_budget_id: id,
      budget_limit: 700000,
      expected_updated_at: before.updatedAt,
    });
    expectError(stale.error, CHANGED);
    // Two changes in one period: the latest wins; still one row for it.
    await olive.client.rpc("update_budget", {
      target_budget_id: id,
      budget_limit: 700000,
      expected_updated_at: now.updatedAt,
    });
    const { data: rows } = await admin
      .from("budget_limits")
      .select("starts_on, limit_minor")
      .eq("budget_id", id)
      .order("starts_on");
    expect(rows).toEqual([
      { starts_on: lastMonthStart, limit_minor: 500000 },
      { starts_on: monthStart, limit_minor: 700000 },
    ]);
  });

  it("removes a budget: gone from this period on, kept for ended ones, once", async () => {
    const H2 = await household(olive, "Remove");
    await join(olive, H2, pat);
    const id = await addBudget(olive, H2, { limit: 300000 });
    await admin
      .from("budgets")
      .update({ starts_on: lastMonthStart })
      .eq("id", id);
    await admin
      .from("budget_limits")
      .update({ starts_on: lastMonthStart })
      .eq("budget_id", id);
    expect(
      (await pat.client.rpc("archive_budget", { target_budget_id: id })).error,
    ).toBeNull();
    expect(
      (await olive.client.rpc("archive_budget", { target_budget_id: id }))
        .error,
    ).toBeNull();
    expect((await budgetsOf(pat, H2)).budgets).toEqual([]);
    const past = await budgetsOf(pat, H2, "month", lastMonthStart);
    expect(past.budgets).toHaveLength(1);
    expect(past.budgets[0]).toMatchObject({
      archived: true,
      limitMinor: BigInt(300000),
    });
    expectError(
      (
        await olive.client.rpc("update_budget", {
          target_budget_id: id,
          budget_limit: 1,
        })
      ).error,
      REMOVED,
    );
    expect((await eventsFor(id)).map((e) => e.type)).toEqual([
      "budget_created",
      "budget_archived",
    ]);
    // A new one for the same category and period can be added again.
    const again = await addBudget(olive, H2, { limit: 400000 });
    expect((await budgetsOf(pat, H2)).budgets.map((b) => b.id)).toEqual([
      again,
    ]);
  });
});

describe("what counts as spending", () => {
  let S: string;
  let groceries: string;

  beforeAll(async () => {
    S = await household(olive, "Spending");
    await join(olive, S, pat);
    await addBudget(olive, S, { limit: 1000000 });
    groceries = await addBudget(olive, S, {
      category: "groceries",
      limit: 300000,
    });
  });

  it("counts recorded expenses by their date, overall and per category, at the month's edges", async () => {
    await addExpense(olive, S, {
      amount: 200000,
      category: "groceries",
      date: monthStart,
    });
    await addExpense(pat, S, {
      amount: 150000,
      category: "dining",
      date: today,
      payer: pat,
    });
    // The last day of last month: last month, whenever it was recorded.
    await addExpense(olive, S, {
      amount: 70000,
      category: "groceries",
      date: addDays(monthStart, -1),
    });
    const now = await budgetsOf(pat, S);
    expect(now.totalSpentMinor).toBe(BigInt(350000));
    expect(
      now.budgets.map((b) => [b.category, b.spentMinor, b.expenseCount]),
    ).toEqual([
      [null, BigInt(350000), 2],
      ["groceries", BigInt(200000), 1],
    ]);
    const before = await budgetsOf(pat, S, "month", lastMonthStart);
    expect(before.totalSpentMinor).toBe(BigInt(70000));
    // Neither budget covered last month: both started this month.
    expect(before.budgets).toEqual([]);
  });

  it("leaves out deleted expenses and settlements, and counts a restored one", async () => {
    const extra = await addExpense(olive, S, {
      amount: 90000,
      category: "groceries",
      date: today,
    });
    expect((await budgetsOf(pat, S)).budgets[1].spentMinor).toBe(
      BigInt(290000),
    );
    await olive.client.rpc("delete_expense", { target_expense_id: extra });
    expect((await budgetsOf(pat, S)).budgets[1].spentMinor).toBe(
      BigInt(200000),
    );
    await olive.client.rpc("restore_expense", { target_expense_id: extra });
    expect((await budgetsOf(pat, S)).budgets[1].spentMinor).toBe(
      BigInt(290000),
    );
    await olive.client.rpc("delete_expense", { target_expense_id: extra });
    const settled = await pat.client.rpc("record_settlement", {
      target_household_id: S,
      payer_id: pat.id,
      recipient_id: olive.id,
      amount: 10000,
      paid_on: today,
    });
    expect(settled.error).toBeNull();
    expect((await budgetsOf(pat, S)).totalSpentMinor).toBe(BigInt(350000));
  });

  it("counts a bill only once it's recorded, and once", async () => {
    const shares = sharesJson(
      (
        computeSplit({
          method: "equal",
          total: BigInt(60000),
          participants: [olive.id, pat.id],
        }) as {
          ok: true;
          shares: Parameters<typeof sharesJson>[0];
        }
      ).shares,
    );
    const { data: bill, error } = await olive.client.rpc(
      "create_recurring_bill",
      {
        target_household_id: S,
        title: "Electricity",
        amount: 60000,
        bill_category: "utilities",
        bill_payer_id: olive.id,
        method: "equal",
        shares,
        repeat_unit: "month",
        repeat_every: 1,
        first_due_on: monthStart,
      },
    );
    if (error) throw error;
    // Due, not recorded: not spending.
    expect((await budgetsOf(pat, S)).totalSpentMinor).toBe(BigInt(350000));
    const key = randomUUID();
    const args = {
      target_bill_id: bill,
      occurrence_due_on: monthStart,
      title: "Electricity",
      amount: 60000,
      expense_category: "utilities" as const,
      spent_on: today,
      payer_id: olive.id,
      method: "equal" as const,
      shares,
      request_key: key,
    };
    expect(
      (await olive.client.rpc("record_bill_payment", args)).error,
    ).toBeNull();
    expect(
      (await olive.client.rpc("record_bill_payment", args)).error,
    ).toBeNull(); // a retry
    expect((await budgetsOf(pat, S)).totalSpentMinor).toBe(BigInt(410000));
  });

  it("reports figures for weeks and quarters too", async () => {
    const week = await budgetsOf(olive, S, "week");
    expect(week.periodStart).toBe(periodStart(today, "week"));
    const quarter = await budgetsOf(olive, S, "quarter");
    expect(quarter.totalSpentMinor >= BigInt(410000)).toBe(true);
    expect(groceries).toBeTruthy();
  });

  it("refuses dates out of range", async () => {
    const { error } = await olive.client.rpc("household_budgets", {
      target_household_id: S,
      budget_kind: "month",
      on_date: "1999-12-31",
    });
    expectError(error, INVALID);
  });
});

describe("analytics", () => {
  let A: string;

  beforeAll(async () => {
    A = await household(olive, "Analytics");
    await join(olive, A, pat, quin);
    // Last month: groceries 3000.01 paid by Olive for three (shares
    // 1000.01, 1000.00, 1000.00 in join order), dining 500 paid by Pat for
    // two, transport 100 paid by Pat for Pat. Before that: 1000.
    const d = (n: number) => addDays(lastMonthStart, n);
    await addExpense(olive, A, {
      amount: 300001,
      category: "groceries",
      date: d(0),
      people: [olive, pat, quin],
      title: "Big shop",
    });
    await addExpense(pat, A, {
      amount: 50000,
      category: "dining",
      date: d(9),
      payer: pat,
      title: "Dinner",
    });
    await addExpense(pat, A, {
      amount: 10000,
      category: "transport",
      date: d(9),
      payer: pat,
      people: [pat],
      title: "Taxi",
    });
    const gone = await addExpense(olive, A, {
      amount: 999999,
      category: "rent",
      date: d(3),
    });
    await olive.client.rpc("delete_expense", { target_expense_id: gone });
    await addExpense(olive, A, {
      amount: 100000,
      category: "groceries",
      date: addDays(lastMonthStart, -5),
    });
  });

  const lastMonth = () => ({
    from: lastMonthStart,
    to: periodEnd(lastMonthStart, "month"),
  });

  it("totals, by category and by person, with paid and share kept apart", async () => {
    const a = await analyticsOf(pat, A, lastMonth());
    expect(a.totalMinor).toBe(BigInt(360001));
    expect(a.expenseCount).toBe(3);
    expect(averageMinor(a.totalMinor, a.expenseCount)).toBe(BigInt(120000));
    expect(
      a.byCategory.map((c) => [c.category, c.totalMinor, c.expenseCount]),
    ).toEqual([
      ["groceries", BigInt(300001), 1],
      ["dining", BigInt(50000), 1],
      ["transport", BigInt(10000), 1],
    ]);
    const byId = new Map(a.members.map((m) => [m.userId, m]));
    expect(byId.get(olive.id)).toMatchObject({
      paidMinor: BigInt(300001),
      shareMinor: BigInt(125001),
    });
    expect(byId.get(pat.id)).toMatchObject({
      paidMinor: BigInt(60000),
      paidCount: 2,
      shareMinor: BigInt(135000),
    });
    expect(byId.get(quin.id)).toMatchObject({
      paidMinor: BigInt(0),
      shareMinor: BigInt(100000),
    });
    expect(a.largest.map((l) => l.description)).toEqual([
      "Big shop",
      "Dinner",
      "Taxi",
    ]);
    // The same number of days just before.
    expect(a.previousTo).toBe(addDays(lastMonthStart, -1));
    expect(a.previousTotalMinor).toBe(BigInt(100000));
  });

  it("buckets the range by day, week or month, empty ones included", async () => {
    const days = await analyticsOf(pat, A, {
      from: lastMonthStart,
      to: addDays(lastMonthStart, 13),
    });
    expect(days.bucket).toBe("day");
    expect(days.trend).toHaveLength(14);
    expect(days.trend[9]).toMatchObject({
      totalMinor: BigInt(60000),
      expenseCount: 2,
    });
    expect(days.trend[1].totalMinor).toBe(BigInt(0));
    expect((await analyticsOf(pat, A, lastMonth())).bucket).toBe("week");
    const months = await analyticsOf(pat, A, {
      from: addMonths(monthStart, -5),
      to: today,
    });
    expect(months.bucket).toBe("month");
    expect(months.trend).toHaveLength(6);
  });

  it("applies the category and payer filters to every figure", async () => {
    const dining = await analyticsOf(pat, A, {
      ...lastMonth(),
      category: "dining",
    });
    expect(dining.totalMinor).toBe(BigInt(50000));
    expect(dining.members.reduce((s, m) => s + m.shareMinor, BigInt(0))).toBe(
      BigInt(50000),
    );
    const byPat = await analyticsOf(olive, A, {
      ...lastMonth(),
      payer: pat.id,
    });
    expect(byPat.totalMinor).toBe(BigInt(60000));
    expect(byPat.byCategory.map((c) => c.category).sort()).toEqual([
      "dining",
      "transport",
    ]);
  });

  it("compares with a chosen period, and an empty range is all zeros", async () => {
    const compared = await analyticsOf(pat, A, {
      ...lastMonth(),
      compareFrom: addMonths(lastMonthStart, -1),
      compareTo: addDays(lastMonthStart, -1),
    });
    expect(compared.previousTotalMinor).toBe(BigInt(100000));
    const empty = await analyticsOf(pat, A, {
      from: "2020-01-01",
      to: "2020-01-31",
    });
    expect(empty).toMatchObject({
      totalMinor: BigInt(0),
      expenseCount: 0,
      largest: [],
      byCategory: [],
    });
  });

  it("refuses ranges it can't use", async () => {
    for (const args of [
      { date_from: "2026-02-01", date_to: "2026-01-01" },
      { date_from: "2020-01-01", date_to: "2022-01-02" },
      {
        date_from: "2026-01-01",
        date_to: "2026-01-31",
        compare_from: "2026-01-15",
        compare_to: "2026-01-20",
      },
      {
        date_from: "2026-01-01",
        date_to: "2026-01-31",
        compare_from: "2025-11-01",
      },
    ]) {
      const { error } = await olive.client.rpc("household_analytics", {
        target_household_id: A,
        ...args,
      } as never);
      expectError(error, INVALID);
    }
  });
});

describe("other households and people who leave", () => {
  it("can't read or change another household's budgets or analytics", async () => {
    const theirs = await addBudget(xena, X, { limit: 100 });
    expectError(
      (
        await olive.client.rpc("household_budgets", {
          target_household_id: X,
          budget_kind: "month",
        })
      ).error,
      PERMISSION_DENIED,
    );
    expectError(
      (
        await olive.client.rpc("household_analytics", {
          target_household_id: X,
          date_from: monthStart,
          date_to: today,
        })
      ).error,
      PERMISSION_DENIED,
    );
    for (const call of [
      olive.client.rpc("update_budget", {
        target_budget_id: theirs,
        budget_limit: 5,
      }),
      olive.client.rpc("archive_budget", { target_budget_id: theirs }),
      olive.client.rpc("archive_budget", { target_budget_id: randomUUID() }),
    ]) {
      expectError((await call).error, NO_SUCH_BUDGET);
    }
    for (const table of ["budgets", "budget_limits"] as const) {
      const { data } = await olive.client
        .from(table)
        .select("household_id")
        .eq("household_id", X);
      expect(data, table).toEqual([]);
    }
    const insert = await olive.client.from("budgets").insert({
      household_id: H,
      period: "month",
      starts_on: monthStart,
      created_by: olive.id,
    });
    expectError(insert.error, PERMISSION_DENIED);
    const update = await olive.client
      .from("budget_limits")
      .update({ limit_minor: 1 })
      .eq("household_id", H);
    expectError(update.error, PERMISSION_DENIED);
  });

  it("stops a member who left from reading or changing budgets", async () => {
    const L = await household(olive, "Leaving");
    await join(olive, L, quin);
    const id = await addBudget(quin, L, { limit: 1000 });
    expect(
      (await quin.client.rpc("leave_household", { target_household_id: L }))
        .error,
    ).toBeNull();
    expectError(
      (
        await quin.client.rpc("update_budget", {
          target_budget_id: id,
          budget_limit: 2000,
        })
      ).error,
      NO_SUCH_BUDGET,
    );
    expectError(
      (
        await quin.client.rpc("household_budgets", {
          target_household_id: L,
          budget_kind: "month",
        })
      ).error,
      PERMISSION_DENIED,
    );
    // Olive still sees the budget Quin set.
    expect((await budgetsOf(olive, L)).budgets).toHaveLength(1);
  });
});

describe("the journal and the household", () => {
  it("records each change under Budgets", async () => {
    const J = await household(olive, "Journal budgets");
    await join(olive, J, pat);
    const id = await addBudget(olive, J, {
      category: "dining",
      period: "week",
      limit: 200000,
    });
    await pat.client.rpc("update_budget", {
      target_budget_id: id,
      budget_limit: 250000,
    });
    await pat.client.rpc("archive_budget", { target_budget_id: id });
    const { data, error } = await pat.client.rpc("household_journal", {
      target_household_id: J,
      category_filter: "budgets",
    });
    if (error) throw error;
    const page = parseJournalPayload(data)!;
    expect(
      checkJournal(page, {
        householdId: J,
        filter: "budgets",
        before: null,
        pageSize: 25,
      }),
    ).toEqual({ ok: true });
    expect(page.entries.map((e) => e.detail.type)).toEqual([
      "budget_archived",
      "budget_updated",
      "budget_created",
    ]);
    expect(page.entries[0].entity).toEqual({
      available: true,
      id,
      state: "archived",
    });
  });

  it("deleting the household removes its budgets and limits (D14)", async () => {
    const D = await household(xena, "Short-lived budgets");
    await addBudget(xena, D, { limit: 100 });
    expect(
      (await xena.client.rpc("delete_household", { target_household_id: D }))
        .error,
    ).toBeNull();
    for (const table of ["budgets", "budget_limits"] as const) {
      const { data } = await admin
        .from(table)
        .select("household_id")
        .eq("household_id", D);
      expect(data, table).toEqual([]);
    }
  });

  it("uses the household's own date for the current period (D11)", async () => {
    // Kiritimati is UTC+14: often already tomorrow there.
    const K = await household(xena, "Far east", "Pacific/Kiritimati");
    const data = await budgetsOf(xena, K);
    expect(data.today).toBe(todayIn("Pacific/Kiritimati"));
  });
});
