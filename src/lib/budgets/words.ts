// Names for budgets in the app's words (roadmap Phase 16). Pure.

import { categoryLabel, type ExpenseCategory } from "@/lib/expenses/categories";
import { PERIOD_ADJECTIVES, type BudgetPeriod } from "./period";

/** "Everything", "Groceries". */
export function budgetSubject(category: ExpenseCategory | null): string {
  return category === null ? "Everything" : categoryLabel(category);
}

/** "Monthly budget for everything", "Weekly budget for groceries". */
export function budgetName(
  category: ExpenseCategory | null,
  period: BudgetPeriod,
): string {
  const what =
    category === null ? "everything" : categoryLabel(category).toLowerCase();
  return `${PERIOD_ADJECTIVES[period]} budget for ${what}`;
}
