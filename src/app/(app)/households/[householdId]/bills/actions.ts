"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { GENERIC_ERROR } from "@/lib/auth/errors";
import { formValue, type FormState } from "@/lib/auth/form-state";
import { requireUser } from "@/lib/auth/session";
import {
  readBillForm,
  validateBillDetails,
  validateNewBill,
  validateNewSchedule,
  type RawBillForm,
} from "@/lib/bills/form";
import { getBill } from "@/lib/bills/queries";
import { todayIn } from "@/lib/expenses/dates";
import {
  readExpenseForm,
  sharesJson,
  validateExpenseForm,
} from "@/lib/expenses/form";
import { currencyExponent } from "@/lib/format";
import { householdErrorMessage } from "@/lib/households/errors";
import { getHousehold, listMembersInJoinOrder } from "@/lib/households/queries";
import { createClient } from "@/lib/supabase/server";
import type { ExpenseFormState } from "../expenses/actions";

// Recurring bills (roadmap Phase 14). Every action re-checks the session. The
// caller is auth.uid() inside the database functions; ids in a form only name
// the household, the bill, a period's due date, the payer and the
// participants, and the functions check all of them (membership, D27's
// rights, the money invariants) again. A recorded expense's household is the
// bill's, never the form's.

export type BillFormState = FormState & { raw?: RawBillForm };

const ids = z.object({ householdId: z.uuid(), billId: z.uuid() });
const dueOn = z.iso.date();

/** Bill, expense, balance and journal pages under every household. */
function revalidateHouseholdPages() {
  revalidatePath("/households/[householdId]", "layout");
}

function readIds(formData: FormData) {
  return ids.safeParse({
    householdId: formValue(formData, "householdId"),
    billId: formValue(formData, "billId"),
  });
}

async function context(householdId: string) {
  const household = await getHousehold(householdId);
  const members = await listMembersInJoinOrder(household.id);
  return {
    household,
    memberIds: members.map((m) => m.userId),
    exponent: currencyExponent(household.currencyCode),
    today: todayIn(household.timezone),
  };
}

export async function createBill(
  _previous: BillFormState,
  formData: FormData,
): Promise<BillFormState> {
  await requireUser();
  const householdId = z.uuid().safeParse(formValue(formData, "householdId"));
  const requestKey = z.uuid().safeParse(formValue(formData, "requestKey"));
  if (!householdId.success || !requestKey.success) {
    return { status: "error", message: "Reload the page and try again." };
  }

  const ctx = await context(householdId.data);
  const raw = readBillForm(formData);
  const result = validateNewBill(raw, ctx);
  if (!result.ok)
    return { status: "error", fieldErrors: result.fieldErrors, raw };

  const { details, schedule } = result.value;
  const supabase = await createClient();
  const { data: billId, error } = await supabase.rpc("create_recurring_bill", {
    target_household_id: ctx.household.id,
    title: details.description,
    amount: Number(details.amountMinor),
    bill_category: details.category,
    bill_payer_id: details.payerId,
    method: details.splitMethod,
    shares: sharesJson(details.shares),
    repeat_unit: schedule.unit,
    repeat_every: schedule.every,
    first_due_on: schedule.startsOn,
    ...(details.endsOn ? { last_due_on: details.endsOn } : {}),
    ...(details.notes ? { memo: details.notes } : {}),
    request_key: requestKey.data,
  });
  if (error || !billId) {
    return {
      status: "error",
      message: householdErrorMessage(error?.code),
      raw,
    };
  }

  revalidateHouseholdPages();
  redirect(`/households/${ctx.household.id}/bills/${billId}?created=1`);
}

export async function updateBill(
  _previous: BillFormState,
  formData: FormData,
): Promise<BillFormState> {
  await requireUser();
  const parsed = readIds(formData);
  const expectedUpdatedAt = z.iso
    .datetime({ offset: true })
    .safeParse(formValue(formData, "expectedUpdatedAt"));
  if (!parsed.success || !expectedUpdatedAt.success) {
    return { status: "error", message: "Reload the page and try again." };
  }

  const ctx = await context(parsed.data.householdId);
  const raw = readBillForm(formData);
  const result = validateBillDetails(raw, ctx);
  if (!result.ok)
    return { status: "error", fieldErrors: result.fieldErrors, raw };

  const details = result.value;
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_recurring_bill", {
    target_bill_id: parsed.data.billId,
    title: details.description,
    amount: Number(details.amountMinor),
    bill_category: details.category,
    bill_payer_id: details.payerId,
    method: details.splitMethod,
    shares: sharesJson(details.shares),
    ...(details.endsOn ? { last_due_on: details.endsOn } : {}),
    ...(details.notes ? { memo: details.notes } : {}),
    expected_updated_at: expectedUpdatedAt.data,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code), raw };
  }

  revalidateHouseholdPages();
  redirect(
    `/households/${ctx.household.id}/bills/${parsed.data.billId}?updated=1`,
  );
}

