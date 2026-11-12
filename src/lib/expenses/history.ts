// Expense history (roadmap Phase 12): the search, filters, sort and page,
// read from the URL and written back to it, so a view can be refreshed,
// bookmarked or shared with someone else in the household; and turned into
// the arguments of public.expense_history.
//
// Pure: no database, no clock. The page passes "today" in the household's
// timezone (D11), the currency's decimal places (D2) and the people who can
// have paid; the tests run all of it on their own.
//
// Nothing here trusts the URL. Every value is checked; anything that isn't
// valid is reported against its field and no expenses are fetched with it.

import { parseAmount } from "@/domain/money/amount";
import type { Database } from "@/lib/supabase/database.types";
import { formatDate, formatMoney, minorToDecimalString } from "@/lib/format";
import {
  CATEGORY_VALUES,
  categoryLabel,
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from "./categories";
import { isCalendarDate } from "./dates";

/** Expenses per page. */
export const HISTORY_PAGE_SIZE = 25;
/** Descriptions are at most 120 characters, so a longer search can't match. */
export const SEARCH_MAX_LENGTH = 120;
/** The highest page number read from a URL; the database clamps to the last page. */
const MAX_PAGE = 999_999;
/**
 * D25 (Proposed): "This week" starts on Monday, as in ISO 8601.
 * 0 = Sunday … 6 = Saturday.
 */
export const WEEK_STARTS_ON = 1;

export const HISTORY_SORTS = [
  "newest",
  "oldest",
  "highest",
  "lowest",
  "recent",
] as const;
export type HistorySort = (typeof HISTORY_SORTS)[number];

export const SORT_LABELS: Record<HistorySort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  highest: "Highest amount first",
  lowest: "Lowest amount first",
  recent: "Recently added",
};

export const DATE_RANGES = [
  "any",
  "today",
  "week",
  "month",
  "last-month",
  "custom",
] as const;
export type DateRange = (typeof DATE_RANGES)[number];

export const RANGE_LABELS: Record<DateRange, string> = {
  any: "Any time",
  today: "Today",
  week: "This week",
  month: "This month",
  "last-month": "Previous month",
  custom: "Custom dates",
};

/** D7: counted expenses, or the deleted ones (which never count). */
export type HistoryStatus = "counted" | "deleted";

/** The URL's values as given, kept to fill the form in again. */
export type RawHistoryQuery = {
  q: string;
  range: string;
  from: string;
  to: string;
  category: string[];
  payer: string[];
  min: string;
  max: string;
  status: string;
  sort: string;
  page: string;
};

export type HistoryFilters = {
  /** Trimmed, with runs of spaces made one; "" for no search. */
  search: string;
  range: DateRange;
  /** Inclusive calendar dates, worked out from the range; null for open. */
  from: string | null;
  to: string | null;
  /** In D17's order, each once. */
  categories: ExpenseCategory[];
  /** In the order of the people given, each once. */
  payers: string[];
  /** Integer minor units of the household's currency. */
  min: bigint | null;
  max: bigint | null;
  status: HistoryStatus;
  sort: HistorySort;
  /** 1-based. The database turns a page past the end into the last page. */
  page: number;
};

export type HistoryField =
  | "q"
  | "range"
  | "from"
  | "to"
  | "category"
  | "payer"
  | "min"
  | "max"
  | "status"
  | "sort";

export type HistoryValidation =
  | { ok: true; filters: HistoryFilters }
  | { ok: false; errors: Partial<Record<HistoryField, string>> };

export type HistoryContext = {
  /** "YYYY-MM-DD" in the household's timezone (D11). */
  today: string;
  /** The currency's decimal places (D2). */
  exponent: number;
  /** Everyone who is or was a member, in the order the filter lists them. */
  payerIds: string[];
};

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function many(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).filter((v) => v !== "");
}

/** The URL's search params, as the history page receives them. */
export function readHistoryQuery(params: SearchParams): RawHistoryQuery {
  return {
    q: one(params.q),
    range: one(params.range),
    from: one(params.from),
    to: one(params.to),
    category: many(params.category),
    payer: many(params.payer),
    min: one(params.min),
    max: one(params.max),
    status: one(params.status),
    sort: one(params.sort),
    page: one(params.page),
  };
}

