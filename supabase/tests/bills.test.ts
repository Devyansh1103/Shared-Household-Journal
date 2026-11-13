// Recurring bills (roadmap Phase 14, D10, ADR-010, D27 proposed) as real
// signed-in users against the local stack: the schedule rules (compared with
// src/lib/bills/schedule.ts), periods worked out on every read without any
// scheduler, recording a period as exactly one expense (retries, concurrent
// requests, a failure rolls everything back), skipping and undoing it,
// pausing, resuming, ending, editing details and the schedule without
// rewriting history, D7's restore rule, who may do what, other households
// and forged links, the household's timezone, the journal, deleting the
// household, and that no money moves until a period is recorded. Every answer
// is parsed and checked with the app's own code (src/lib/bills/payload.ts).
//
// Needs `npm run db:start`, then `npm run test:db`. Everything is created for
// this run and removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeSplit } from "@/domain/money/split";
import {
  checkBillDetail,
  checkHouseholdBills,
  parseBillDetail,
  parseHouseholdBills,
  type BillDetail,
  type HouseholdBills,
} from "@/lib/bills/payload";
import { addDays, addMonths, dueDate } from "@/lib/bills/schedule";
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
const FOREIGN_KEY_VIOLATION = "23503";
const NOT_ACTIVE_MEMBER = "HJ007";
const INVALID_SPLIT = "HJ008";
const NO_SUCH_BILL = "HJ018";
const BAD_SCHEDULE = "HJ019";
const BILL_CHANGED = "HJ020";
const BILL_STATE = "HJ021";
const ALREADY_RECORDED = "HJ022";
const SKIP_STATE = "HJ023";
const NO_SUCH_PERIOD = "HJ024";
const RESTORE_CONFLICT = "HJ025";

const runId = randomUUID().slice(0, 8);
const password = `bill-${randomUUID()}`;
const admin = adminClient();
const TZ = "Asia/Kolkata";

type User = { id: string; name: string; client: TypedClient };
const users: User[] = [];
let olive: User, pat: User, quin: User, raj: User, xena: User;

function expectError(error: PostgrestError | null, code: string) {
  expect(error, `expected Postgres error ${code}`).not.toBeNull();
  expect(error?.code).toBe(code);
}

