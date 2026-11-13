// Reads what public.household_analytics returns and checks it before
// anything is shown. Money arrives as text and becomes BigInt; every check
// that the parts add up is exact.

import { z } from "zod";
import {
  CATEGORY_VALUES,
  type ExpenseCategory,
} from "@/lib/expenses/categories";
import { addDays, addMonths } from "@/lib/bills/schedule";
import { periodStart } from "@/lib/budgets/period";

const id = z.uuid();
const date = z.iso.date();
const nonNegative = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform((value) => BigInt(value));
const positive = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform((value) => BigInt(value));
const count = z.number().int().min(0);

const schema = z.strictObject({
  from: date,
  to: date,
  previous_from: date,
  previous_to: date,
  bucket: z.enum(["day", "week", "month"]),
  total_minor: nonNegative,
  expense_count: count,
  previous_total_minor: nonNegative,
  previous_count: count,
  by_category: z.array(
    z.strictObject({
      category: z.enum(CATEGORY_VALUES),
      total_minor: positive,
      expense_count: count,
    }),
  ),
  trend: z.array(
    z.strictObject({
      start: date,
      total_minor: nonNegative,
      expense_count: count,
    }),
  ),
  members: z.array(
    z.strictObject({
      user_id: id,
      paid_minor: nonNegative,
      paid_count: count,
      share_minor: nonNegative,
    }),
  ),
  largest: z.array(
    z.strictObject({
      expense_id: id,
      description: z.string(),
      amount_minor: positive,
      category: z.enum(CATEGORY_VALUES),
      expense_date: date,
      paid_by: id,
    }),
  ),
  people: z.array(
    z.strictObject({
      user_id: id,
      display_name: z.string(),
      is_active: z.boolean(),
    }),
  ),
});

export type Bucket = "day" | "week" | "month";

export type Analytics = {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  bucket: Bucket;
  totalMinor: bigint;
  expenseCount: number;
  previousTotalMinor: bigint;
  previousCount: number;
  /** Biggest first. */
  byCategory: {
    category: ExpenseCategory;
    totalMinor: bigint;
    expenseCount: number;
  }[];
  /** Every bucket in the range, oldest first, empty ones included. */
  trend: { start: string; totalMinor: bigint; expenseCount: number }[];
  /** Paid (at the till) and share (their part of the splits), kept apart. */
  members: {
    userId: string;
    paidMinor: bigint;
    paidCount: number;
    shareMinor: bigint;
  }[];
  /** Biggest first, at most ten. */
  largest: {
    id: string;
    description: string;
    amountMinor: bigint;
    category: ExpenseCategory;
    expenseDate: string;
    paidBy: string;
  }[];
  people: { userId: string; displayName: string; isActive: boolean }[];
};

export function parseAnalytics(payload: unknown): Analytics | null {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return null;
  const d = parsed.data;
  return {
    from: d.from,
    to: d.to,
    previousFrom: d.previous_from,
    previousTo: d.previous_to,
    bucket: d.bucket,
    totalMinor: d.total_minor,
    expenseCount: d.expense_count,
    previousTotalMinor: d.previous_total_minor,
    previousCount: d.previous_count,
    byCategory: d.by_category.map((c) => ({
      category: c.category,
      totalMinor: c.total_minor,
      expenseCount: c.expense_count,
    })),
    trend: d.trend.map((t) => ({
      start: t.start,
      totalMinor: t.total_minor,
      expenseCount: t.expense_count,
    })),
    members: d.members.map((m) => ({
      userId: m.user_id,
      paidMinor: m.paid_minor,
      paidCount: m.paid_count,
      shareMinor: m.share_minor,
    })),
    largest: d.largest.map((l) => ({
      id: l.expense_id,
      description: l.description,
      amountMinor: l.amount_minor,
      category: l.category,
      expenseDate: l.expense_date,
      paidBy: l.paid_by,
    })),
    people: d.people.map((p) => ({
      userId: p.user_id,
      displayName: p.display_name,
      isActive: p.is_active,
    })),
  };
}

