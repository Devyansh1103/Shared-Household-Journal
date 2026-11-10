import type { Database } from "@/lib/supabase/database.types";

// D17: a fixed list, in this order. Custom categories come later.

export type ExpenseCategory = Database["public"]["Enums"]["expense_category"];

export const EXPENSE_CATEGORIES: readonly {
  value: ExpenseCategory;
  label: string;
}[] = [
  { value: "rent", label: "Rent" },
  { value: "utilities", label: "Utilities" },
  { value: "groceries", label: "Groceries" },
  { value: "household_supplies", label: "Household supplies" },
  { value: "internet", label: "Internet" },
  { value: "dining", label: "Dining" },
  { value: "transport", label: "Transport" },
  { value: "other", label: "Other" },
];

export const CATEGORY_VALUES = EXPENSE_CATEGORIES.map((c) => c.value) as [
  ExpenseCategory,
  ...ExpenseCategory[],
];

export function categoryLabel(value: ExpenseCategory): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? "Other";
}
