// Financial integrity under many operations in a random order (roadmap Phase
// 18), as real signed-in users against the local stack: expenses with equal,
// percentage and custom splits, edits, deletes, restores, settlements
// (within what's owed, and acknowledged overpayments), voids, retried
// submissions and recorded bills (with retries). The books are then checked
// against the raw rows, read with the service role, not against the app's
// own figures:
//
// - every expense's shares add up exactly to its amount, deleted ones too;
// - balances net to zero, and each person's net is paid − share + settlements
//   paid − settlements received, over counted expenses and settlements only;
// - who owes whom agrees with everyone's net;
// - a retried submission records once, and a recorded bill counts once;
// - budgets and analytics equal direct sums of counted expenses: deleted
//   expenses, settlements and unrecorded bills are never spending.
//
// The order is random but seeded, so a failure can be replayed: the seed is
// in the test's name (set FINANCE_SEED to try another). Needs
// `npm run db:start`, then `npm run test:db`. Everything is created for this
// run and removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeSplit, type SplitInput } from "@/domain/money/split";
import { checkAnalytics, parseAnalytics } from "@/lib/analytics/payload";
import { parseBalancesPayload } from "@/lib/balances/parse";
import { addDays, addMonths } from "@/lib/bills/schedule";
import {
  checkHouseholdBudgets,
  parseHouseholdBudgets,
} from "@/lib/budgets/payload";
import {
  periodEnd,
  periodStart,
  type BudgetPeriod,
} from "@/lib/budgets/period";
import {
  CATEGORY_VALUES,
  type ExpenseCategory,
} from "@/lib/expenses/categories";
import { todayIn } from "@/lib/expenses/dates";
import { sharesJson } from "@/lib/expenses/form";
import {
  adminClient,
  signedInClient,
  type TypedClient,
} from "./support/local-supabase";

const SEED = Number(process.env.FINANCE_SEED ?? 20261114);
const OPERATIONS = 120;
const TZ = "Asia/Kolkata";

const runId = randomUUID().slice(0, 8);
const password = `finance-${randomUUID()}`;
const admin = adminClient();

type User = { id: string; name: string; client: TypedClient };
const users: User[] = [];
let H: string;
let today: string;

/** mulberry32: small, fast and the same everywhere for a given seed. */
function seeded(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];
  const subset = <T>(items: readonly T[]): T[] => {
    const shuffled = [...items].sort(() => next() - 0.5);
    return shuffled.slice(0, int(1, items.length));
  };
  return { next, int, pick, subset };
}

const random = seeded(SEED);

