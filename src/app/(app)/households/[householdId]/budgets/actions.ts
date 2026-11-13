"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { GENERIC_ERROR } from "@/lib/auth/errors";
import { formValue, type FormState } from "@/lib/auth/form-state";
import { requireUser } from "@/lib/auth/session";
import {
  readBudgetForm,
  validateLimit,
  validateNewBudget,
  type RawBudgetForm,
} from "@/lib/budgets/form";
import { getBudget } from "@/lib/budgets/queries";
import { currencyExponent } from "@/lib/format";
import { householdErrorMessage } from "@/lib/households/errors";
import { getHousehold } from "@/lib/households/queries";
import { createClient } from "@/lib/supabase/server";

// Budgets (roadmap Phase 16). Any active member may add, change or remove a
// budget (O3, decided 2026-11-13). Every action re-checks the session; the
// caller is auth.uid() inside the database functions, which check membership,
// the limit and the one-per-category-and-period rule again. The currency is
// always the household's (D1): it's never taken from the form.

export type BudgetFormState = FormState & { raw?: RawBudgetForm };

function revalidateHouseholdPages() {
  revalidatePath("/households/[householdId]", "layout");
}

export async function createBudget(
  _previous: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  await requireUser();
  const householdId = z.uuid().safeParse(formValue(formData, "householdId"));
  const requestKey = z.uuid().safeParse(formValue(formData, "requestKey"));
  if (!householdId.success || !requestKey.success) {
    return { status: "error", message: "Reload the page and try again." };
  }
  const household = await getHousehold(householdId.data);
  const raw = readBudgetForm(formData);
  const result = validateNewBudget(raw, {
    exponent: currencyExponent(household.currencyCode),
  });
  if (!result.ok)
    return { status: "error", fieldErrors: result.fieldErrors, raw };

  const budget = result.value;
  const supabase = await createClient();
  const { data: budgetId, error } = await supabase.rpc("create_budget", {
    target_household_id: household.id,
    budget_kind: budget.period,
    budget_limit: Number(budget.limitMinor),
    ...(budget.category ? { budget_category: budget.category } : {}),
    request_key: requestKey.data,
  });
  if (error || !budgetId) {
    return {
      status: "error",
      message: householdErrorMessage(error?.code),
      raw,
    };
  }
  revalidateHouseholdPages();
  redirect(
    `/households/${household.id}/budgets?period=${budget.period}&created=1`,
  );
}

export async function updateBudget(
  _previous: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  await requireUser();
  const ids = z
    .object({ householdId: z.uuid(), budgetId: z.uuid() })
    .safeParse({
      householdId: formValue(formData, "householdId"),
      budgetId: formValue(formData, "budgetId"),
    });
  const expectedUpdatedAt = z.iso
    .datetime({ offset: true })
    .safeParse(formValue(formData, "expectedUpdatedAt"));
  if (!ids.success || !expectedUpdatedAt.success) {
    return { status: "error", message: "Reload the page and try again." };
  }
  // Read under RLS: a 404 for another household's budget.
  const { household, budget } = await getBudget(
    ids.data.householdId,
    ids.data.budgetId,
  );
  const raw = readBudgetForm(formData);
  const limit = validateLimit(
    raw.limit,
    currencyExponent(household.currencyCode),
  );
  if (!limit.ok) {
    return { status: "error", fieldErrors: { limit: limit.error }, raw };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_budget", {
    target_budget_id: budget.id,
    budget_limit: Number(limit.minor),
    expected_updated_at: expectedUpdatedAt.data,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code), raw };
  }
  revalidateHouseholdPages();
  redirect(
    `/households/${household.id}/budgets?period=${budget.period}&updated=1`,
  );
}

export async function archiveBudget(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const budgetId = z.uuid().safeParse(formValue(formData, "budgetId"));
  if (!budgetId.success) return { status: "error", message: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_budget", {
    target_budget_id: budgetId.data,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code) };
  }
  revalidateHouseholdPages();
  refresh();
  return {
    status: "success",
    message: "The budget is removed. Periods that had already ended keep it.",
  };
}