/** The first day of the bucket after the one starting on `start`. */
export function nextBucket(start: string, bucket: Bucket): string {
  if (bucket === "day") return addDays(start, 1);
  if (bucket === "week") return addDays(start, 7);
  return addMonths(start, 1);
}

export type AnalyticsCheckCode =
  | "range_mismatch"
  | "category_mismatch"
  | "trend_mismatch"
  | "member_mismatch"
  | "largest_mismatch";

export type AnalyticsCheck =
  { ok: true } | { ok: false; code: AnalyticsCheckCode };

const fail = (code: AnalyticsCheckCode): AnalyticsCheck => ({
  ok: false,
  code,
});
const sum = (values: bigint[]) => values.reduce((a, b) => a + b, BigInt(0));

/**
 * Checks the figures before they're shown: the range is the one asked for;
 * the categories, the buckets, what people paid and their shares each add up
 * exactly to the total, with the same number of expenses; the buckets are
 * consecutive and cover the range; each category and person appears once;
 * the largest expenses are in order, inside the range, and no bigger than
 * the total. Any difference, and the page shows nothing rather than numbers
 * that disagree.
 */
export function checkAnalytics(
  data: Analytics,
  asked: {
    from: string;
    to: string;
    compareFrom: string | null;
    compareTo: string | null;
    category: ExpenseCategory | null;
    payer: string | null;
  },
): AnalyticsCheck {
  if (data.from !== asked.from || data.to !== asked.to)
    return fail("range_mismatch");
  if (
    asked.compareFrom !== null &&
    (data.previousFrom !== asked.compareFrom ||
      data.previousTo !== asked.compareTo)
  ) {
    return fail("range_mismatch");
  }
  if (data.previousTo >= data.from) return fail("range_mismatch");

  const categories = new Set(data.byCategory.map((c) => c.category));
  if (
    categories.size !== data.byCategory.length ||
    sum(data.byCategory.map((c) => c.totalMinor)) !== data.totalMinor ||
    data.byCategory.reduce((n, c) => n + c.expenseCount, 0) !==
      data.expenseCount ||
    (asked.category !== null &&
      data.byCategory.some((c) => c.category !== asked.category))
  ) {
    return fail("category_mismatch");
  }

  const first =
    data.bucket === "day"
      ? data.from
      : data.bucket === "week"
        ? periodStart(data.from, "week")
        : periodStart(data.from, "month");
  if (
    data.trend.length === 0 ||
    data.trend[0].start !== first ||
    nextBucket(data.trend.at(-1)!.start, data.bucket) <= data.to ||
    data.trend.some(
      (t, i) =>
        i > 0 && t.start !== nextBucket(data.trend[i - 1].start, data.bucket),
    ) ||
    sum(data.trend.map((t) => t.totalMinor)) !== data.totalMinor ||
    data.trend.reduce((n, t) => n + t.expenseCount, 0) !== data.expenseCount
  ) {
    return fail("trend_mismatch");
  }

  const members = new Set(data.members.map((m) => m.userId));
  if (
    members.size !== data.members.length ||
    sum(data.members.map((m) => m.paidMinor)) !== data.totalMinor ||
    sum(data.members.map((m) => m.shareMinor)) !== data.totalMinor ||
    data.members.reduce((n, m) => n + m.paidCount, 0) !== data.expenseCount ||
    (asked.payer !== null &&
      data.members.some(
        (m) => m.paidMinor > BigInt(0) && m.userId !== asked.payer,
      ))
  ) {
    return fail("member_mismatch");
  }

  if (
    data.largest.length > Math.min(10, data.expenseCount) ||
    (data.expenseCount > 0 && data.largest.length === 0) ||
    data.largest.some(
      (l, i) =>
        l.expenseDate < data.from ||
        l.expenseDate > data.to ||
        (i > 0 && l.amountMinor > data.largest[i - 1].amountMinor) ||
        (asked.category !== null && l.category !== asked.category) ||
        (asked.payer !== null && l.paidBy !== asked.payer),
    ) ||
    sum(data.largest.map((l) => l.amountMinor)) > data.totalMinor
  ) {
    return fail("largest_mismatch");
  }
  return { ok: true };
}
