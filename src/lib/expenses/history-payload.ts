// Reads what public.expense_history returns and checks it before anything is
// shown. Money arrives as text and is parsed with BigInt (a household's totals
// aren't capped the way one expense is). The checks follow the balances
// pages: if the rows don't match the filters, aren't in the promised order,
// or the summary doesn't add up, the page says so instead of showing figures.

import { z } from "zod";
import { CATEGORY_VALUES, type ExpenseCategory } from "./categories";
import { isFiltered, type HistoryFilters, type HistorySort } from "./history";

const minor = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)$/)
  .transform((value) => BigInt(value));
const count = z.number().int().min(0);
const id = z.uuid();

const payloadSchema = z.object({
  total_count: count,
  total_minor: minor,
  average_minor: minor.nullable(),
  largest: z
    .object({
      expense_id: id,
      description: z.string(),
      amount_minor: minor,
      expense_date: z.iso.date(),
    })
    .nullable(),
  page: z.number().int().min(1),
  page_count: z.number().int().min(1),
  page_size: z.number().int().min(1).max(100),
  household_count: count,
  household_total_minor: minor,
  household_deleted_count: count,
  rows: z.array(
    z.object({
      expense_id: id,
      household_id: id,
      position: z.number().int().min(1),
      description: z.string(),
      amount_minor: minor,
      category: z.enum(CATEGORY_VALUES),
      expense_date: z.iso.date(),
      paid_by: id,
      payer_name: z.string().nullable(),
      payer_is_active: z.boolean(),
      created_us: minor,
      deleted_at: z.string().nullable(),
    }),
  ),
});

export type HistoryRow = {
  id: string;
  householdId: string;
  /** 1-based place in the whole ordered result. */
  position: number;
  description: string;
  amountMinor: bigint;
  category: ExpenseCategory;
  expenseDate: string;
  paidBy: string;
  payerName: string;
  /** False for someone who has left (D13): shown with "(left)". */
  payerIsActive: boolean;
  /** When it was added, in microseconds, to check the order exactly. */
  createdUs: bigint;
  deletedAt: string | null;
};

export type HistoryPage = {
  /** Matching expenses, across all pages. */
  totalCount: number;
  totalMinor: bigint;
  /** Rounded to the nearest minor unit; null when nothing matches. */
  averageMinor: bigint | null;
  largest: {
    expenseId: string;
    description: string;
    amountMinor: bigint;
    expenseDate: string;
  } | null;
  page: number;
  pageCount: number;
  pageSize: number;
  /** Every counted expense of the household, whatever the filters (D7). */
  householdCount: number;
  householdTotalMinor: bigint;
  householdDeletedCount: number;
  rows: HistoryRow[];
};

/** The payload as typed values, or null if it isn't exactly what's expected. */
export function parseHistoryPayload(payload: unknown): HistoryPage | null {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    totalCount: data.total_count,
    totalMinor: data.total_minor,
    averageMinor: data.average_minor,
    largest: data.largest
      ? {
          expenseId: data.largest.expense_id,
          description: data.largest.description,
          amountMinor: data.largest.amount_minor,
          expenseDate: data.largest.expense_date,
        }
      : null,
    page: data.page,
    pageCount: data.page_count,
    pageSize: data.page_size,
    householdCount: data.household_count,
    householdTotalMinor: data.household_total_minor,
    householdDeletedCount: data.household_deleted_count,
    rows: data.rows.map((row) => ({
      id: row.expense_id,
      householdId: row.household_id,
      position: row.position,
      description: row.description,
      amountMinor: row.amount_minor,
      category: row.category,
      expenseDate: row.expense_date,
      paidBy: row.paid_by,
      payerName: row.payer_name ?? "Former member",
      payerIsActive: row.payer_is_active,
      createdUs: row.created_us,
      deletedAt: row.deleted_at,
    })),
  };
}

const ZERO = BigInt(0);

/**
 * total ÷ count, rounded to the nearest minor unit with halves away from
 * zero, the way Postgres rounds numeric. Amounts are positive here.
 */
export function averageOf(totalMinor: bigint, count: number): bigint {
  const n = BigInt(count);
  return (totalMinor * BigInt(2) + n) / (n * BigInt(2));
}

