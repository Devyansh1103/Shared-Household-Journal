// Reads what public.household_bills and public.recurring_bill return, and
// checks it before anything is shown (as the expense history and the journal
// do). Money arrives as text and becomes BigInt.

import { z } from "zod";
import type { SplitMethod } from "@/domain/money/split";
import {
  CATEGORY_VALUES,
  type ExpenseCategory,
} from "@/lib/expenses/categories";
import { BILL_FREQUENCIES, type BillFrequency } from "./schedule";

const id = z.uuid();
const date = z.iso.date();
const amount = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform((value) => BigInt(value));
const nonNegative = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform((value) => BigInt(value));
const SPLIT_METHOD_VALUES = [
  "equal",
  "percentage",
  "custom",
] as const satisfies readonly SplitMethod[];

const person = z.strictObject({
  user_id: id,
  display_name: z.string(),
  is_active: z.boolean(),
});

const billShape = {
  bill_id: id,
  household_id: id,
  description: z.string(),
  amount_minor: amount,
  category: z.enum(CATEGORY_VALUES),
  payer_id: id,
  frequency: z.enum(BILL_FREQUENCIES),
  interval_count: z.number().int().min(1).max(52),
  ends_on: date.nullable(),
  paused: z.boolean(),
  created_by: id,
  next_due_on: date.nullable(),
};

const householdBillsSchema = z.strictObject({
  today: date,
  bills: z.array(z.strictObject(billShape)),
  open: z.array(
    z.strictObject({
      bill_id: id,
      due_on: date,
      expected_amount_minor: amount,
      stored: z.boolean(),
    }),
  ),
  paid_recently: z.array(
    z.strictObject({
      bill_id: id,
      due_on: date,
      expense_id: id,
      amount_minor: amount,
      expense_date: date,
      paid_by: id,
    }),
  ),
  people: z.array(person),
});

const billDetailSchema = z.strictObject({
  today: date,
  bill: z.strictObject({
    ...billShape,
    notes: z.string().nullable(),
    split_method: z.enum(SPLIT_METHOD_VALUES),
    anchor_on: date,
    paused_at: z.string().nullable(),
    paused_by: id.nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    cursor_due_on: date,
    latest_stored_due_on: date.nullable(),
  }),
  shares: z.array(
    z.strictObject({
      user_id: id,
      percentage_bp: z.number().int().min(0).max(10000).nullable(),
      share_minor: nonNegative.nullable(),
    }),
  ),
  periods: z.array(
    z.strictObject({
      due_on: date,
      stored: z.boolean(),
      expected_amount_minor: amount,
      status: z.enum(["upcoming", "open", "recorded", "skipped"]),
      expense: z
        .strictObject({
          expense_id: id,
          amount_minor: amount,
          expense_date: date,
          paid_by: id,
        })
        .nullable(),
      deleted_expense_count: z.number().int().min(0),
      skipped_at: z.string().nullable(),
      skipped_by: id.nullable(),
    }),
  ),
  stored_count: z.number().int().min(0),
  people: z.array(person),
});

export type BillPerson = {
  userId: string;
  displayName: string;
  /** False for someone who has left (D13). */
  isActive: boolean;
};

export type BillSummary = {
  id: string;
  householdId: string;
  description: string;
  /** Expected, in minor units of the household's currency. */
  amountMinor: bigint;
  category: ExpenseCategory;
  payerId: string;
  frequency: BillFrequency;
  every: number;
  endsOn: string | null;
  paused: boolean;
  createdBy: string;
  /** The next period after today; null while paused or once it has ended. */
  nextDueOn: string | null;
};

export type OpenPeriod = {
  billId: string;
  dueOn: string;
  expectedMinor: bigint;
  /** Stored in the database (false: worked out from the schedule). */
  stored: boolean;
};

export type PaidPeriod = {
  billId: string;
  dueOn: string;
  expenseId: string;
  amountMinor: bigint;
  expenseDate: string;
  paidBy: string;
};

export type HouseholdBills = {
  /** The household's date (D11). */
  today: string;
  bills: BillSummary[];
  open: OpenPeriod[];
  paidRecently: PaidPeriod[];
  people: BillPerson[];
};

export type PeriodStatus = "upcoming" | "open" | "recorded" | "skipped";

export type BillPeriod = {
  dueOn: string;
  stored: boolean;
  expectedMinor: bigint;
  status: PeriodStatus;
  expense: {
    id: string;
    amountMinor: bigint;
    expenseDate: string;
    paidBy: string;
  } | null;
  deletedExpenseCount: number;
  skippedAt: string | null;
  skippedBy: string | null;
};

export type BillDetail = {
  today: string;
  bill: BillSummary & {
    notes: string | null;
    splitMethod: SplitMethod;
    anchorOn: string;
    pausedAt: string | null;
    pausedBy: string | null;
    createdAt: string;
    updatedAt: string;
    /** Where the current schedule's cursor is (for a new schedule's default). */
    cursorDueOn: string;
    latestStoredDueOn: string | null;
  };
  shares: {
    userId: string;
    percentageBp: number | null;
    shareMinor: bigint | null;
  }[];
  /** Newest first: the next period, open ones, then the stored history. */
  periods: BillPeriod[];
  storedCount: number;
  people: BillPerson[];
};

type RawBill = z.infer<z.ZodObject<typeof billShape>>;

function summary(row: RawBill): BillSummary {
  return {
    id: row.bill_id,
    householdId: row.household_id,
    description: row.description,
    amountMinor: row.amount_minor,
    category: row.category,
    payerId: row.payer_id,
    frequency: row.frequency,
    every: row.interval_count,
    endsOn: row.ends_on,
    paused: row.paused,
    createdBy: row.created_by,
    nextDueOn: row.next_due_on,
  };
}

