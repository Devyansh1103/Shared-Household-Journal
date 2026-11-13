// Budget periods (roadmap Phase 16, D29): weeks from Monday (D25), calendar
// months and calendar quarters, as plain "YYYY-MM-DD" dates in the
// household's timezone (D11). The same rules as private.budget_period_start
// and private.budget_period_end in SQL (compared in the database tests).
// Pure.

import { addDays, addMonths } from "@/lib/bills/schedule";
import { WEEK_STARTS_ON } from "@/lib/expenses/history";
import type { Database } from "@/lib/supabase/database.types";

export type BudgetPeriod = Database["public"]["Enums"]["budget_period"];

export const BUDGET_PERIODS = [
  "week",
  "month",
  "quarter",
] as const satisfies readonly BudgetPeriod[];

/** "Weekly", for forms and headings. */
export const PERIOD_ADJECTIVES: Record<BudgetPeriod, string> = {
  week: "Weekly",
  month: "Monthly",
  quarter: "Quarterly",
};

/** "week", for sentences: "this week". */
export const PERIOD_NOUNS: Record<BudgetPeriod, string> = {
  week: "week",
  month: "month",
  quarter: "quarter",
};

export function isBudgetPeriod(value: string): value is BudgetPeriod {
  return (BUDGET_PERIODS as readonly string[]).includes(value);
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The first day of the period that contains `date`. */
export function periodStart(date: string, period: BudgetPeriod): string {
  const [y, m] = parts(date);
  switch (period) {
    case "week": {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      return addDays(date, -((weekday - WEEK_STARTS_ON + 7) % 7));
    }
    case "month":
      return iso(y, m, 1);
    case "quarter":
      return iso(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
  }
}

/** The last day of the period that starts on `start`. */
export function periodEnd(start: string, period: BudgetPeriod): string {
  switch (period) {
    case "week":
      return addDays(start, 6);
    case "month":
      return addDays(addMonths(start, 1), -1);
    case "quarter":
      return addDays(addMonths(start, 3), -1);
  }
}

/** The start of the period `steps` periods after (or before) the one starting on `start`. */
export function shiftPeriod(
  start: string,
  period: BudgetPeriod,
  steps: number,
): string {
  switch (period) {
    case "week":
      return addDays(start, 7 * steps);
    case "month":
      return addMonths(start, steps);
    case "quarter":
      return addMonths(start, 3 * steps);
  }
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

/**
 * The period in words: "November 2026", "July–September 2026 (Q3)",
 * "9–15 Nov 2026", "29 Dec 2025 – 4 Jan 2026".
 */
export function periodLabel(start: string, period: BudgetPeriod): string {
  const [y, m, d] = parts(start);
  switch (period) {
    case "month":
      return `${MONTHS[m - 1]} ${y}`;
    case "quarter":
      return `${MONTHS[m - 1]}–${MONTHS[m + 1]} ${y} (Q${Math.floor((m - 1) / 3) + 1})`;
    case "week": {
      const [ey, em, ed] = parts(periodEnd(start, "week"));
      if (ey !== y)
        return `${d} ${SHORT[m - 1]} ${y} – ${ed} ${SHORT[em - 1]} ${ey}`;
      if (em !== m) return `${d} ${SHORT[m - 1]} – ${ed} ${SHORT[em - 1]} ${y}`;
      return `${d}–${ed} ${SHORT[m - 1]} ${y}`;
    }
  }
}

/** "this month", "last month", "next week", or null for any other period. */
export function relativePeriod(
  start: string,
  period: BudgetPeriod,
  today: string,
): string | null {
  const current = periodStart(today, period);
  const noun = PERIOD_NOUNS[period];
  if (start === current) return `this ${noun}`;
  if (start === shiftPeriod(current, period, -1)) return `last ${noun}`;
  if (start === shiftPeriod(current, period, 1)) return `next ${noun}`;
  return null;
}