async function createUser(name: string): Promise<User> {
  const email = `finance-${runId}-${name.toLowerCase()}@example.com`;
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

/** An amount in minor units: mostly everyday, sometimes tiny or very large. */
function randomAmount(): number {
  const roll = random.next();
  if (roll < 0.1) return random.int(1, 99);
  if (roll < 0.9) return random.int(100, 2_000_000);
  return random.int(100_000_000_000, 999_999_999_999);
}

/** A valid split of `total` among `people`, by a random method. */
function randomSplit(total: number, people: User[]) {
  const method = random.pick(["equal", "percentage", "custom"] as const);
  let input: SplitInput;
  if (method === "equal") {
    input = {
      method,
      total: BigInt(total),
      participants: people.map((p) => p.id),
    };
  } else if (method === "percentage") {
    // Random cut points in 0..10000; zero percent is allowed.
    const cuts = people
      .slice(1)
      .map(() => random.int(0, 10000))
      .sort((a, b) => a - b);
    const bounds = [0, ...cuts, 10000];
    input = {
      method,
      total: BigInt(total),
      participants: people.map((p, i) => ({
        userId: p.id,
        basisPoints: bounds[i + 1] - bounds[i],
      })),
    };
  } else {
    let left = BigInt(total);
    const parts = people.map((p, i) => {
      const share =
        i === people.length - 1
          ? left
          : BigInt(Math.floor(Number(left) * random.next()));
      left -= share;
      return { userId: p.id, shareMinor: share };
    });
    input = { method, total: BigInt(total), participants: parts };
  }
  const split = computeSplit(input);
  if (!split.ok) throw new Error(`split engine refused: ${split.error}`);
  return { method, shares: sharesJson(split.shares) };
}

function randomDate(): string {
  return addDays(today, -random.int(0, 100));
}

type CreateExpenseArgs = {
  target_household_id: string;
  title: string;
  amount: number;
  expense_category: ExpenseCategory;
  spent_on: string;
  payer_id: string;
  method: "equal" | "percentage" | "custom";
  shares: ReturnType<typeof sharesJson>;
  request_key: string;
};
type SettlementArgs = {
  target_household_id: string;
  payer_id: string;
  recipient_id: string;
  amount: number;
  paid_on: string;
  request_key: string;
  acknowledged_owed?: number;
};
type Expense = {
  id: string;
  creator: User;
  deleted: boolean;
  billLinked: boolean;
  createArgs: CreateExpenseArgs;
};
type Settlement = { id: string; recorder: User; voided: boolean };
const expenses: Expense[] = [];
const settlements: Settlement[] = [];
const settlementRetries: {
  recorder: User;
  args: SettlementArgs;
  id: string;
}[] = [];

async function createExpense() {
  const creator = random.pick(users);
  const people = random.subset(users);
  const amount = randomAmount();
  const { method, shares } = randomSplit(amount, people);
  const args: CreateExpenseArgs = {
    target_household_id: H,
    title: `Cost ${expenses.length + 1}`,
    amount,
    expense_category: random.pick(CATEGORY_VALUES),
    spent_on: randomDate(),
    payer_id: random.pick(users).id,
    method,
    shares,
    request_key: randomUUID(),
  };
  const { data, error } = await creator.client.rpc("create_expense", args);
  if (error) throw error;
  expenses.push({
    id: data,
    creator,
    deleted: false,
    billLinked: false,
    createArgs: args,
  });
}

async function retryExpense() {
  const earlier = expenses.filter((e) => !e.billLinked);
  if (earlier.length === 0) return createExpense();
  const expense = random.pick(earlier);
  const { count: before } = await admin
    .from("expenses")
    .select("id", { count: "exact", head: true })
    .eq("household_id", H);
  const { data, error } = await expense.creator.client.rpc(
    "create_expense",
    expense.createArgs,
  );
  if (error) throw error;
  expect(data, "a retried expense returns the first one").toBe(expense.id);
  const { count: after } = await admin
    .from("expenses")
    .select("id", { count: "exact", head: true })
    .eq("household_id", H);
  expect(after, "a retried expense adds nothing").toBe(before);
}

async function editExpense() {
  const live = expenses.filter((e) => !e.deleted && !e.billLinked);
  if (live.length === 0) return createExpense();
  const expense = random.pick(live);
  const people = random.subset(users);
  const amount = randomAmount();
  const { method, shares } = randomSplit(amount, people);
  const { error } = await expense.creator.client.rpc("update_expense", {
    target_expense_id: expense.id,
    title: `Edited ${expense.id.slice(0, 4)}`,
    amount,
    expense_category: random.pick(CATEGORY_VALUES),
    spent_on: randomDate(),
    payer_id: random.pick(users).id,
    method,
    shares,
  });
  if (error) throw error;
}

async function deleteExpense() {
  const live = expenses.filter((e) => !e.deleted && !e.billLinked);
  if (live.length === 0) return createExpense();
  const expense = random.pick(live);
  const { error } = await expense.creator.client.rpc("delete_expense", {
    target_expense_id: expense.id,
  });
  if (error) throw error;
  expense.deleted = true;
}

async function restoreExpense() {
  const gone = expenses.filter((e) => e.deleted && !e.billLinked);
  if (gone.length === 0) return deleteExpense();
  const expense = random.pick(gone);
  // Only the owner restores (D7).
  const { error } = await users[0].client.rpc("restore_expense", {
    target_expense_id: expense.id,
  });
  if (error) throw error;
  expense.deleted = false;
}

async function balances(focus?: string) {
  const { data, error } = await users[0].client.rpc("household_balances", {
    target_household_id: H,
    ...(focus ? { focus_user_id: focus } : {}),
  });
  if (error) throw error;
  const parsed = parseBalancesPayload(data);
  if (!parsed)
    throw new Error("household_balances returned an unexpected shape");
  return parsed;
}

async function settle(overpay: boolean) {
  const { pairs } = await balances();
  if (pairs.length === 0) return createExpense();
  const pair = random.pick(pairs);
  const payer = users.find((u) => u.id === pair.debtorId)!;
  const recipient = users.find((u) => u.id === pair.creditorId)!;
  const recorder = random.next() < 0.5 ? payer : recipient;
  const owed = Number(pair.amountMinor);
  const amount = overpay
    ? Math.min(owed + random.int(1, 50_000), 999_999_999_999)
    : random.int(1, Math.min(owed, 999_999_999_999));
  const plain: SettlementArgs = {
    target_household_id: H,
    payer_id: payer.id,
    recipient_id: recipient.id,
    amount,
    paid_on: addDays(today, -random.int(0, 30)),
    request_key: randomUUID(),
  };
  let args = plain;
  if (amount > owed) {
    // Without the acknowledgement, more than what's owed is refused.
    const refused = await recorder.client.rpc("record_settlement", {
      ...plain,
      request_key: randomUUID(),
    });
    expect(refused.error?.code).toBe("HJ017");
    expect(refused.error?.details).toBe(String(owed));
    args = { ...plain, acknowledged_owed: owed };
  }
  const { data, error } = await recorder.client.rpc("record_settlement", args);
  if (error) throw error;
  settlements.push({ id: data, recorder, voided: false });
  settlementRetries.push({ recorder, args, id: data });
}

async function retrySettlement() {
  if (settlementRetries.length === 0) return settle(false);
  const earlier = random.pick(settlementRetries);
  const { data, error } = await earlier.recorder.client.rpc(
    "record_settlement",
    earlier.args,
  );
  if (error) throw error;
  expect(data, "a retried settlement returns the first one").toBe(earlier.id);
}

async function voidSettlement() {
  const live = settlements.filter((s) => !s.voided);
  if (live.length === 0) return settle(false);
  const settlement = random.pick(live);
  const { error } = await settlement.recorder.client.rpc("void_settlement", {
    target_settlement_id: settlement.id,
  });
  if (error) throw error;
  settlement.voided = true;
}

const OPERATION_MIX: [number, () => Promise<unknown>][] = [
  [0.3, createExpense],
  [0.08, retryExpense],
  [0.13, editExpense],
  [0.09, deleteExpense],
  [0.06, restoreExpense],
  [0.18, () => settle(false)],
  [0.04, () => settle(true)],
  [0.05, retrySettlement],
  [0.07, voidSettlement],
];

async function randomOperation() {
  let roll = random.next();
  for (const [weight, run] of OPERATION_MIX) {
    if (roll < weight) return run();
    roll -= weight;
  }
  return createExpense();
}

/** The household's rows, read with the service role (no RLS, no app code). */
async function rawBooks() {
  const [expenseRows, splitRows, settlementRows] = await Promise.all([
    admin
      .from("expenses")
      .select(
        "id, amount_minor, paid_by, deleted_at, category, expense_date, recurring_bill_id, recurrence_period",
      )
      .eq("household_id", H),
    admin
      .from("expense_splits")
      .select("expense_id, user_id, share_minor")
      .eq("household_id", H),
    admin
      .from("settlements")
      .select("id, amount_minor, from_user, to_user, voided_at")
      .eq("household_id", H),
  ]);
  for (const result of [expenseRows, splitRows, settlementRows]) {
    if (result.error) throw result.error;
  }
  return {
    expenses: expenseRows.data!,
    splits: splitRows.data!,
    settlements: settlementRows.data!,
  };
}

type Books = Awaited<ReturnType<typeof rawBooks>>;

function counted(books: Books) {
  return books.expenses.filter((e) => e.deleted_at === null);
}

function sum(values: (number | bigint)[]): bigint {
  return values.reduce<bigint>((acc, v) => acc + BigInt(v), BigInt(0));
}

/** Every expense's shares add up to its amount; balances agree with the rows. */
async function checkBooks(label: string) {
  const books = await rawBooks();
  expect(books.expenses.length, label).toBeLessThan(1000); // under the API's row cap

  for (const expense of books.expenses) {
    const shares = books.splits.filter((s) => s.expense_id === expense.id);
    expect(shares.length, `${label}: ${expense.id} has people`).toBeGreaterThan(
      0,
    );
    expect(
      sum(shares.map((s) => s.share_minor)),
      `${label}: shares of ${expense.id} add up`,
    ).toBe(BigInt(expense.amount_minor));
  }

  const live = counted(books);
  const liveIds = new Set(live.map((e) => e.id));
  const liveSettlements = books.settlements.filter((s) => s.voided_at === null);
  const summary = await balances();

  expect(summary.expenseCount, label).toBe(live.length);
  expect(summary.totalMinor, label).toBe(sum(live.map((e) => e.amount_minor)));
  expect(summary.settlementCount, label).toBe(liveSettlements.length);
  expect(summary.settlementTotalMinor, label).toBe(
    sum(liveSettlements.map((s) => s.amount_minor)),
  );

  let netTotal = BigInt(0);
  for (const user of users) {
    const paid = sum(
      live.filter((e) => e.paid_by === user.id).map((e) => e.amount_minor),
    );
    const share = sum(
      books.splits
        .filter((s) => s.user_id === user.id && liveIds.has(s.expense_id))
        .map((s) => s.share_minor),
    );
    const settledPaid = sum(
      liveSettlements
        .filter((s) => s.from_user === user.id)
        .map((s) => s.amount_minor),
    );
    const settledReceived = sum(
      liveSettlements
        .filter((s) => s.to_user === user.id)
        .map((s) => s.amount_minor),
    );
    const person = summary.people.find((p) => p.userId === user.id);
    expect(person, `${label}: ${user.name} is listed`).toBeTruthy();
    expect(
      {
        paid: person!.paidMinor,
        share: person!.shareMinor,
        settledPaid: person!.settlementsPaidMinor,
        settledReceived: person!.settlementsReceivedMinor,
        net: person!.netMinor,
      },
      `${label}: ${user.name}'s balance`,
    ).toEqual({
      paid,
      share,
      settledPaid,
      settledReceived,
      net: paid - share + settledPaid - settledReceived,
    });

    // Who owes whom: what they're owed minus what they owe is their net.
    const owedTo = sum(
      summary.pairs
        .filter((p) => p.creditorId === user.id)
        .map((p) => p.amountMinor),
    );
    const owes = sum(
      summary.pairs
        .filter((p) => p.debtorId === user.id)
        .map((p) => p.amountMinor),
    );
    expect(owedTo - owes, `${label}: ${user.name}'s pairs`).toBe(
      person!.netMinor,
    );
    netTotal += person!.netMinor;
  }
  expect(netTotal, `${label}: balances net to zero`).toBe(BigInt(0));
  expect(summary.people.reduce((acc, p) => acc + p.netMinor, BigInt(0))).toBe(
    BigInt(0),
  );

  const seen = new Set<string>();
  for (const pair of summary.pairs) {
    expect(pair.amountMinor > BigInt(0), `${label}: pairs are positive`).toBe(
      true,
    );
    expect(pair.debtorId).not.toBe(pair.creditorId);
    const key = [pair.debtorId, pair.creditorId].sort().join("|");
    expect(seen.has(key), `${label}: one line per pair`).toBe(false);
    seen.add(key);
  }
  return books;
}

beforeAll(async () => {
  for (const name of ["Olive", "Pat", "Quin", "Rae"]) await createUser(name);
  const [olive] = users;
  const { data, error } = await olive.client.rpc("create_household", {
    household_name: `Books ${runId}`,
    currency: "INR",
    time_zone: TZ,
  });
  if (error) throw error;
  H = data;
  const bytes = randomBytes(32);
  const invite = await olive.client.from("invitations").insert({
    household_id: H,
    token_hash: createHash("sha256").update(bytes).digest("hex"),
  });
  if (invite.error) throw invite.error;
  for (const user of users.slice(1)) {
    const joined = await user.client.rpc("accept_invite", {
      token: bytes.toString("base64url"),
    });
    if (joined.error) throw joined.error;
  }
  today = todayIn(TZ);
}, 60_000);

afterAll(async () => {
  const ids = users.map((u) => u.id);
  if (ids.length) {
    // The household cascades to everything in it (D14).
    await admin.from("households").delete().in("created_by", ids);
    await admin.from("profiles").delete().in("id", ids);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  }
});

describe(`the books under ${OPERATIONS} random operations (seed ${SEED})`, () => {
  it("stay exact after every batch", async () => {
    for (let i = 1; i <= OPERATIONS; i++) {
      await randomOperation();
      if (i % 20 === 0) await checkBooks(`after operation ${i}`);
    }
    const books = await checkBooks("at the end");
    // The run did exercise each kind of record.
    expect(counted(books).length).toBeGreaterThan(10);
    expect(books.expenses.some((e) => e.deleted_at !== null)).toBe(true);
    expect(books.settlements.some((s) => s.voided_at !== null)).toBe(true);
    expect(books.settlements.some((s) => s.voided_at === null)).toBe(true);
  }, 240_000);

  it("count a recorded bill once, retries included, and an unrecorded one not at all", async () => {
    const [olive, pat, quin] = users;
    const firstDue = addMonths(periodStart(today, "month"), -2);
    const people = [olive, pat, quin];
    const amount = 123_457;
    const split = randomSplit(amount, people);
    const { data: bill, error } = await olive.client.rpc(
      "create_recurring_bill",
      {
        target_household_id: H,
        title: "Broadband",
        amount,
        bill_category: "utilities",
        bill_payer_id: pat.id,
        method: split.method,
        shares: split.shares,
        repeat_unit: "month",
        repeat_every: 1,
        first_due_on: firstDue,
      },
    );
    if (error) throw error;

    const before = await rawBooks();
    for (const due of [firstDue, addMonths(firstDue, 1)]) {
      const args = {
        target_bill_id: bill,
        occurrence_due_on: due,
        title: "Broadband",
        amount,
        expense_category: "utilities" as const,
        spent_on: due,
        payer_id: pat.id,
        method: split.method,
        shares: split.shares,
        request_key: randomUUID(),
      };
      const first = await quin.client.rpc("record_bill_payment", args);
      if (first.error) throw first.error;
      const retry = await quin.client.rpc("record_bill_payment", args);
      if (retry.error) throw retry.error;
      expect(retry.data, "a retried record returns the first expense").toBe(
        first.data,
      );
    }
    // The third period (this month) is due but not recorded.

    const books = await checkBooks("after the bill");
    const linked = books.expenses.filter((e) => e.recurring_bill_id === bill);
    expect(linked.map((e) => e.recurrence_period).sort()).toEqual([
      firstDue,
      addMonths(firstDue, 1),
    ]);
    expect(books.expenses.length - before.expenses.length).toBe(2);
    expect(counted(books).length - counted(before).length).toBe(2);
  });

  it("give budgets equal to direct sums of counted expenses", async () => {
    const [olive] = users;
    for (const budget of [
      { budget_kind: "month" as const },
      { budget_kind: "month" as const, budget_category: "groceries" as const },
      { budget_kind: "week" as const, budget_category: "utilities" as const },
      { budget_kind: "quarter" as const },
    ]) {
      const { error } = await olive.client.rpc("create_budget", {
        target_household_id: H,
        budget_limit: 50_000_000,
        ...budget,
      });
      if (error) throw error;
    }

    const books = await rawBooks();
    const live = counted(books);
    const settlementTotal = sum(
      books.settlements
        .filter((s) => s.voided_at === null)
        .map((s) => s.amount_minor),
    );
    expect(settlementTotal > BigInt(0)).toBe(true);

    for (const period of ["week", "month", "quarter"] as BudgetPeriod[]) {
      const { data, error } = await users[1].client.rpc("household_budgets", {
        target_household_id: H,
        budget_kind: period,
      });
      if (error) throw error;
      const parsed = parseHouseholdBudgets(data);
      expect(parsed, `${period}: shape`).not.toBeNull();
      const check = checkHouseholdBudgets(parsed!, {
        householdId: H,
        period,
        onDate: null,
      });
      expect(check.ok, `${period}: checks`).toBe(true);

      const start = periodStart(today, period);
      const end = periodEnd(start, period);
      const inPeriod = live.filter(
        (e) => e.expense_date >= start && e.expense_date <= end,
      );
      expect(parsed!.periodStart).toBe(start);
      expect(parsed!.totalSpentMinor, `${period}: total`).toBe(
        sum(inPeriod.map((e) => e.amount_minor)),
      );
      expect(parsed!.totalCount, `${period}: count`).toBe(inPeriod.length);
      for (const row of parsed!.budgets.filter((b) => !b.archived)) {
        const rows = inPeriod.filter(
          (e) => !row.category || e.category === row.category,
        );
        expect(
          row.spentMinor,
          `${period} ${row.category ?? "all"}: spent`,
        ).toBe(sum(rows.map((e) => e.amount_minor)));
        expect(row.expenseCount).toBe(rows.length);
      }
    }
  });

  it("give analytics equal to direct sums of counted expenses", async () => {
    const books = await rawBooks();
    const from = addDays(today, -120);
    const asked = {
      from,
      to: today,
      compareFrom: null,
      compareTo: null,
      category: null,
      payer: null,
    };
    const { data, error } = await users[2].client.rpc("household_analytics", {
      target_household_id: H,
      date_from: from,
      date_to: today,
    });
    if (error) throw error;
    const analytics = parseAnalytics(data);
    expect(analytics).not.toBeNull();
    expect(checkAnalytics(analytics!, asked).ok).toBe(true);

    const live = counted(books).filter(
      (e) => e.expense_date >= from && e.expense_date <= today,
    );
    const liveIds = new Set(live.map((e) => e.id));
    expect(analytics!.totalMinor).toBe(sum(live.map((e) => e.amount_minor)));
    expect(analytics!.expenseCount).toBe(live.length);
    expect(sum(analytics!.trend.map((t) => t.totalMinor))).toBe(
      analytics!.totalMinor,
    );

    const categories = new Set(live.map((e) => e.category));
    expect(analytics!.byCategory.map((c) => c.category).sort()).toEqual(
      [...categories].sort(),
    );
    for (const row of analytics!.byCategory) {
      const rows = live.filter((e) => e.category === row.category);
      expect(row.totalMinor, row.category).toBe(
        sum(rows.map((e) => e.amount_minor)),
      );
      expect(row.expenseCount).toBe(rows.length);
    }

    for (const user of users) {
      const member = analytics!.members.find((m) => m.userId === user.id);
      const paid = live.filter((e) => e.paid_by === user.id);
      const share = sum(
        books.splits
          .filter((s) => s.user_id === user.id && liveIds.has(s.expense_id))
          .map((s) => s.share_minor),
      );
      expect(
        {
          paid: member?.paidMinor ?? BigInt(0),
          count: member?.paidCount ?? 0,
          share: member?.shareMinor ?? BigInt(0),
        },
        `${user.name} in analytics`,
      ).toEqual({
        paid: sum(paid.map((e) => e.amount_minor)),
        count: paid.length,
        share,
      });
    }
  });
});
