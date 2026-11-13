// The analytics page's filters (roadmap Phase 16), read from the URL: a date
// range (a preset or custom dates), a category and who paid. Each preset is
// worked out from the household's date (D11) and says what it's compared
// with. Pure.

import { addDays, addMonths, daysBetween } from "@/lib/bills/schedule";
import {
  CATEGORY_VALUES,
  type ExpenseCategory,
} from "@/lib/expenses/categories";
import { isCalendarDate } from "@/lib/expenses/dates";
import { periodEnd, periodStart } from "@/lib/budgets/period";

export const RANGE_PRESETS = [
  "this_month",
  "last_month",
  "last_7_days",
  "last_30_days",
  "last_3_months",
  "last_6_months",
  "last_12_months",
  "custom",
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_LABELS: Record<RangePreset, string> = {
  this_month: "This month",
  last_month: "Last month",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  last_3_months: "Last 3 months",
  last_6_months: "Last 6 months",
  last_12_months: "Last 12 months",
  custom: "Custom dates",
};

/** The longest range the database accepts (22023 beyond it). */
export const MAX_RANGE_DAYS = 731;

export type RawAnalyticsQuery = {
  range: string;
  from: string;
  to: string;
  category: string;
  payer: string;
};

export type AnalyticsQuery = {
  range: RangePreset;
  from: string;
  to: string;
  /** What to compare with; null: the same number of days just before. */
  compareFrom: string | null;
  compareTo: string | null;
  category: ExpenseCategory | null;
  payer: string | null;
};

export type AnalyticsQueryResult =
  | { ok: true; query: AnalyticsQuery }
  | { ok: false; fieldErrors: Record<string, string>; raw: RawAnalyticsQuery };

type Param = string | string[] | undefined;
const text = (value: Param) => (typeof value === "string" ? value : "");

export function readAnalyticsQuery(
  params: Record<string, Param>,
): RawAnalyticsQuery {
  return {
    range: text(params.range),
    from: text(params.from),
    to: text(params.to),
    category: text(params.category),
    payer: text(params.payer),
  };
}

/** A preset's dates and what they're compared with, on the household's `today`. */
export function presetRange(
  preset: Exclude<RangePreset, "custom">,
  today: string,
): Pick<AnalyticsQuery, "from" | "to" | "compareFrom" | "compareTo"> {
  const monthStart = periodStart(today, "month");
  switch (preset) {
    case "this_month": {
      // So far this month, against the same days of last month.
      const lastStart = addMonths(monthStart, -1);
      const sameDay = addDays(lastStart, daysBetween(monthStart, today));
      const lastEnd = periodEnd(lastStart, "month");
      return {
        from: monthStart,
        to: today,
        compareFrom: lastStart,
        compareTo: sameDay < lastEnd ? sameDay : lastEnd,
      };
    }
    case "last_month": {
      const start = addMonths(monthStart, -1);
      const before = addMonths(monthStart, -2);
      return {
        from: start,
        to: periodEnd(start, "month"),
        compareFrom: before,
        compareTo: periodEnd(before, "month"),
      };
    }
    case "last_7_days":
      return {
        from: addDays(today, -6),
        to: today,
        compareFrom: null,
        compareTo: null,
      };
    case "last_30_days":
      return {
        from: addDays(today, -29),
        to: today,
        compareFrom: null,
        compareTo: null,
      };
    case "last_3_months":
      return {
        from: addMonths(monthStart, -2),
        to: today,
        compareFrom: null,
        compareTo: null,
      };
    case "last_6_months":
      return {
        from: addMonths(monthStart, -5),
        to: today,
        compareFrom: null,
        compareTo: null,
      };
    case "last_12_months":
      return {
        from: addMonths(monthStart, -11),
        to: today,
        compareFrom: null,
        compareTo: null,
      };
  }
}

/**
 * Checks the URL. An unknown preset, category or person is an error near its
 * field, as are custom dates that aren't real, are the wrong way round or
 * span more than two years. Nothing is guessed.
 */
export function parseAnalyticsQuery(
  raw: RawAnalyticsQuery,
  context: { today: string; personIds: readonly string[] },
): AnalyticsQueryResult {
  const errors: Record<string, string> = {};
  const range = (raw.range === "" ? "this_month" : raw.range) as RangePreset;
  if (!(RANGE_PRESETS as readonly string[]).includes(range)) {
    errors.range = "Choose a range from the list.";
  }
  let category: ExpenseCategory | null = null;
  if (raw.category !== "") {
    if ((CATEGORY_VALUES as readonly string[]).includes(raw.category)) {
      category = raw.category as ExpenseCategory;
    } else errors.category = "Choose a category from the list.";
  }
  let payer: string | null = null;
  if (raw.payer !== "") {
    if (context.personIds.includes(raw.payer)) payer = raw.payer;
    else errors.payer = "Choose someone from the list.";
  }

  let dates: Pick<
    AnalyticsQuery,
    "from" | "to" | "compareFrom" | "compareTo"
  > | null = null;
  if (range === "custom") {
    if (!isCalendarDate(raw.from)) errors.from = "Choose a real start date.";
    if (!isCalendarDate(raw.to)) errors.to = "Choose a real end date.";
    if (!errors.from && !errors.to) {
      if (raw.from > raw.to)
        errors.to = "The end date can't be before the start date.";
      else if (daysBetween(raw.from, raw.to) + 1 > MAX_RANGE_DAYS) {
        errors.to = "Choose at most two years.";
      } else if (raw.from < "2000-01-01" || raw.to > "2099-12-31") {
        errors.from = "Choose dates between 2000 and 2099.";
      } else
        dates = {
          from: raw.from,
          to: raw.to,
          compareFrom: null,
          compareTo: null,
        };
    }
  } else if (!errors.range) {
    dates = presetRange(range as Exclude<RangePreset, "custom">, context.today);
  }

  if (Object.keys(errors).length > 0 || !dates) {
    return { ok: false, fieldErrors: errors, raw };
  }
  return { ok: true, query: { range, ...dates, category, payer } };
}

/** The URL for a view, leaving out what's default. */
export function analyticsHref(
  base: string,
  view: {
    range: RangePreset;
    from?: string;
    to?: string;
    category: string | null;
    payer: string | null;
  },
): string {
  const params = new URLSearchParams();
  if (view.range !== "this_month") params.set("range", view.range);
  if (view.range === "custom") {
    if (view.from) params.set("from", view.from);
    if (view.to) params.set("to", view.to);
  }
  if (view.category) params.set("category", view.category);
  if (view.payer) params.set("payer", view.payer);
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}