function people(rows: z.infer<typeof person>[]): BillPerson[] {
  return rows.map((p) => ({
    userId: p.user_id,
    displayName: p.display_name,
    isActive: p.is_active,
  }));
}

export function parseHouseholdBills(payload: unknown): HouseholdBills | null {
  const parsed = householdBillsSchema.safeParse(payload);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    today: data.today,
    bills: data.bills.map(summary),
    open: data.open.map((o) => ({
      billId: o.bill_id,
      dueOn: o.due_on,
      expectedMinor: o.expected_amount_minor,
      stored: o.stored,
    })),
    paidRecently: data.paid_recently.map((p) => ({
      billId: p.bill_id,
      dueOn: p.due_on,
      expenseId: p.expense_id,
      amountMinor: p.amount_minor,
      expenseDate: p.expense_date,
      paidBy: p.paid_by,
    })),
    people: people(data.people),
  };
}

export function parseBillDetail(payload: unknown): BillDetail | null {
  const parsed = billDetailSchema.safeParse(payload);
  if (!parsed.success) return null;
  const { bill, ...data } = parsed.data;
  return {
    today: data.today,
    bill: {
      ...summary(bill),
      notes: bill.notes,
      splitMethod: bill.split_method,
      anchorOn: bill.anchor_on,
      pausedAt: bill.paused_at,
      pausedBy: bill.paused_by,
      createdAt: bill.created_at,
      updatedAt: bill.updated_at,
      cursorDueOn: bill.cursor_due_on,
      latestStoredDueOn: bill.latest_stored_due_on,
    },
    shares: data.shares.map((s) => ({
      userId: s.user_id,
      percentageBp: s.percentage_bp,
      shareMinor: s.share_minor,
    })),
    periods: data.periods.map((p) => ({
      dueOn: p.due_on,
      stored: p.stored,
      expectedMinor: p.expected_amount_minor,
      status: p.status,
      expense: p.expense
        ? {
            id: p.expense.expense_id,
            amountMinor: p.expense.amount_minor,
            expenseDate: p.expense.expense_date,
            paidBy: p.expense.paid_by,
          }
        : null,
      deletedExpenseCount: p.deleted_expense_count,
      skippedAt: p.skipped_at,
      skippedBy: p.skipped_by,
    })),
    storedCount: data.stored_count,
    people: people(data.people),
  };
}

export type BillsCheckCode =
  | "foreign_bill"
  | "unknown_bill"
  | "duplicate_period"
  | "order_mismatch"
  | "period_mismatch";

export type BillsCheck = { ok: true } | { ok: false; code: BillsCheckCode };

const fail = (code: BillsCheckCode): BillsCheck => ({ ok: false, code });

/**
 * Checks the bills page's data before it's shown: every bill is this
 * household's; every period belongs to one of them, once; open periods are
 * oldest first and have come (on or before today) unless stored early; a
 * bill's next period is after today; recorded ones belong to a bill.
 */
export function checkHouseholdBills(
  data: HouseholdBills,
  householdId: string,
): BillsCheck {
  const bills = new Map(data.bills.map((b) => [b.id, b]));
  if (bills.size !== data.bills.length) return fail("duplicate_period");
  if (data.bills.some((b) => b.householdId !== householdId)) {
    return fail("foreign_bill");
  }
  const seen = new Set<string>();
  for (const [i, period] of data.open.entries()) {
    if (!bills.has(period.billId)) return fail("unknown_bill");
    const key = `${period.billId}|${period.dueOn}`;
    if (seen.has(key)) return fail("duplicate_period");
    seen.add(key);
    if (i > 0 && data.open[i - 1].dueOn > period.dueOn) {
      return fail("order_mismatch");
    }
    if (!period.stored && period.dueOn > data.today) {
      return fail("period_mismatch");
    }
  }
  for (const bill of data.bills) {
    if (bill.nextDueOn !== null && bill.nextDueOn <= data.today) {
      return fail("period_mismatch");
    }
    if (bill.paused && bill.nextDueOn !== null) return fail("period_mismatch");
  }
  for (const paid of data.paidRecently) {
    if (!bills.has(paid.billId)) return fail("unknown_bill");
    const key = `${paid.billId}|${paid.dueOn}`;
    if (seen.has(key)) return fail("duplicate_period");
    seen.add(key);
  }
  return { ok: true };
}

/**
 * Checks one bill's periods: newest first, each due date once, a recorded
 * period has its expense and nothing else has one, a skipped one says who
 * skipped it, and an upcoming one is after today.
 */
export function checkBillDetail(
  data: BillDetail,
  householdId: string,
): BillsCheck {
  if (data.bill.householdId !== householdId) return fail("foreign_bill");
  const seen = new Set<string>();
  for (const [i, period] of data.periods.entries()) {
    if (seen.has(period.dueOn)) return fail("duplicate_period");
    seen.add(period.dueOn);
    if (i > 0 && data.periods[i - 1].dueOn < period.dueOn) {
      return fail("order_mismatch");
    }
    const recorded = period.status === "recorded";
    const skipped = period.status === "skipped";
    if (
      recorded !== (period.expense !== null) ||
      skipped !== (period.skippedAt !== null) ||
      (period.status === "upcoming" && period.dueOn <= data.today) ||
      (period.status === "open" && period.dueOn > data.today) ||
      (!period.stored && (recorded || skipped))
    ) {
      return fail("period_mismatch");
    }
  }
  return { ok: true };
}