function compareBig(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Code-point order, the same order Postgres gives lowercase uuids and ISO dates. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type Ordered = Pick<
  HistoryRow,
  "id" | "amountMinor" | "expenseDate" | "createdUs"
>;

/** Newest first: date ↓, added ↓, id ↓. The tie-breakers of every order. */
function newest(a: Ordered, b: Ordered): number {
  return (
    compareText(b.expenseDate, a.expenseDate) ||
    compareBig(b.createdUs, a.createdUs) ||
    compareText(b.id, a.id)
  );
}

/** The order public.expense_history promises for each sort. */
export function compareRows(sort: HistorySort) {
  return (a: Ordered, b: Ordered): number => {
    switch (sort) {
      case "newest":
        return newest(a, b);
      case "oldest":
        return (
          compareText(a.expenseDate, b.expenseDate) ||
          compareBig(a.createdUs, b.createdUs) ||
          compareText(a.id, b.id)
        );
      case "highest":
        return compareBig(b.amountMinor, a.amountMinor) || newest(a, b);
      case "lowest":
        return compareBig(a.amountMinor, b.amountMinor) || newest(a, b);
      case "recent":
        return compareBig(b.createdUs, a.createdUs) || newest(a, b);
    }
  };
}

export type HistoryCheckCode =
  | "page_mismatch"
  | "duplicate_row"
  | "foreign_row"
  | "filter_mismatch"
  | "order_mismatch"
  | "summary_mismatch"
  | "totals_mismatch";

export type HistoryCheck = { ok: true } | { ok: false; code: HistoryCheckCode };

function fail(code: HistoryCheckCode): HistoryCheck {
  return { ok: false, code };
}

/** True when the row is one the filters allow (search aside, see below). */
function rowMatches(row: HistoryRow, filters: HistoryFilters): boolean {
  return (
    (row.deletedAt !== null) === (filters.status === "deleted") &&
    (filters.from === null || row.expenseDate >= filters.from) &&
    (filters.to === null || row.expenseDate <= filters.to) &&
    (filters.categories.length === 0 ||
      filters.categories.includes(row.category)) &&
    (filters.payers.length === 0 || filters.payers.includes(row.paidBy)) &&
    (filters.min === null || row.amountMinor >= filters.min) &&
    (filters.max === null || row.amountMinor <= filters.max)
  );
}

/**
 * Checks a page of history before it's shown:
 * - it's the page asked for (or the last one), holding exactly the rows that
 *   page should, at consecutive positions;
 * - every row is this household's, once, and matches the filters (the search
 *   text itself isn't re-checked: Postgres and JavaScript can lower-case some
 *   letters differently);
 * - the rows are in the promised order;
 * - the summary adds up: the average is total ÷ count rounded, the largest
 *   is at least every row, a single page sums to the total, and the matching
 *   expenses fit inside the household's (exactly equal when nothing filters).
 */
export function checkHistory(
  page: HistoryPage,
  {
    householdId,
    filters,
    pageSize,
  }: {
    householdId: string;
    filters: HistoryFilters;
    pageSize: number;
  },
): HistoryCheck {
  const { totalCount, rows } = page;

  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const expectedRows =
    totalCount === 0
      ? 0
      : page.page < pageCount
        ? pageSize
        : totalCount - (pageCount - 1) * pageSize;
  if (
    page.pageSize !== pageSize ||
    page.pageCount !== pageCount ||
    page.page !== Math.min(filters.page, pageCount) ||
    rows.length !== expectedRows ||
    rows.some((row, i) => row.position !== (page.page - 1) * pageSize + i + 1)
  ) {
    return fail("page_mismatch");
  }

  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) return fail("duplicate_row");
    ids.add(row.id);
    if (row.householdId !== householdId) return fail("foreign_row");
    if (!rowMatches(row, filters)) return fail("filter_mismatch");
  }

  const order = compareRows(filters.sort);
  for (let i = 1; i < rows.length; i++) {
    if (order(rows[i - 1], rows[i]) >= 0) return fail("order_mismatch");
  }

  const pageSum = rows.reduce((sum, row) => sum + row.amountMinor, ZERO);
  if (totalCount === 0) {
    if (
      page.totalMinor !== ZERO ||
      page.averageMinor !== null ||
      page.largest !== null
    ) {
      return fail("summary_mismatch");
    }
  } else {
    const largest = page.largest;
    if (
      page.totalMinor <= ZERO ||
      page.averageMinor !== averageOf(page.totalMinor, totalCount) ||
      largest === null ||
      largest.amountMinor > page.totalMinor ||
      rows.some((row) => row.amountMinor > largest.amountMinor) ||
      pageSum > page.totalMinor
    ) {
      return fail("summary_mismatch");
    }
    if (pageCount === 1) {
      const top = [...rows].sort(compareRows("highest"))[0];
      if (pageSum !== page.totalMinor || top.id !== largest.expenseId) {
        return fail("summary_mismatch");
      }
    }
  }

  const deleted = filters.status === "deleted";
  const everything = !isFiltered({ ...filters, status: "counted" });
  if (
    deleted
      ? totalCount > page.householdDeletedCount ||
        (everything && totalCount !== page.householdDeletedCount)
      : totalCount > page.householdCount ||
        page.totalMinor > page.householdTotalMinor ||
        (everything &&
          (totalCount !== page.householdCount ||
            page.totalMinor !== page.householdTotalMinor))
  ) {
    return fail("totals_mismatch");
  }
  return { ok: true };
}
