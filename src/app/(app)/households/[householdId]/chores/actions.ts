"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { GENERIC_ERROR } from "@/lib/auth/errors";
import { formValue, type FormState } from "@/lib/auth/form-state";
import { requireUser } from "@/lib/auth/session";
import {
  readChoreForm,
  validateChore,
  type RawChoreForm,
} from "@/lib/chores/form";
import { getChore } from "@/lib/chores/queries";
import { todayIn } from "@/lib/expenses/dates";
import { householdErrorMessage } from "@/lib/households/errors";
import { getHousehold, listMembersInJoinOrder } from "@/lib/households/queries";
import { createClient } from "@/lib/supabase/server";

// Chores (roadmap Phase 15). Every action re-checks the session. The caller is
// auth.uid() inside the database functions; ids in a form only name the
// household, the chore and the assignee, and the functions check them
// (membership, D28's rights, the assignee being a current member) again.

export type ChoreFormState = FormState & { raw?: RawChoreForm };

const ids = z.object({ householdId: z.uuid(), choreId: z.uuid() });

function revalidateHouseholdPages() {
  revalidatePath("/households/[householdId]", "layout");
}

function readIds(formData: FormData) {
  return ids.safeParse({
    householdId: formValue(formData, "householdId"),
    choreId: formValue(formData, "choreId"),
  });
}

async function context(householdId: string) {
  const household = await getHousehold(householdId);
  const members = await listMembersInJoinOrder(household.id);
  return {
    household,
    memberIds: members.map((m) => m.userId),
    today: todayIn(household.timezone),
  };
}

export async function createChore(
  _previous: ChoreFormState,
  formData: FormData,
): Promise<ChoreFormState> {
  await requireUser();
  const householdId = z.uuid().safeParse(formValue(formData, "householdId"));
  const requestKey = z.uuid().safeParse(formValue(formData, "requestKey"));
  if (!householdId.success || !requestKey.success) {
    return { status: "error", message: "Reload the page and try again." };
  }

  const ctx = await context(householdId.data);
  const raw = readChoreForm(formData);
  const result = validateChore(raw, ctx);
  if (!result.ok)
    return { status: "error", fieldErrors: result.fieldErrors, raw };

  const chore = result.value;
  const supabase = await createClient();
  const { data: choreId, error } = await supabase.rpc("create_chore", {
    target_household_id: ctx.household.id,
    chore_title: chore.title,
    ...(chore.description ? { chore_description: chore.description } : {}),
    ...(chore.assigneeId ? { chore_assignee_id: chore.assigneeId } : {}),
    ...(chore.dueOn ? { chore_due_on: chore.dueOn } : {}),
    chore_priority_level: chore.priority,
    request_key: requestKey.data,
  });
  if (error || !choreId) {
    return {
      status: "error",
      message: householdErrorMessage(error?.code),
      raw,
    };
  }

  revalidateHouseholdPages();
  redirect(`/households/${ctx.household.id}/chores?created=1`);
}

export async function updateChore(
  _previous: ChoreFormState,
  formData: FormData,
): Promise<ChoreFormState> {
  await requireUser();
  const parsed = readIds(formData);
  const expectedUpdatedAt = z.iso
    .datetime({ offset: true })
    .safeParse(formValue(formData, "expectedUpdatedAt"));
  if (!parsed.success || !expectedUpdatedAt.success) {
    return { status: "error", message: "Reload the page and try again." };
  }

  // The chore as it is now, read under RLS: a 404 for anyone else's.
  const { household, view } = await getChore(
    parsed.data.householdId,
    parsed.data.choreId,
  );
  if (view.state === "removed") {
    return { status: "error", message: householdErrorMessage("HJ028") };
  }
  const ctx = await context(household.id);
  const raw = readChoreForm(formData);
  const result = validateChore(raw, {
    ...ctx,
    current: { assigneeId: view.chore.assigneeId, dueOn: view.chore.dueOn },
  });
  if (!result.ok)
    return { status: "error", fieldErrors: result.fieldErrors, raw };

  const chore = result.value;
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_chore", {
    target_chore_id: view.chore.id,
    chore_title: chore.title,
    ...(chore.description ? { chore_description: chore.description } : {}),
    ...(chore.assigneeId ? { chore_assignee_id: chore.assigneeId } : {}),
    ...(chore.dueOn ? { chore_due_on: chore.dueOn } : {}),
    chore_priority_level: chore.priority,
    expected_updated_at: expectedUpdatedAt.data,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code), raw };
  }

  revalidateHouseholdPages();
  redirect(`/households/${household.id}/chores?updated=1`);
}

type ChoreCall = "complete_chore" | "reopen_chore" | "remove_chore";

async function choreAction(
  formData: FormData,
  fn: ChoreCall,
  success: (title: string) => string,
): Promise<FormState> {
  await requireUser();
  const parsed = readIds(formData);
  if (!parsed.success) return { status: "error", message: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, {
    target_chore_id: parsed.data.choreId,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code) };
  }
  revalidateHouseholdPages();
  refresh();
  // The title only echoes what the form showed; nothing is read back from it.
  const title = formValue(formData, "choreTitle").slice(0, 200);
  return { status: "success", message: success(title || "The chore") };
}

export async function completeChore(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return choreAction(formData, "complete_chore", (t) => `${t} is done.`);
}

export async function reopenChore(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return choreAction(
    formData,
    "reopen_chore",
    (t) => `${t} is back on the to-do list.`,
  );
}

export async function removeChore(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return choreAction(formData, "remove_chore", (t) => `${t} is removed.`);
}
