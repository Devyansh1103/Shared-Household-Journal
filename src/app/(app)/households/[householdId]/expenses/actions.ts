"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { GENERIC_ERROR } from "@/lib/auth/errors";
import { formValue, type FormState } from "@/lib/auth/form-state";
import { requireUser } from "@/lib/auth/session";
import { listMembersInJoinOrder } from "@/lib/households/queries";
import {
  readExpenseForm,
  sharesJson,
  validateExpenseForm,
  type RawExpenseForm,
} from "@/lib/expenses/form";
import { currencyExponent } from "@/lib/format";
import { householdErrorMessage } from "@/lib/households/errors";
import { getHousehold } from "@/lib/households/queries";
import { removeReceiptFiles } from "@/lib/receipts/server";
import { createClient } from "@/lib/supabase/server";

// Every action re-checks the session. The creator and the editor are
// auth.uid() inside the database functions; ids in the form only name the
// household, the expense, the payer and the participants, and the functions
// check all of them (membership, D6 rights, money invariants) again.

export type ExpenseFormState = FormState & { raw?: RawExpenseForm };

const ids = z.object({ householdId: z.uuid(), expenseId: z.uuid() });

/** Expense pages under every household: lists, details and the overview. */
function revalidateHouseholdPages() {
  revalidatePath("/households/[householdId]", "layout");
}

async function validate(householdId: string, formData: FormData) {
  const household = await getHousehold(householdId);
  // Trusted, server-side list of who may take part, in join order (ADR-004).
  const members = await listMembersInJoinOrder(household.id);
  const raw = readExpenseForm(formData);
  const result = validateExpenseForm(raw, {
    memberIds: members.map((m) => m.userId),
    exponent: currencyExponent(household.currencyCode),
  });
  return { household, raw, result };
}

export async function createExpense(
  _previous: ExpenseFormState,
  formData: FormData,
): Promise<ExpenseFormState> {
  await requireUser();
  const householdId = z.uuid().safeParse(formValue(formData, "householdId"));
  const requestKey = z.uuid().safeParse(formValue(formData, "requestKey"));
  if (!householdId.success || !requestKey.success) {
    return { status: "error", message: "Reload the page and try again." };
  }

  const { household, raw, result } = await validate(householdId.data, formData);
  if (!result.ok) {
    return { status: "error", fieldErrors: result.fieldErrors, raw };
  }

  const { expense } = result;
  const supabase = await createClient();
  const { data: expenseId, error } = await supabase.rpc("create_expense", {
    target_household_id: household.id,
    title: expense.description,
    amount: Number(expense.amountMinor),
    expense_category: expense.category,
    spent_on: expense.expenseDate,
    payer_id: expense.paidBy,
    method: expense.splitMethod,
    shares: sharesJson(expense.shares),
    request_key: requestKey.data,
  });
  if (error || !expenseId) {
    return {
      status: "error",
      message: householdErrorMessage(error?.code),
      raw,
    };
  }

  revalidateHouseholdPages();
  redirect(`/households/${household.id}/expenses/${expenseId}?created=1`);
}

/**
 * The reviewed expense from a receipt (roadmap Phase 19, D31): the same
 * checks as createExpense, then create_expense_with_receipt records it and
 * attaches the receipt in one transaction. Nothing read from the receipt is
 * used unless the person submitted it in this form.
 */
export async function createExpenseFromReceipt(
  _previous: ExpenseFormState,
  formData: FormData,
): Promise<ExpenseFormState> {
  await requireUser();
  const parsed = z
    .object({
      householdId: z.uuid(),
      receiptId: z.uuid(),
      requestKey: z.uuid(),
    })
    .safeParse({
      householdId: formValue(formData, "householdId"),
      receiptId: formValue(formData, "receiptId"),
      requestKey: formValue(formData, "requestKey"),
    });
  if (!parsed.success) {
    return { status: "error", message: "Reload the page and try again." };
  }

  const { household, raw, result } = await validate(
    parsed.data.householdId,
    formData,
  );
  if (!result.ok) {
    return { status: "error", fieldErrors: result.fieldErrors, raw };
  }

  const { expense } = result;
  const supabase = await createClient();
  const { data: expenseId, error } = await supabase.rpc(
    "create_expense_with_receipt",
    {
      target_receipt_id: parsed.data.receiptId,
      title: expense.description,
      amount: Number(expense.amountMinor),
      expense_category: expense.category,
      spent_on: expense.expenseDate,
      payer_id: expense.paidBy,
      method: expense.splitMethod,
      shares: sharesJson(expense.shares),
      request_key: parsed.data.requestKey,
    },
  );
  if (error || !expenseId) {
    return {
      status: "error",
      message: householdErrorMessage(error?.code),
      raw,
    };
  }

  revalidateHouseholdPages();
  redirect(
    `/households/${household.id}/expenses/${expenseId}?created=1&receipt=1`,
  );
}

const receiptIds = z.object({ householdId: z.uuid(), receiptId: z.uuid() });

