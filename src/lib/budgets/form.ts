// Reading and validating the budget forms (roadmap Phase 16). Pure: the
// Server Actions pass the household's currency's decimal places; the
// database checks everything again (the limit's range, one active budget per
// category and period, membership).

import { parseAmount } from "@/domain/money/amount";
import {
  CATEGORY_VALUES,
  type ExpenseCategory,
} from "@/lib/expenses/categories";
import { isBudgetPeriod, type BudgetPeriod } from "./period";

/** The form as typed, kept to show again after an error. */
export type RawBudgetForm = {
  /** A category, or "all" for the whole household. */
  category: string;
  period: string;
  limit: string;
};

export const EMPTY_BUDGET_FORM: RawBudgetForm = {
  category: "all",
  period: "month",
  limit: "",
};

export type Validation<T> =
  { ok: true; value: T } | { ok: false; fieldErrors: Record<string, string> };

export type NewBudget = {
  category: ExpenseCategory | null;
  period: BudgetPeriod;
  limitMinor: bigint;
};

export function readBudgetForm(formData: FormData): RawBudgetForm {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    category: text("category"),
    period: text("period"),
    limit: text("limit"),
  };
}

function isCategory(value: string): value is ExpenseCategory {
  return (CATEGORY_VALUES as readonly string[]).includes(value);
}

/** A limit above zero, in the household's currency, exactly. */
export function validateLimit(
  raw: string,
  exponent: number,
): { ok: true; minor: bigint } | { ok: false; error: string } {
  const amount = parseAmount(raw, exponent);
  return amount.ok
    ? { ok: true, minor: amount.minor }
    : { ok: false, error: amount.error };
}

export function validateNewBudget(
  raw: RawBudgetForm,
  context: { exponent: number },
): Validation<NewBudget> {
  const errors: Record<string, string> = {};
  if (raw.category !== "all" && !isCategory(raw.category)) {
    errors.category = "Choose the whole household or a category.";
  }
  if (!isBudgetPeriod(raw.period)) {
    errors.period = "Choose weekly, monthly or quarterly.";
  }
  const limit = validateLimit(raw.limit, context.exponent);
  if (!limit.ok) errors.limit = limit.error;

  if (!limit.ok || Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }
  return {
    ok: true,
    value: {
      category:
        raw.category === "all" ? null : (raw.category as ExpenseCategory),
      period: raw.period as BudgetPeriod,
      limitMinor: limit.minor,
    },
  };
}
