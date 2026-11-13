import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getHousehold, type Household } from "@/lib/households/queries";
import { createClient } from "@/lib/supabase/server";
import type { ExpenseCategory } from "@/lib/expenses/categories";
import {
  checkHouseholdBudgets,
  parseHouseholdBudgets,
  type HouseholdBudgets,
} from "./payload";
import type { BudgetPeriod } from "./period";

// Data access for budgets (roadmap Phase 16). Reads run as the signed-in
// member under RLS, after getHousehold (404 for non-members). Writes go
// through the budget functions.

export type BudgetsView =
  { ok: true; data: HouseholdBudgets } | { ok: false; reason: "not_verified" };

/** The budgets of one kind of period, for the period containing `onDate` (today if null). */
export async function getBudgets(
  householdId: string,
  period: BudgetPeriod,
  onDate: string | null,
): Promise<BudgetsView> {
  const household = await getHousehold(householdId);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("household_budgets", {
    target_household_id: household.id,
    budget_kind: period,
    ...(onDate ? { on_date: onDate } : {}),
  });
  if (error) {
    if (error.code === "42501") notFound();
    throw new Error("Could not load the budgets.");
  }
  const parsed = parseHouseholdBudgets(data);
  const check = parsed
    ? checkHouseholdBudgets(parsed, {
        householdId: household.id,
        period,
        onDate,
      })
    : ({ ok: false, code: "malformed" } as const);
  if (!parsed || !check.ok) {
    // The reason only: no amounts or ids in logs.
    console.error(
      `Budgets failed verification: ${check.ok ? "malformed" : check.code}`,
    );
    return { ok: false, reason: "not_verified" };
  }
  return { ok: true, data: parsed };
}

export type BudgetForEdit = {
  id: string;
  householdId: string;
  category: ExpenseCategory | null;
  period: BudgetPeriod;
  archived: boolean;
  updatedAt: string;
  /** The limit in force from the newest change on. */
  currentLimitMinor: bigint;
};

/** One budget of the household with its latest limit, or a 404 (also for other households' ids). */
export async function getBudget(
  householdId: string,
  budgetId: string,
): Promise<{ household: Household; budget: BudgetForEdit }> {
  const household = await getHousehold(householdId);
  if (!z.uuid().safeParse(budgetId).success) notFound();
  const supabase = await createClient();
  const [budget, limit] = await Promise.all([
    supabase
      .from("budgets")
      .select("id, household_id, category, period, archived_at, updated_at")
      .eq("id", budgetId)
      .eq("household_id", household.id)
      .maybeSingle(),
    supabase
      .from("budget_limits")
      .select("limit_minor, household_id")
      .eq("budget_id", budgetId)
      .eq("household_id", household.id)
      .order("starts_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (budget.error || limit.error)
    throw new Error("Could not load the budget.");
  if (
    !budget.data ||
    !limit.data ||
    budget.data.household_id !== household.id
  ) {
    notFound();
  }
  return {
    household,
    budget: {
      id: budget.data.id,
      householdId: budget.data.household_id,
      category: budget.data.category,
      period: budget.data.period,
      archived: budget.data.archived_at !== null,
      updatedAt: budget.data.updated_at,
      // bigint columns arrive as JSON numbers; limits stay far below 2^53.
      currentLimitMinor: BigInt(limit.data.limit_minor),
    },
  };
}