/** Throws away your own receipt that isn't on an expense: file, then row. */
export async function discardReceipt(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const parsed = receiptIds.safeParse({
    householdId: formValue(formData, "householdId"),
    receiptId: formValue(formData, "receiptId"),
  });
  if (!parsed.success) return { status: "error", message: GENERIC_ERROR };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("receipts")
    .select("storage_path, status")
    .eq("id", parsed.data.receiptId)
    .maybeSingle();
  if (!row || (row.status !== "pending" && row.status !== "uploaded")) {
    return { status: "error", message: householdErrorMessage("HJ035") };
  }
  // The file first: a row without its file is harmless, a file without its
  // row can't be reached any more.
  if (!(await removeReceiptFiles(supabase, [row.storage_path]))) {
    return {
      status: "error",
      message: "The receipt couldn't be deleted. Try again.",
    };
  }
  const { error } = await supabase.rpc("discard_receipt", {
    target_receipt_id: parsed.data.receiptId,
  });
  if (error)
    return { status: "error", message: householdErrorMessage(error.code) };

  return { status: "success", message: "The receipt is discarded." };
}

/** Takes the receipt off an expense (D6 people); the expense is untouched. */
export async function removeReceipt(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const parsed = receiptIds.safeParse({
    householdId: formValue(formData, "householdId"),
    receiptId: formValue(formData, "receiptId"),
  });
  if (!parsed.success) return { status: "error", message: GENERIC_ERROR };

  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("remove_receipt", {
    target_receipt_id: parsed.data.receiptId,
  });
  if (error || !path) {
    return { status: "error", message: householdErrorMessage(error?.code) };
  }
  // If deleting the file fails now, it's retried the next time this person
  // uploads a receipt (my_receipt_files_to_clear).
  await removeReceiptFiles(supabase, [path]);

  revalidateHouseholdPages();
  refresh();
  return {
    status: "success",
    message: "The receipt is removed. The expense hasn't changed.",
  };
}

/** Attaches your uploaded receipt to an expense (D6), replacing any other. */
export async function attachReceipt(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const parsed = z
    .object({ householdId: z.uuid(), expenseId: z.uuid(), receiptId: z.uuid() })
    .safeParse({
      householdId: formValue(formData, "householdId"),
      expenseId: formValue(formData, "expenseId"),
      receiptId: formValue(formData, "receiptId"),
    });
  if (!parsed.success) return { status: "error", message: GENERIC_ERROR };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attach_receipt", {
    target_expense_id: parsed.data.expenseId,
    target_receipt_id: parsed.data.receiptId,
  });
  if (error)
    return { status: "error", message: householdErrorMessage(error.code) };
  const removedPath = (data as { removed_path: string | null } | null)
    ?.removed_path;
  if (removedPath) await removeReceiptFiles(supabase, [removedPath]);

  revalidateHouseholdPages();
  refresh();
  return {
    status: "success",
    message: removedPath
      ? "The receipt is replaced."
      : "The receipt is attached.",
  };
}

export async function updateExpense(
  _previous: ExpenseFormState,
  formData: FormData,
): Promise<ExpenseFormState> {
  await requireUser();
  const parsed = ids.safeParse({
    householdId: formValue(formData, "householdId"),
    expenseId: formValue(formData, "expenseId"),
  });
  const expectedUpdatedAt = z.iso
    .datetime({ offset: true })
    .safeParse(formValue(formData, "expectedUpdatedAt"));
  if (!parsed.success || !expectedUpdatedAt.success) {
    return { status: "error", message: "Reload the page and try again." };
  }

  const { household, raw, result } = await validate(
    parsed.data.householdId,
    formData,
  );
  if (!result.ok) {
    return { status: "error", fieldErrors: result.fieldErrors, raw };
  }

  const { expense } = result;
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_expense", {
    target_expense_id: parsed.data.expenseId,
    title: expense.description,
    amount: Number(expense.amountMinor),
    expense_category: expense.category,
    spent_on: expense.expenseDate,
    payer_id: expense.paidBy,
    method: expense.splitMethod,
    shares: sharesJson(expense.shares),
    expected_updated_at: expectedUpdatedAt.data,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code), raw };
  }

  revalidateHouseholdPages();
  redirect(
    `/households/${household.id}/expenses/${parsed.data.expenseId}?updated=1`,
  );
}

export async function deleteExpense(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const parsed = ids.safeParse({
    householdId: formValue(formData, "householdId"),
    expenseId: formValue(formData, "expenseId"),
  });
  if (!parsed.success) return { status: "error", message: GENERIC_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_expense", {
    target_expense_id: parsed.data.expenseId,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code) };
  }

  revalidateHouseholdPages();
  redirect(`/households/${parsed.data.householdId}/expenses?deleted=1`);
}

export async function restoreExpense(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const parsed = ids.safeParse({
    householdId: formValue(formData, "householdId"),
    expenseId: formValue(formData, "expenseId"),
  });
  if (!parsed.success) return { status: "error", message: GENERIC_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_expense", {
    target_expense_id: parsed.data.expenseId,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code) };
  }

  revalidateHouseholdPages();
  refresh();
  return { status: "success", message: "The expense is restored." };
}