export async function rescheduleBill(
  _previous: BillFormState,
  formData: FormData,
): Promise<BillFormState> {
  await requireUser();
  const parsed = readIds(formData);
  const expectedUpdatedAt = z.iso
    .datetime({ offset: true })
    .safeParse(formValue(formData, "expectedUpdatedAt"));
  if (!parsed.success || !expectedUpdatedAt.success) {
    return { status: "error", message: "Reload the page and try again." };
  }

  // The bill as it is now, read under RLS: a 404 for anyone else's.
  const { household, view } = await getBill(
    parsed.data.householdId,
    parsed.data.billId,
  );
  if (!view.ok) return { status: "error", message: GENERIC_ERROR };
  const raw = readBillForm(formData);
  const result = validateNewSchedule(raw, {
    today: todayIn(household.timezone),
    latestStoredDueOn: view.detail.bill.latestStoredDueOn,
  });
  if (!result.ok)
    return { status: "error", fieldErrors: result.fieldErrors, raw };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reschedule_recurring_bill", {
    target_bill_id: parsed.data.billId,
    repeat_unit: result.value.unit,
    repeat_every: result.value.every,
    next_due_on: result.value.startsOn,
    expected_updated_at: expectedUpdatedAt.data,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code), raw };
  }

  revalidateHouseholdPages();
  redirect(
    `/households/${household.id}/bills/${parsed.data.billId}?rescheduled=1`,
  );
}

type LifecycleCall =
  "pause_recurring_bill" | "resume_recurring_bill" | "end_recurring_bill";

async function lifecycle(
  formData: FormData,
  fn: LifecycleCall,
  success: string,
): Promise<FormState> {
  await requireUser();
  const parsed = readIds(formData);
  if (!parsed.success) return { status: "error", message: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, {
    target_bill_id: parsed.data.billId,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code) };
  }
  revalidateHouseholdPages();
  refresh();
  return { status: "success", message: success };
}

export async function pauseBill(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return lifecycle(
    formData,
    "pause_recurring_bill",
    "The bill is paused. No new period comes until it's resumed.",
  );
}

export async function resumeBill(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return lifecycle(
    formData,
    "resume_recurring_bill",
    "The bill is resumed from its next due date.",
  );
}

export async function endBill(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return lifecycle(
    formData,
    "end_recurring_bill",
    "The bill has ended. No more periods will come.",
  );
}

async function period(
  formData: FormData,
  fn: "skip_bill_occurrence" | "unskip_bill_occurrence",
  success: string,
): Promise<FormState> {
  await requireUser();
  const parsed = readIds(formData);
  const due = dueOn.safeParse(formValue(formData, "dueOn"));
  if (!parsed.success || !due.success) {
    return { status: "error", message: GENERIC_ERROR };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, {
    target_bill_id: parsed.data.billId,
    occurrence_due_on: due.data,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code) };
  }
  revalidateHouseholdPages();
  refresh();
  return { status: "success", message: success };
}

export async function skipPeriod(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return period(
    formData,
    "skip_bill_occurrence",
    "The period is skipped. No expense was recorded.",
  );
}

export async function unskipPeriod(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return period(
    formData,
    "unskip_bill_occurrence",
    "The skip is undone. The period is open again.",
  );
}

/**
 * "Record this bill" (D10, ADR-010): the expense form, pre-filled from the
 * bill, recorded and linked to the period in one transaction. A repeated
 * submission returns the same expense.
 */
export async function recordBill(
  _previous: ExpenseFormState,
  formData: FormData,
): Promise<ExpenseFormState> {
  await requireUser();
  const parsed = readIds(formData);
  const due = dueOn.safeParse(formValue(formData, "dueOn"));
  const requestKey = z.uuid().safeParse(formValue(formData, "requestKey"));
  if (!parsed.success || !due.success || !requestKey.success) {
    return { status: "error", message: "Reload the page and try again." };
  }

  const household = await getHousehold(parsed.data.householdId);
  const members = await listMembersInJoinOrder(household.id);
  const raw = readExpenseForm(formData);
  const result = validateExpenseForm(raw, {
    memberIds: members.map((m) => m.userId),
    exponent: currencyExponent(household.currencyCode),
  });
  if (!result.ok) {
    return { status: "error", fieldErrors: result.fieldErrors, raw };
  }

  const { expense } = result;
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_bill_payment", {
    target_bill_id: parsed.data.billId,
    occurrence_due_on: due.data,
    title: expense.description,
    amount: Number(expense.amountMinor),
    expense_category: expense.category,
    spent_on: expense.expenseDate,
    payer_id: expense.paidBy,
    method: expense.splitMethod,
    shares: sharesJson(expense.shares),
    request_key: requestKey.data,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code), raw };
  }

  revalidateHouseholdPages();
  redirect(
    `/households/${household.id}/bills/${parsed.data.billId}?recorded=${due.data}`,
  );
}