async function createUser(name: string): Promise<User> {
  const email = `bill-${runId}-${name.toLowerCase()}@example.com`;
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

function equalShares(total: number, people: User[]) {
  const split = computeSplit({
    method: "equal",
    total: BigInt(total),
    participants: people.map((p) => p.id),
  });
  if (!split.ok) throw new Error(split.error);
  return sharesJson(split.shares);
}

type BillInput = {
  title?: string;
  amount?: number;
  payer?: User;
  people?: User[];
  unit?: "week" | "month" | "year";
  every?: number;
  firstDueOn: string;
  lastDueOn?: string;
  key?: string;
};

function billArgs(householdId: string, input: BillInput) {
  const amount = input.amount ?? 100000;
  return {
    target_household_id: householdId,
    title: input.title ?? "Electricity",
    amount,
    bill_category: "utilities" as const,
    bill_payer_id: (input.payer ?? olive).id,
    method: "equal" as const,
    shares: equalShares(amount, input.people ?? [olive, pat]),
    repeat_unit: input.unit ?? "month",
    repeat_every: input.every ?? 1,
    first_due_on: input.firstDueOn,
    ...(input.lastDueOn ? { last_due_on: input.lastDueOn } : {}),
    ...(input.key ? { request_key: input.key } : {}),
  };
}

async function addBill(user: User, householdId: string, input: BillInput) {
  const { data, error } = await user.client.rpc(
    "create_recurring_bill",
    billArgs(householdId, input),
  );
  if (error) throw error;
  return data;
}

/** The bills page's data, parsed and checked as the app does. */
async function billsOf(
  user: User,
  householdId: string,
): Promise<HouseholdBills> {
  const { data, error } = await user.client.rpc("household_bills", {
    target_household_id: householdId,
  });
  if (error) throw error;
  const parsed = parseHouseholdBills(data);
  if (!parsed) throw new Error("household_bills returned an unexpected shape");
  const check = checkHouseholdBills(parsed, householdId);
  if (!check.ok) throw new Error(`household_bills failed ${check.code}`);
  return parsed;
}

/** One bill's page, parsed and checked as the app does. */
async function billOf(
  user: User,
  billId: string,
  householdId: string,
): Promise<BillDetail> {
  const { data, error } = await user.client.rpc("recurring_bill", {
    target_bill_id: billId,
  });
  if (error) throw error;
  const parsed = parseBillDetail(data);
  if (!parsed) throw new Error("recurring_bill returned an unexpected shape");
  const check = checkBillDetail(parsed, householdId);
  if (!check.ok) throw new Error(`recurring_bill failed ${check.code}`);
  return parsed;
}

type RecordInput = {
  amount?: number;
  payer?: User;
  people?: User[];
  key?: string;
  spentOn?: string;
};

function recordArgs(billId: string, due: string, input: RecordInput = {}) {
  const amount = input.amount ?? 100000;
  return {
    target_bill_id: billId,
    occurrence_due_on: due,
    title: "Electricity",
    amount,
    expense_category: "utilities" as const,
    spent_on: input.spentOn ?? due,
    payer_id: (input.payer ?? olive).id,
    method: "equal" as const,
    shares: equalShares(amount, input.people ?? [olive, pat]),
    ...(input.key ? { request_key: input.key } : {}),
  };
}

function record(
  user: User,
  billId: string,
  due: string,
  input: RecordInput = {},
) {
  return user.client.rpc("record_bill_payment", recordArgs(billId, due, input));
}

async function recordOk(
  user: User,
  billId: string,
  due: string,
  input: RecordInput = {},
) {
  const { data, error } = await record(user, billId, due, input);
  if (error) throw error;
  return data;
}

async function storedPeriods(billId: string) {
  const { data, error } = await admin
    .from("bill_occurrences")
    .select("due_on, expected_amount_minor, skipped_at")
    .eq("bill_id", billId)
    .order("due_on");
  if (error) throw error;
  return data;
}

async function linkedExpenses(billId: string) {
  const { data, error } = await admin
    .from("expenses")
    .select("id, amount_minor, recurrence_period, deleted_at")
    .eq("recurring_bill_id", billId)
    .order("recurrence_period");
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

async function balances(user: User, householdId: string) {
  const { data, error } = await user.client.rpc("household_balances", {
    target_household_id: householdId,
  });
  if (error) throw error;
  return data;
}

let H: string, X: string;
/** "Today" in H's timezone, as the database sees it. */
let today: string;

beforeAll(async () => {
  [olive, pat, quin, raj, xena] = await Promise.all(
    ["Olive", "Pat", "Quin", "Raj", "Xena"].map(createUser),
  );
  H = await household(olive, "Bills home");
  X = await household(xena, "Other home");
  await join(olive, H, pat, quin);
  today = (await billsOf(olive, H)).today;
}, 60_000);

afterAll(async () => {
  const ids = users.map((u) => u.id);
  if (ids.length) {
    // Households cascade to bills, periods, expenses and the journal (D14).
    await admin.from("households").delete().in("created_by", ids);
    await admin.from("profiles").delete().in("id", ids);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  }
});

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

describe("the schedule rules", () => {
  it("agree with src/lib/bills/schedule.ts for every unit, interval and month end", () => {
    // Anchors over two years (2028 is a leap year): the 1st, the 15th and
    // every day from the 27th; every unit, every 1 and 3, 14 periods each.
    const result = psqlAsSuperuser(`
\\pset tuples_only on
\\pset format unaligned
select a::date || '|' || u || '|' || e || '|' || k || '|'
  || private.bill_due_date(a::date, u::public.bill_frequency, e, k)
from generate_series('2027-01-01'::date, '2028-12-31'::date, interval '1 day') a,
  unnest(array['week', 'month', 'year']) u,
  unnest(array[1, 3]) e,
  generate_series(0, 13) k
where extract(day from a) in (1, 15) or extract(day from a) >= 27;
`);
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(10_000);
    const wrong = lines.filter((line) => {
      const [anchor, unit, every, k, sql] = line.split("|");
      return (
        dueDate(
          anchor,
          unit as "week" | "month" | "year",
          Number(every),
          Number(k),
        ) !== sql
      );
    });
    expect(wrong).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Adding a bill
// ---------------------------------------------------------------------------

describe("create_recurring_bill", () => {
  it("adds a bill with its default split, from the session, and journals it", async () => {
    const id = await addBill(pat, H, {
      title: "Internet",
      amount: 99900,
      payer: pat,
      people: [olive, pat, quin],
      firstDueOn: addDays(today, 10),
    });
    const { data: row } = await admin
      .from("recurring_bills")
      .select("*, recurring_bill_shares(user_id, share_minor, percentage_bp)")
      .eq("id", id)
      .single();
    expect(row).toMatchObject({
      household_id: H,
      description: "Internet",
      amount_minor: 99900,
      payer_id: pat.id,
      created_by: pat.id,
      frequency: "month",
      interval_count: 1,
      anchor_on: addDays(today, 10),
      next_index: 0,
      split_method: "equal",
    });
    // Equal splits keep who, not amounts.
    expect(
      row?.recurring_bill_shares.map((s) => [s.share_minor, s.percentage_bp]),
    ).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
    const { data: events } = await admin
      .from("activity_events")
      .select("type, actor_id")
      .eq("entity_id", id);
    expect(events).toEqual([{ type: "bill_created", actor_id: pat.id }]);
  });

  it("returns the first bill for a repeated request key, also at the same time", async () => {
    const key = randomUUID();
    const input = { title: "Water", firstDueOn: today, key };
    const ids = await Promise.all([
      addBill(olive, H, input),
      addBill(olive, H, input),
      addBill(olive, H, input),
    ]);
    expect(new Set(ids).size).toBe(1);
    const { count } = await admin
      .from("activity_events")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", ids[0]);
    expect(count).toBe(1);
  });

  it("refuses what can't be right, and writes nothing", async () => {
    const before = await admin
      .from("recurring_bills")
      .select("id", { count: "exact", head: true })
      .eq("household_id", H);
    const cases: [Record<string, unknown>, string][] = [
      [{ first_due_on: addDays(today, -367) }, BAD_SCHEDULE],
      [{ first_due_on: addDays(today, 3661) }, BAD_SCHEDULE],
      [{ first_due_on: today, last_due_on: addDays(today, -1) }, BAD_SCHEDULE],
      [{ repeat_every: 0 }, CHECK_VIOLATION],
      [{ repeat_every: 53 }, CHECK_VIOLATION],
      [{ amount: 0 }, CHECK_VIOLATION],
      [{ bill_payer_id: xena.id }, NOT_ACTIVE_MEMBER],
      [{ shares: equalShares(100000, [olive, xena]) }, NOT_ACTIVE_MEMBER],
      [{ shares: [] }, INVALID_SPLIT],
      [
        {
          method: "percentage",
          shares: [
            { user_id: olive.id, share_minor: 0, percentage_bp: 6000 },
            { user_id: pat.id, share_minor: 0, percentage_bp: 3000 },
          ],
        },
        INVALID_SPLIT,
      ],
      [
        {
          method: "custom",
          shares: [
            { user_id: olive.id, share_minor: 60000, percentage_bp: null },
            { user_id: pat.id, share_minor: 30000, percentage_bp: null },
          ],
        },
        INVALID_SPLIT,
      ],
    ];
    for (const [change, code] of cases) {
      const { error } = await olive.client.rpc("create_recurring_bill", {
        ...billArgs(H, { firstDueOn: today }),
        ...change,
      } as never);
      expectError(error, code);
    }
    // Someone outside the household.
    expectError(
      (
        await xena.client.rpc(
          "create_recurring_bill",
          billArgs(H, { firstDueOn: today }),
        )
      ).error,
      PERMISSION_DENIED,
    );
    const after = await admin
      .from("recurring_bills")
      .select("id", { count: "exact", head: true })
      .eq("household_id", H);
    expect(after.count).toBe(before.count);
  });

  it("keeps percentages and custom amounts of a default split", async () => {
    const id = await addBill(olive, H, { firstDueOn: today });
    const { error } = await olive.client.rpc("update_recurring_bill", {
      target_bill_id: id,
      title: "Electricity",
      amount: 100000,
      bill_category: "utilities",
      bill_payer_id: olive.id,
      method: "custom",
      shares: [
        { user_id: olive.id, share_minor: 70000, percentage_bp: null },
        { user_id: pat.id, share_minor: 30000, percentage_bp: null },
      ],
    });
    expect(error).toBeNull();
    const detail = await billOf(olive, id, H);
    expect(detail.bill.splitMethod).toBe("custom");
    expect(detail.shares.map((s) => s.shareMinor).sort()).toEqual([
      BigInt(30000),
      BigInt(70000),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Periods without a scheduler
// ---------------------------------------------------------------------------

describe("periods, worked out on every read", () => {
  it("shows every period that has come, and the next one, with nothing stored", async () => {
    const first = addMonths(today, -2);
    const id = await addBill(olive, H, { title: "Rent", firstDueOn: first });
    const data = await billsOf(pat, H);
    const open = data.open.filter((o) => o.billId === id).map((o) => o.dueOn);
    const expected = [0, 1, 2]
      .map((k) => dueDate(first, "month", 1, k))
      .filter((d) => d <= today);
    expect(open).toEqual(expected);
    expect(data.bills.find((b) => b.id === id)?.nextDueOn).toBe(
      dueDate(first, "month", 1, expected.length),
    );
    // Nothing had to be generated, so nothing was.
    expect(await storedPeriods(id)).toEqual([]);
    // And reading again gives the same, still storing nothing.
    expect(
      (await billsOf(quin, H)).open.filter((o) => o.billId === id),
    ).toEqual(data.open.filter((o) => o.billId === id));
    expect(await storedPeriods(id)).toEqual([]);
  });

  it("catches up a weekly bill a year behind, bounded", async () => {
    const first = addDays(today, -364);
    const id = await addBill(olive, H, {
      title: "Cleaner",
      unit: "week",
      firstDueOn: first,
    });
    const open = (await billsOf(olive, H)).open.filter((o) => o.billId === id);
    expect(open).toHaveLength(53);
    expect(open[0].dueOn).toBe(first);
    expect(open.at(-1)?.dueOn).toBe(today);
  });

  it("follows the household's timezone (D11)", async () => {
    const ahead = await household(raj, "Kiritimati", "Pacific/Kiritimati");
    const behind = await household(raj, "Pago Pago", "Pacific/Pago_Pago");
    const aheadToday = todayIn("Pacific/Kiritimati");
    expect((await billsOf(raj, ahead)).today).toBe(aheadToday);
    expect((await billsOf(raj, behind)).today).toBe(
      todayIn("Pacific/Pago_Pago"),
    );
    expect(todayIn("Pacific/Pago_Pago") < aheadToday).toBe(true);

    // The same calendar date is due today in one and still to come in the other.
    const bill = (hh: string) =>
      raj.client.rpc("create_recurring_bill", {
        ...billArgs(hh, { firstDueOn: aheadToday, payer: raj, people: [raj] }),
      });
    const a = (await bill(ahead)).data!;
    const b = (await bill(behind)).data!;
    expect((await billsOf(raj, ahead)).open.map((o) => o.billId)).toEqual([a]);
    const later = await billsOf(raj, behind);
    expect(later.open).toEqual([]);
    expect(later.bills.find((x) => x.id === b)?.nextDueOn).toBe(aheadToday);
  });
});

// ---------------------------------------------------------------------------
// Recording a period (D10, ADR-010)
// ---------------------------------------------------------------------------

describe("record_bill_payment", () => {
  let bill: string;
  const first = () => addMonths(today, -2);

  beforeAll(async () => {
    bill = await addBill(olive, H, {
      title: "Gas",
      firstDueOn: first(),
      amount: 100000,
    });
  });

  it("records the oldest open period as one linked expense, for the actual amount", async () => {
    const before = await expenseCount(H);
    // Quin can record (any member, D27) a bill Olive added and pays.
    const id = await recordOk(quin, bill, first(), {
      amount: 112345,
      payer: pat,
      people: [olive, pat, quin],
      key: randomUUID(),
    });
    expect(await expenseCount(H)).toBe(before + 1);
    expect(await linkedExpenses(bill)).toEqual([
      {
        id,
        amount_minor: 112345,
        recurrence_period: first(),
        deleted_at: null,
      },
    ]);
    const { data: expense } = await admin
      .from("expenses")
      .select("household_id, created_by, paid_by, expense_splits(user_id)")
      .eq("id", id)
      .single();
    expect(expense).toMatchObject({
      household_id: H,
      created_by: quin.id,
      paid_by: pat.id,
    });
    expect(expense?.expense_splits).toHaveLength(3);

    // The period is stored with the bill's expected amount, which didn't change.
    expect(await storedPeriods(bill)).toEqual([
      { due_on: first(), expected_amount_minor: 100000, skipped_at: null },
    ]);
    const detail = await billOf(olive, bill, H);
    expect(detail.bill.amountMinor).toBe(BigInt(100000));
    const recorded = detail.periods.find((p) => p.dueOn === first());
    expect(recorded).toMatchObject({
      status: "recorded",
      expense: { id, amountMinor: BigInt(112345), paidBy: pat.id },
    });
    // It's not open any more; the expense's journal entry is the usual one.
    expect(
      (await billsOf(olive, H)).open.some(
        (o) => o.billId === bill && o.dueOn === first(),
      ),
    ).toBe(false);
    const { data: events } = await admin
      .from("activity_events")
      .select("type, actor_id")
      .eq("entity_id", id);
    expect(events).toEqual([{ type: "expense_created", actor_id: quin.id }]);
  });

  it("returns the same expense for a retry, and refuses a second one for the period", async () => {
    const key = randomUUID();
    const due = dueDate(first(), "month", 1, 1);
    const one = await recordOk(olive, bill, due, { key });
    expect(await recordOk(olive, bill, due, { key })).toBe(one);
    expectError(
      (await record(pat, bill, due, { key: randomUUID() })).error,
      ALREADY_RECORDED,
    );
    expect(
      (await linkedExpenses(bill)).filter((e) => e.recurrence_period === due),
    ).toHaveLength(1);
  });

  it("lets only one of two people recording the same period at once succeed", async () => {
    const due = dueDate(first(), "month", 1, 2);
    if (due > today) return; // only two months have come this month
    const results = await Promise.all([
      record(olive, bill, due, { key: randomUUID() }),
      record(pat, bill, due, { key: randomUUID() }),
    ]);
    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    expectError(results.find((r) => r.error)!.error, ALREADY_RECORDED);
    expect(
      (await linkedExpenses(bill)).filter((e) => e.recurrence_period === due),
    ).toHaveLength(1);
  });

  it("refuses dates that aren't a period that can be recorded", async () => {
    const detail = await billOf(olive, bill, H);
    const next = detail.bill.nextDueOn!;
    for (const due of [
      addDays(first(), 1), // not on the schedule
      dueDate(next, "month", 1, 1), // two ahead
      addMonths(first(), -1), // before the first
    ]) {
      expectError((await record(olive, bill, due)).error, NO_SUCH_PERIOD);
    }
    // The next one can be paid early; then the one after it is next. (Each
    // period comes from the first due date, so count, don't add a month.)
    const early = await recordOk(olive, bill, next, { spentOn: today });
    expect(early).toBeTruthy();
    const after = await billOf(olive, bill, H);
    expect(after.periods.find((p) => p.dueOn === next)?.status).toBe(
      "recorded",
    );
    let k = 0;
    while (dueDate(first(), "month", 1, k) !== next) k++;
    expect(after.bill.nextDueOn).toBe(dueDate(first(), "month", 1, k + 1));
  });

  it("stores nothing when the expense is refused: it all rolls back", async () => {
    const due = addDays(today, -7);
    const other = await addBill(olive, H, {
      title: "Phone",
      unit: "week",
      firstDueOn: due,
    });
    const before = await expenseCount(H);
    const refusals: [Record<string, unknown>, string][] = [
      [
        {
          amount: 0,
          shares: [{ user_id: olive.id, share_minor: 0, percentage_bp: null }],
        },
        CHECK_VIOLATION,
      ],
      [{ payer_id: xena.id }, NOT_ACTIVE_MEMBER],
      [{ shares: equalShares(100000, [olive, xena]) }, NOT_ACTIVE_MEMBER],
      [{ shares: equalShares(99999, [olive, pat]) }, INVALID_SPLIT],
    ];
    for (const [change, code] of refusals) {
      const { error } = await olive.client.rpc("record_bill_payment", {
        ...recordArgs(other, due),
        ...change,
      } as never);
      expectError(error, code);
    }
    expect(await expenseCount(H)).toBe(before);
    // Not even the periods it would have stored on the way.
    expect(await storedPeriods(other)).toEqual([]);
  });

  it("is refused to anyone outside the household, as if the bill didn't exist", async () => {
    expectError((await record(xena, bill, today)).error, NO_SUCH_BILL);
    expectError((await record(xena, randomUUID(), today)).error, NO_SUCH_BILL);
    const anon = await anonClient().rpc(
      "record_bill_payment",
      recordArgs(bill, today),
    );
    expect(anon.error).not.toBeNull();
  });

  it("reopens a period when its expense is deleted, and refuses to restore it once recorded again (D7)", async () => {
    const id = await addBill(olive, H, { title: "Maid", firstDueOn: today });
    const first = await recordOk(olive, id, today);
    expect(
      (await olive.client.rpc("delete_expense", { target_expense_id: first }))
        .error,
    ).toBeNull();
    const reopened = await billOf(olive, id, H);
    expect(reopened.periods.find((p) => p.dueOn === today)).toMatchObject({
      status: "open",
      deletedExpenseCount: 1,
    });
    const second = await recordOk(pat, id, today, { amount: 90000 });
    expect(second).not.toBe(first);
    expectError(
      (await olive.client.rpc("restore_expense", { target_expense_id: first }))
        .error,
      RESTORE_CONFLICT,
    );
    // Deleting the second makes restoring the first possible again.
    expect(
      (await olive.client.rpc("delete_expense", { target_expense_id: second }))
        .error,
    ).toBeNull();
    expect(
      (await olive.client.rpc("restore_expense", { target_expense_id: first }))
        .error,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Skipping, pausing, resuming, ending
// ---------------------------------------------------------------------------

describe("the lifecycle", () => {
  it("skips a period without an expense, refuses repeats, and undoes it", async () => {
    const id = await addBill(pat, H, {
      title: "Gym",
      payer: pat,
      firstDueOn: addMonths(today, -1),
    });
    const due = addMonths(today, -1);
    const before = await expenseCount(H);
    expect(
      (
        await pat.client.rpc("skip_bill_occurrence", {
          target_bill_id: id,
          occurrence_due_on: due,
        })
      ).error,
    ).toBeNull();
    expect(await expenseCount(H)).toBe(before);
    const skipped = (await billOf(olive, id, H)).periods.find(
      (p) => p.dueOn === due,
    );
    expect(skipped).toMatchObject({
      status: "skipped",
      expense: null,
      skippedBy: pat.id,
    });
    expect(
      (await billsOf(olive, H)).open.some(
        (o) => o.billId === id && o.dueOn === due,
      ),
    ).toBe(false);

    expectError(
      (
        await pat.client.rpc("skip_bill_occurrence", {
          target_bill_id: id,
          occurrence_due_on: due,
        })
      ).error,
      SKIP_STATE,
    );
    expectError((await record(pat, id, due)).error, SKIP_STATE);
    // Quin didn't add it, doesn't pay it and isn't the owner (D27).
    expectError(
      (
        await quin.client.rpc("unskip_bill_occurrence", {
          target_bill_id: id,
          occurrence_due_on: due,
        })
      ).error,
      PERMISSION_DENIED,
    );

    expect(
      (
        await olive.client.rpc("unskip_bill_occurrence", {
          target_bill_id: id,
          occurrence_due_on: due,
        })
      ).error,
    ).toBeNull();
    expectError(
      (
        await olive.client.rpc("unskip_bill_occurrence", {
          target_bill_id: id,
          occurrence_due_on: due,
        })
      ).error,
      SKIP_STATE,
    );
    const expense = await recordOk(pat, id, due);
    expectError(
      (
        await pat.client.rpc("skip_bill_occurrence", {
          target_bill_id: id,
          occurrence_due_on: due,
        })
      ).error,
      ALREADY_RECORDED,
    );
    // A deleted expense can't come back over a skip either.
    expect(
      (await pat.client.rpc("delete_expense", { target_expense_id: expense }))
        .error,
    ).toBeNull();
    expect(
      (
        await pat.client.rpc("skip_bill_occurrence", {
          target_bill_id: id,
          occurrence_due_on: due,
        })
      ).error,
    ).toBeNull();
    expectError(
      (
        await olive.client.rpc("restore_expense", {
          target_expense_id: expense,
        })
      ).error,
      RESTORE_CONFLICT,
    );

    const types = (
      await admin
        .from("activity_events")
        .select("type")
        .eq("entity_id", id)
        .order("created_at")
    ).data?.map((e) => e.type);
    expect(types).toEqual([
      "bill_created",
      "bill_skipped",
      "bill_unskipped",
      "bill_skipped",
    ]);
  });

  it("pauses: periods that came stay open, no new one comes, and nothing ahead can be recorded", async () => {
    const first = addDays(today, -14);
    const id = await addBill(olive, H, {
      title: "Milk",
      unit: "week",
      firstDueOn: first,
    });
    expect(
      (await olive.client.rpc("pause_recurring_bill", { target_bill_id: id }))
        .error,
    ).toBeNull();
    expect((await storedPeriods(id)).map((p) => p.due_on)).toEqual([
      first,
      addDays(first, 7),
      today,
    ]);
    const data = await billsOf(pat, H);
    const summary = data.bills.find((b) => b.id === id)!;
    expect([summary.paused, summary.nextDueOn]).toEqual([true, null]);
    expect(
      data.open.filter((o) => o.billId === id).map((o) => o.dueOn),
    ).toEqual([first, addDays(first, 7), today]);
    expectError(
      (await olive.client.rpc("pause_recurring_bill", { target_bill_id: id }))
        .error,
      BILL_STATE,
    );
    expectError(
      (await record(olive, id, addDays(today, 7))).error,
      NO_SUCH_PERIOD,
    );
    expect(await recordOk(olive, id, first)).toBeTruthy();
  });

  it("resumes from the next date on the schedule: periods while paused never come", async () => {
    const id = await addBill(olive, H, {
      title: "Papers",
      unit: "week",
      firstDueOn: addDays(today, 3),
    });
    expect(
      (await olive.client.rpc("pause_recurring_bill", { target_bill_id: id }))
        .error,
    ).toBeNull();
    // Five weeks pass while it's paused: the same as its schedule starting
    // five weeks earlier (a fixture change, service role).
    const { error } = await admin
      .from("recurring_bills")
      .update({ anchor_on: addDays(today, 3 - 35) })
      .eq("id", id);
    if (error) throw error;
    expectError(
      (await quin.client.rpc("resume_recurring_bill", { target_bill_id: id }))
        .error,
      PERMISSION_DENIED,
    );
    expect(
      (await olive.client.rpc("resume_recurring_bill", { target_bill_id: id }))
        .error,
    ).toBeNull();
    const detail = await billOf(olive, id, H);
    expect(detail.bill.nextDueOn).toBe(addDays(today, 3));
    expect(detail.periods.map((p) => p.status)).toEqual(["upcoming"]);
    expect(await storedPeriods(id)).toEqual([]);
    expectError(
      (await olive.client.rpc("resume_recurring_bill", { target_bill_id: id }))
        .error,
      BILL_STATE,
    );
  });

  it("ends: nothing after today, history kept, refused twice", async () => {
    const first = addMonths(today, -1);
    const id = await addBill(olive, H, { title: "Netflix", firstDueOn: first });
    await recordOk(olive, id, first);
    expectError(
      (await quin.client.rpc("end_recurring_bill", { target_bill_id: id }))
        .error,
      PERMISSION_DENIED,
    );
    expect(
      (await olive.client.rpc("end_recurring_bill", { target_bill_id: id }))
        .error,
    ).toBeNull();
    const detail = await billOf(olive, id, H);
    expect(detail.bill.endsOn).toBe(today);
    expect(detail.bill.nextDueOn).toBeNull();
    expect(detail.periods.find((p) => p.dueOn === first)?.status).toBe(
      "recorded",
    );
    expect(detail.periods.every((p) => p.dueOn <= today)).toBe(true);
    expectError(
      (await olive.client.rpc("end_recurring_bill", { target_bill_id: id }))
        .error,
      BILL_STATE,
    );
    expectError(
      (await olive.client.rpc("pause_recurring_bill", { target_bill_id: id }))
        .error,
      BILL_STATE,
    );
  });

  it("never goes past its last due date", async () => {
    const first = addMonths(today, -3);
    const id = await addBill(olive, H, {
      title: "Course",
      firstDueOn: first,
      lastDueOn: addMonths(today, -2),
    });
    const data = await billsOf(olive, H);
    expect(
      data.open.filter((o) => o.billId === id).map((o) => o.dueOn),
    ).toEqual([first, dueDate(first, "month", 1, 1)]);
    expect(data.bills.find((b) => b.id === id)?.nextDueOn).toBeNull();
    expectError(
      (await record(olive, id, dueDate(first, "month", 1, 2))).error,
      NO_SUCH_PERIOD,
    );
  });
});

// ---------------------------------------------------------------------------
// Changing a bill (D10: future periods only)
// ---------------------------------------------------------------------------

describe("changing a bill", () => {
  it("keeps periods that have come, and recorded expenses, exactly as they were", async () => {
    const first = addMonths(today, -2);
    const id = await addBill(olive, H, {
      title: "Rent",
      amount: 2000000,
      firstDueOn: first,
    });
    const paid = await recordOk(olive, id, first, { amount: 2000000 });
    const expenseBefore = (
      await admin.from("expenses").select("*").eq("id", paid).single()
    ).data;
    const loaded = await billOf(olive, id, H);

    // New details: a higher rent from now on, Pat pays it.
    const update = await olive.client.rpc("update_recurring_bill", {
      target_bill_id: id,
      title: "Rent",
      amount: 2100000,
      bill_category: "rent",
      bill_payer_id: pat.id,
      method: "equal",
      shares: equalShares(2100000, [olive, pat]),
      expected_updated_at: loaded.bill.updatedAt,
    });
    expect(update.error).toBeNull();
    const after = await billOf(olive, id, H);
    // Periods that had come were stored first with the old amount.
    for (const period of after.periods.filter(
      (p) => p.dueOn <= today && p.status !== "recorded",
    )) {
      expect(period.expectedMinor, period.dueOn).toBe(BigInt(2000000));
    }
    expect(
      after.periods.find((p) => p.status === "upcoming")?.expectedMinor,
    ).toBe(BigInt(2100000));
    expect(
      (await admin.from("expenses").select("*").eq("id", paid).single()).data,
    ).toEqual(expenseBefore);

    // A stale form, a payer outside, an end before a stored period.
    const base = {
      target_bill_id: id,
      title: "Rent",
      amount: 2100000,
      bill_category: "rent" as const,
      bill_payer_id: pat.id,
      method: "equal" as const,
      shares: equalShares(2100000, [olive, pat]),
    };
    expectError(
      (
        await olive.client.rpc("update_recurring_bill", {
          ...base,
          expected_updated_at: loaded.bill.updatedAt,
        })
      ).error,
      BILL_CHANGED,
    );
    expectError(
      (
        await olive.client.rpc("update_recurring_bill", {
          ...base,
          bill_payer_id: xena.id,
        })
      ).error,
      NOT_ACTIVE_MEMBER,
    );
    expectError(
      (
        await olive.client.rpc("update_recurring_bill", {
          ...base,
          last_due_on: addDays(first, 1),
        })
      ).error,
      BAD_SCHEDULE,
    );
    expectError(
      (await quin.client.rpc("update_recurring_bill", base)).error,
      PERMISSION_DENIED,
    );

    const { data: events } = await admin
      .from("activity_events")
      .select("type, summary")
      .eq("entity_id", id)
      .eq("type", "bill_updated");
    expect(events).toHaveLength(1);
    expect(events?.[0].summary).toMatchObject({
      before: { amount_minor: 2000000, payer_id: olive.id },
      after: { amount_minor: 2100000, payer_id: pat.id },
    });
  });

  it("moves the schedule from a new next due date, keeping the old periods' dates", async () => {
    const first = addMonths(today, -2);
    const id = await addBill(olive, H, {
      title: "Water can",
      firstDueOn: first,
    });
    const oldOpen = (await billsOf(olive, H)).open
      .filter((o) => o.billId === id)
      .map((o) => o.dueOn);
    const reschedule = (next: string) =>
      olive.client.rpc("reschedule_recurring_bill", {
        target_bill_id: id,
        repeat_unit: "week",
        repeat_every: 2,
        next_due_on: next,
      });
    expectError((await reschedule(addDays(today, -1))).error, BAD_SCHEDULE);
    expect((await reschedule(addDays(today, 1))).error).toBeNull();

    const detail = await billOf(olive, id, H);
    expect(detail.bill).toMatchObject({
      frequency: "week",
      every: 2,
      anchorOn: addDays(today, 1),
    });
    expect(detail.bill.nextDueOn).toBe(addDays(today, 1));
    // Every period that had come is stored with its old date, still open.
    expect((await storedPeriods(id)).map((p) => p.due_on)).toEqual(oldOpen);
    expect(
      detail.periods
        .filter((p) => p.status === "open")
        .map((p) => p.dueOn)
        .sort(),
    ).toEqual(oldOpen);
    // Not before or on a stored period.
    expectError((await reschedule(oldOpen.at(-1)!)).error, BAD_SCHEDULE);
  });
});

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

describe("access", () => {
  let bill: string;
  beforeAll(async () => {
    bill = await addBill(olive, H, {
      title: "Secret rent",
      firstDueOn: addMonths(today, -1),
    });
    await recordOk(olive, bill, addMonths(today, -1));
  });

  it("shows nothing to anyone outside the household", async () => {
    expectError(
      (await xena.client.rpc("household_bills", { target_household_id: H }))
        .error,
      PERMISSION_DENIED,
    );
    expectError(
      (
        await xena.client.rpc("household_bills", {
          target_household_id: randomUUID(),
        })
      ).error,
      PERMISSION_DENIED,
    );
    expectError(
      (await xena.client.rpc("recurring_bill", { target_bill_id: bill })).error,
      NO_SUCH_BILL,
    );
    for (const table of [
      "recurring_bills",
      "recurring_bill_shares",
      "bill_occurrences",
    ] as const) {
      const { data } = await xena.client
        .from(table)
        .select("household_id")
        .eq("household_id", H);
      expect(data, table).toEqual([]);
    }
    const anon = await anonClient().rpc("household_bills", {
      target_household_id: H,
    });
    expect(anon.error).not.toBeNull();
  });

  it("lets nobody change bills or periods directly, not even the service role", async () => {
    const insert = await olive.client.from("recurring_bills").insert({
      household_id: H,
      description: "Direct",
      amount_minor: 1,
      category: "other",
      payer_id: olive.id,
      split_method: "equal",
      frequency: "month",
      interval_count: 1,
      anchor_on: today,
      created_by: olive.id,
    });
    expectError(insert.error, PERMISSION_DENIED);
    const period = await olive.client
      .from("bill_occurrences")
      .update({ skipped_at: null })
      .eq("bill_id", bill);
    expectError(period.error, PERMISSION_DENIED);
    const link = await olive.client
      .from("expenses")
      .update({ recurring_bill_id: null })
      .eq("recurring_bill_id", bill);
    expectError(link.error, PERMISSION_DENIED);

    const move = await admin
      .from("bill_occurrences")
      .update({ due_on: today })
      .eq("bill_id", bill);
    expectError(move.error, PERMISSION_DENIED);
    const del = await admin
      .from("bill_occurrences")
      .delete()
      .eq("bill_id", bill);
    expectError(del.error, PERMISSION_DENIED);
  });

  it("can't link an expense to another household's period, or to a date that isn't one", async () => {
    const theirs = await addBill(xena, X, {
      title: "Theirs",
      payer: xena,
      people: [xena],
      firstDueOn: addMonths(todayIn(TZ), -1),
    });
    const recorded = await xena.client.rpc("record_bill_payment", {
      ...recordArgs(theirs, addMonths(todayIn(TZ), -1), {
        payer: xena,
        people: [xena],
      }),
    });
    if (recorded.error) throw recorded.error;
    // Their period is free again (its expense is deleted), so only the
    // household check in the foreign key stands in the way below.
    const deleted = await xena.client.rpc("delete_expense", {
      target_expense_id: recorded.data,
    });
    expect(deleted.error).toBeNull();
    const ours = (await linkedExpenses(bill))[0].id;
    // Even with the service role, the foreign key keeps an expense to its own
    // household's real periods.
    const forged = await admin
      .from("expenses")
      .update({
        recurring_bill_id: theirs,
        recurrence_period: addMonths(todayIn(TZ), -1),
      })
      .eq("id", ours);
    expectError(forged.error, FOREIGN_KEY_VIOLATION);
    const notAPeriod = await admin
      .from("expenses")
      .update({ recurrence_period: addDays(today, 5) })
      .eq("id", ours);
    expectError(notAPeriod.error, FOREIGN_KEY_VIOLATION);
  });

  it("ends access for someone removed", async () => {
    const R = await household(olive, "Removal home");
    await join(olive, R, raj);
    const id = await addBill(raj, R, {
      payer: raj,
      people: [raj],
      firstDueOn: today,
    });
    expect((await billsOf(raj, R)).bills.map((b) => b.id)).toEqual([id]);
    const removed = await olive.client.rpc("remove_member", {
      target_household_id: R,
      member_user_id: raj.id,
    });
    expect(removed.error).toBeNull();
    expectError(
      (await raj.client.rpc("household_bills", { target_household_id: R }))
        .error,
      PERMISSION_DENIED,
    );
    expectError(
      (await raj.client.rpc("recurring_bill", { target_bill_id: id })).error,
      NO_SUCH_BILL,
    );
    expectError(
      (await raj.client.rpc("pause_recurring_bill", { target_bill_id: id }))
        .error,
      NO_SUCH_BILL,
    );
    // The bill stays: Raj was its payer, and the owner can still manage it.
    expect(
      (await olive.client.rpc("pause_recurring_bill", { target_bill_id: id }))
        .error,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Money, the journal and deleting the household
// ---------------------------------------------------------------------------

describe("money", () => {
  it("doesn't move until a period is recorded, then moves by exactly that expense", async () => {
    const M = await household(olive, "Money home");
    await join(olive, M, pat);
    const settled = await pat.client.rpc("record_settlement", {
      target_household_id: M,
      payer_id: pat.id,
      recipient_id: olive.id,
      amount: 500,
      paid_on: today,
      acknowledged_owed: 0,
    });
    if (settled.error) throw settled.error;
    const start = await balances(pat, M);
    const settlementsBefore = (
      await admin.from("settlements").select("*").eq("household_id", M)
    ).data;

    // Bills, overdue periods, a skip and a pause: no money.
    const first = addMonths(today, -2);
    const id = await addBill(olive, M, { firstDueOn: first });
    const other = await addBill(pat, M, {
      payer: pat,
      firstDueOn: addDays(today, -7),
      unit: "week",
    });
    await pat.client.rpc("skip_bill_occurrence", {
      target_bill_id: other,
      occurrence_due_on: addDays(today, -7),
    });
    await pat.client.rpc("pause_recurring_bill", { target_bill_id: other });
    expect(await balances(pat, M)).toEqual(start);
    expect(await expenseCount(M)).toBe(0);

    // Recording one period: one expense, and the balances move by it.
    await recordOk(olive, id, first, { amount: 100000 });
    const after = (await balances(pat, M)) as {
      expense_count: number;
      total_minor: string;
      people: { user_id: string; net_minor: string }[];
    };
    expect(after.expense_count).toBe(1);
    expect(after.total_minor).toBe("100000");
    const net = (uid: string) =>
      BigInt(after.people.find((p) => p.user_id === uid)!.net_minor) -
      BigInt(
        (start as typeof after).people.find((p) => p.user_id === uid)!
          .net_minor,
      );
    expect([net(olive.id), net(pat.id)]).toEqual([
      BigInt(50000),
      BigInt(-50000),
    ]);
    expect(
      (await admin.from("settlements").select("*").eq("household_id", M)).data,
    ).toEqual(settlementsBefore);
  });
});

describe("the journal", () => {
  it("records each change to a bill, under the Bills filter", async () => {
    const J = await household(olive, "Journal bills");
    await join(olive, J, pat);
    const id = await addBill(olive, J, { firstDueOn: addMonths(today, -1) });
    await olive.client.rpc("skip_bill_occurrence", {
      target_bill_id: id,
      occurrence_due_on: addMonths(today, -1),
    });
    await olive.client.rpc("unskip_bill_occurrence", {
      target_bill_id: id,
      occurrence_due_on: addMonths(today, -1),
    });
    await olive.client.rpc("pause_recurring_bill", { target_bill_id: id });
    await olive.client.rpc("resume_recurring_bill", { target_bill_id: id });
    await olive.client.rpc("end_recurring_bill", { target_bill_id: id });
    const { data, error } = await pat.client.rpc("household_journal", {
      target_household_id: J,
      category_filter: "bills",
    });
    if (error) throw error;
    const page = parseJournalPayload(data);
    expect(page).not.toBeNull();
    expect(
      checkJournal(page!, {
        householdId: J,
        filter: "bills",
        before: null,
        pageSize: 25,
      }),
    ).toEqual({ ok: true });
    expect(page!.entries.map((e) => e.detail.type)).toEqual([
      "bill_ended",
      "bill_resumed",
      "bill_paused",
      "bill_unskipped",
      "bill_skipped",
      "bill_created",
    ]);
    expect(page!.entries[0].entity).toEqual({
      available: true,
      id,
      state: "ended",
    });
    // Notes never reach the journal.
    expect(JSON.stringify(data)).not.toContain('"notes"');
  });
});

describe("deleting the household", () => {
  it("removes its bills, periods and recorded expenses with it (D14)", async () => {
    const D = await household(raj, "Short-lived");
    const first = addDays(today, -7);
    const id = await addBill(raj, D, {
      payer: raj,
      people: [raj],
      unit: "week",
      firstDueOn: first,
    });
    await recordOk(raj, id, first, { payer: raj, people: [raj] });
    const skip = await raj.client.rpc("skip_bill_occurrence", {
      target_bill_id: id,
      occurrence_due_on: today,
    });
    expect(skip.error).toBeNull();
    const { error } = await raj.client.rpc("delete_household", {
      target_household_id: D,
    });
    expect(error).toBeNull();
    for (const table of [
      "recurring_bills",
      "bill_occurrences",
      "expenses",
    ] as const) {
      const { data } = await admin
        .from(table)
        .select("household_id")
        .eq("household_id", D);
      expect(data, table).toEqual([]);
    }
  });
});
