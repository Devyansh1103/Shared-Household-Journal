// Reads what public.household_budgets returns and checks it before anything
// is shown (as the bills, the history and the journal do). Money arrives as
// text and becomes BigInt.

import { z } from "zod";
import {
  CATEGORY_VALUES,
  type ExpenseCategory,
} from "@/lib/expenses/categories";
import {
  BUDGET_PERIODS,
  periodEnd,
  periodStart,
  type BudgetPeriod,
} from "./period";

const id = z.uuid();
const date = z.iso.date();
const positive = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform((value) => BigInt(value));
const nonNegative = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform((value) => BigInt(value));
const count = z.number().int().min(0);

const schema = z.strictObject({
  today: date,
  period: z.enum(BUDGET_PERIODS),
  period_start: date,
  period_end: date,
  total_spent_minor: nonNegative,
  total_count: count,
  active_counts: z.strictObject({ week: count, month: count, quarter: count }),
  budgets: z.array(
    z.strictObject({
      budget_id: id,
      household_id: id,
      category: z.enum(CATEGORY_VALUES).nullable(),
      period: z.enum(BUDGET_PERIODS),
      starts_on: date,
      archived: z.boolean(),
      updated_at: z.string(),
      limit_minor: positive,
      spent_minor: nonNegative,
      expense_count: count,
    }),
  ),
});

export type BudgetRow = {
  id: string;
  householdId: string;
  /** Null: the whole household. */
  category: ExpenseCategory | null;
  period: BudgetPeriod;
  startsOn: string;
  /** Removed since (it still covers this period, which ended before). */
  archived: boolean;
  updatedAt: string;
  /** The limit for this period (a later change doesn't alter it). */
  limitMinor: bigint;
  spentMinor: bigint;
  expenseCount: number;
};

export type HouseholdBudgets = {
  /** The household's date (D11). */
  today: string;
  period: BudgetPeriod;
  periodStart: string;
  periodEnd: string;
  /** Everything the household spent in the period, budget or not. */
  totalSpentMinor: bigint;
  totalCount: number;
  activeCounts: Record<BudgetPeriod, number>;
  /** The whole household first, then categories in D17's order. */
  budgets: BudgetRow[];
};

export function parseHouseholdBudgets(
  payload: unknown,
): HouseholdBudgets | null {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return null;
  const d = parsed.data;
  return {
    today: d.today,
    period: d.period,
    periodStart: d.period_start,
    periodEnd: d.period_end,
    totalSpentMinor: d.total_spent_minor,
    totalCount: d.total_count,
    activeCounts: d.active_counts,
    budgets: d.budgets.map((b) => ({
      id: b.budget_id,
      householdId: b.household_id,
      category: b.category,
      period: b.period,
      startsOn: b.starts_on,
      archived: b.archived,
      updatedAt: b.updated_at,
      limitMinor: b.limit_minor,
      spentMinor: b.spent_minor,
      expenseCount: b.expense_count,
    })),
  };
}

export type BudgetsCheckCode =
  | "foreign_budget"
  | "duplicate_budget"
  | "period_mismatch"
  | "spending_mismatch";

export type BudgetsCheck = { ok: true } | { ok: false; code: BudgetsCheckCode };

const fail = (code: BudgetsCheckCode): BudgetsCheck => ({ ok: false, code });

/**
 * Checks the budgets page's data before it's shown: the period is the one
 * asked for and has the right bounds; every budget is this household's, of
 * this kind of period, started by the period's first day, and appears once
 * for its category; no category spent more than the household did, and the
 * whole household's budget spent exactly what the household did.
 */
export function checkHouseholdBudgets(
  data: HouseholdBudgets,
  context: { householdId: string; period: BudgetPeriod; onDate: string | null },
): BudgetsCheck {
  const expectedStart = periodStart(
    context.onDate ?? data.today,
    context.period,
  );
  if (
    data.period !== context.period ||
    data.periodStart !== expectedStart ||
    data.periodEnd !== periodEnd(expectedStart, context.period)
  ) {
    return fail("period_mismatch");
  }
  const seen = new Set<string>();
  for (const budget of data.budgets) {
    if (budget.householdId !== context.householdId)
      return fail("foreign_budget");
    if (
      budget.period !== context.period ||
      budget.startsOn > data.periodStart
    ) {
      return fail("period_mismatch");
    }
    const key = budget.category ?? "";
    if (seen.has(key)) return fail("duplicate_budget");
    seen.add(key);
    if (budget.category === null) {
      if (
        budget.spentMinor !== data.totalSpentMinor ||
        budget.expenseCount !== data.totalCount
      ) {
        return fail("spending_mismatch");
      }
    } else if (
      budget.spentMinor > data.totalSpentMinor ||
      budget.expenseCount > data.totalCount
    ) {
      return fail("spending_mismatch");
    }
  }
  return { ok: true };
}