/** "  Electricity   bill " → "Electricity bill". */
export function normaliseSearch(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Categories whose name (D17) matches the search from the start of a word,
 * ignoring case: "groc" → Groceries, "supplies" → Household supplies.
 */
export function categoriesMatching(search: string): ExpenseCategory[] {
  const query = normaliseSearch(search).toLowerCase();
  if (query === "") return [];
  return EXPENSE_CATEGORIES.filter((c) =>
    ` ${c.label.toLowerCase()}`.includes(` ${query}`),
  ).map((c) => c.value);
}

// ---------------------------------------------------------------------------
// Calendar dates, as "YYYY-MM-DD", in plain UTC arithmetic: a date never
// shifts across a timezone here (D11).
// ---------------------------------------------------------------------------

function toUtc(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** The first and last day of the period a preset means, around `today`. */
export function dateRangeBounds(
  range: Exclude<DateRange, "any" | "custom">,
  today: string,
): { from: string; to: string } {
  const d = toUtc(today);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  switch (range) {
    case "today":
      return { from: today, to: today };
    case "week": {
      const back = (d.getUTCDay() - WEEK_STARTS_ON + 7) % 7;
      const from = addDays(today, -back);
      return { from, to: addDays(from, 6) };
    }
    case "month":
      return {
        from: fromUtc(new Date(Date.UTC(year, month, 1))),
        to: fromUtc(new Date(Date.UTC(year, month + 1, 0))),
      };
    case "last-month":
      return {
        from: fromUtc(new Date(Date.UTC(year, month - 1, 1))),
        to: fromUtc(new Date(Date.UTC(year, month, 0))),
      };
  }
}

// ---------------------------------------------------------------------------
// Reading and checking the URL
// ---------------------------------------------------------------------------

function isOneOf<T extends string>(
  values: readonly T[],
  value: string,
): value is T {
  return (values as readonly string[]).includes(value);
}

/**
 * Checks every value from the URL against the household. Errors are keyed by
 * the form field they belong to, with a message that says how to fix it.
 */
export function parseHistoryQuery(
  raw: RawHistoryQuery,
  context: HistoryContext,
): HistoryValidation {
  const errors: Partial<Record<HistoryField, string>> = {};

  const search = normaliseSearch(raw.q);
  if (search.length > SEARCH_MAX_LENGTH) {
    errors.q = `Search for ${SEARCH_MAX_LENGTH} characters or fewer.`;
  }

  // A link with only dates (no range) means those dates.
  const rangeText =
    raw.range === "" ? (raw.from || raw.to ? "custom" : "any") : raw.range;
  let range: DateRange = "any";
  let from: string | null = null;
  let to: string | null = null;
  if (!isOneOf(DATE_RANGES, rangeText)) {
    errors.range = "Choose a date range from the list.";
  } else {
    range = rangeText;
    if (range === "custom") {
      if (raw.from !== "" && !isCalendarDate(raw.from)) {
        errors.from = "Choose a real start date.";
      }
      if (raw.to !== "" && !isCalendarDate(raw.to)) {
        errors.to = "Choose a real end date.";
      }
      if (!errors.from && !errors.to) {
        from = raw.from || null;
        to = raw.to || null;
        if (from && to && from > to) {
          errors.to = "The end date can't be before the start date.";
        }
      }
    } else if (range !== "any") {
      ({ from, to } = dateRangeBounds(range, context.today));
    }
  }

  const categories = [...new Set(raw.category)];
  if (categories.some((c) => !isOneOf(CATEGORY_VALUES, c))) {
    errors.category = "Choose categories from the list.";
  }

  const payerSet = new Set(raw.payer);
  const known = new Set(context.payerIds);
  if ([...payerSet].some((id) => !known.has(id))) {
    errors.payer = "Choose people from this household.";
  }

  const amount = (text: string, field: "min" | "max") => {
    if (text.trim() === "") return null;
    const parsed = parseAmount(text, context.exponent);
    if (!parsed.ok) {
      errors[field] = parsed.error;
      return null;
    }
    return parsed.minor;
  };
  const min = amount(raw.min, "min");
  const max = amount(raw.max, "max");
  if (min !== null && max !== null && min > max) {
    errors.max = "The maximum can't be less than the minimum.";
  }

  const statusText = raw.status === "" ? "counted" : raw.status;
  if (statusText !== "counted" && statusText !== "deleted") {
    errors.status = "Choose which expenses to show.";
  }
  const sortText = raw.sort === "" ? "newest" : raw.sort;
  if (!isOneOf(HISTORY_SORTS, sortText)) {
    errors.sort = "Choose a sort order from the list.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  // Not a page number: the first page. Too big: the last one (the database
  // clamps it).
  const page = /^[1-9][0-9]*$/.test(raw.page)
    ? Math.min(Number(raw.page), MAX_PAGE)
    : 1;
  return {
    ok: true,
    filters: {
      search,
      range,
      from,
      to,
      categories: CATEGORY_VALUES.filter((c) => categories.includes(c)),
      payers: context.payerIds.filter((id) => payerSet.has(id)),
      min,
      max,
      status: statusText as HistoryStatus,
      sort: sortText as HistorySort,
      page,
    },
  };
}

/** True when anything narrows the list beyond "every counted expense". */
export function isFiltered(filters: HistoryFilters): boolean {
  return (
    filters.search !== "" ||
    filters.from !== null ||
    filters.to !== null ||
    filters.categories.length > 0 ||
    filters.payers.length > 0 ||
    filters.min !== null ||
    filters.max !== null ||
    filters.status === "deleted"
  );
}

// ---------------------------------------------------------------------------
// Writing the URL back
// ---------------------------------------------------------------------------

/**
 * The filters as search params, in a fixed order, leaving out defaults (any
 * time, counted, newest first, page 1). Presets stay presets ("range=month"),
 * so a shared link means the reader's own current month.
 */
export function historySearchParams(
  filters: HistoryFilters,
  exponent: number,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.range !== "any") params.set("range", filters.range);
  if (filters.range === "custom") {
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
  }
  for (const category of filters.categories) {
    params.append("category", category);
  }
  for (const payer of filters.payers) params.append("payer", payer);
  if (filters.min !== null) {
    params.set("min", minorToDecimalString(filters.min, exponent));
  }
  if (filters.max !== null) {
    params.set("max", minorToDecimalString(filters.max, exponent));
  }
  if (filters.status === "deleted") params.set("status", "deleted");
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
}

/**
 * A link to the history with `change` applied. Any change other than the
 * page goes back to page 1, since the old page may no longer exist.
 */
export function historyHref(
  base: string,
  filters: HistoryFilters,
  exponent: number,
  change: Partial<HistoryFilters> = {},
): string {
  const next = {
    ...filters,
    ...change,
    page: "page" in change ? (change.page ?? 1) : 1,
  };
  const query = historySearchParams(next, exponent).toString();
  return query ? `${base}?${query}` : base;
}

/** How many groups of filters (not search or sort) are in use. */
export function activeFilterCount(filters: HistoryFilters): number {
  return [
    filters.from !== null || filters.to !== null,
    filters.categories.length > 0,
    filters.payers.length > 0,
    filters.min !== null || filters.max !== null,
    filters.status === "deleted",
  ].filter(Boolean).length;
}

export type FilterChip = { key: string; label: string; href: string };

function dateChipLabel({ range, from, to }: HistoryFilters): string {
  if (range === "today" && from) return `Today (${formatDate(from)})`;
  if (range !== "custom" && range !== "any" && from && to) {
    return `${RANGE_LABELS[range]} (${formatDate(from)} – ${formatDate(to)})`;
  }
  if (from && to) {
    return from === to
      ? formatDate(from)
      : `${formatDate(from)} – ${formatDate(to)}`;
  }
  return from ? `From ${formatDate(from)}` : `Until ${formatDate(to!)}`;
}

/**
 * One removable chip per filter in use, each linking to the same view
 * without it (and back to page 1).
 */
export function activeFilterChips(
  filters: HistoryFilters,
  {
    base,
    exponent,
    currency,
    people,
  }: {
    base: string;
    exponent: number;
    currency: string;
    people: { userId: string; label: string }[];
  },
): FilterChip[] {
  const href = (change: Partial<HistoryFilters>) =>
    historyHref(base, filters, exponent, change);
  const chips: FilterChip[] = [];
  if (filters.search) {
    chips.push({
      key: "q",
      label: `Search: “${filters.search}”`,
      href: href({ search: "" }),
    });
  }
  if (filters.from !== null || filters.to !== null) {
    chips.push({
      key: "date",
      label: dateChipLabel(filters),
      href: href({ range: "any", from: null, to: null }),
    });
  }
  for (const category of filters.categories) {
    chips.push({
      key: `category-${category}`,
      label: categoryLabel(category),
      href: href({
        categories: filters.categories.filter((c) => c !== category),
      }),
    });
  }
  for (const payer of filters.payers) {
    const person = people.find((p) => p.userId === payer);
    chips.push({
      key: `payer-${payer}`,
      label: `Paid by ${person?.label ?? "Former member"}`,
      href: href({ payers: filters.payers.filter((p) => p !== payer) }),
    });
  }
  if (filters.min !== null) {
    chips.push({
      key: "min",
      label: `At least ${formatMoney(filters.min, currency)}`,
      href: href({ min: null }),
    });
  }
  if (filters.max !== null) {
    chips.push({
      key: "max",
      label: `At most ${formatMoney(filters.max, currency)}`,
      href: href({ max: null }),
    });
  }
  if (filters.status === "deleted") {
    chips.push({
      key: "status",
      label: "Deleted expenses",
      href: href({ status: "counted" }),
    });
  }
  return chips;
}

export type ExpenseHistoryArgs =
  Database["public"]["Functions"]["expense_history"]["Args"];

/** The filters as arguments of public.expense_history. */
export function expenseHistoryArgs(
  householdId: string,
  filters: HistoryFilters,
): ExpenseHistoryArgs {
  return {
    target_household_id: householdId,
    ...(filters.search
      ? {
          search_text: filters.search,
          search_categories: categoriesMatching(filters.search),
        }
      : {}),
    ...(filters.from ? { date_from: filters.from } : {}),
    ...(filters.to ? { date_to: filters.to } : {}),
    ...(filters.categories.length > 0
      ? { categories: filters.categories }
      : {}),
    ...(filters.payers.length > 0 ? { payers: filters.payers } : {}),
    // Amounts are at most 999,999,999,999 minor units: exact as numbers.
    ...(filters.min !== null ? { amount_min: Number(filters.min) } : {}),
    ...(filters.max !== null ? { amount_max: Number(filters.max) } : {}),
    deleted_only: filters.status === "deleted",
    sort_order: filters.sort,
    page_size: HISTORY_PAGE_SIZE,
    page_number: filters.page,
  };
}
