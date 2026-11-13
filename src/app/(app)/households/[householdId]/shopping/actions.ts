"use server";

import { randomUUID } from "node:crypto";
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { GENERIC_ERROR } from "@/lib/auth/errors";
import { formValue, type FormState } from "@/lib/auth/form-state";
import { requireUser } from "@/lib/auth/session";
import { householdErrorMessage } from "@/lib/households/errors";
import { getHousehold, listMembersInJoinOrder } from "@/lib/households/queries";
import {
  readItemForm,
  validateItem,
  type RawItemForm,
} from "@/lib/shopping/form";
import { itemLabel } from "@/lib/shopping/list";
import { getShoppingItem } from "@/lib/shopping/queries";
import { createClient } from "@/lib/supabase/server";

// The shopping list (roadmap Phase 15). Every action re-checks the session.
// The caller is auth.uid() inside the database functions; ids in a form only
// name the household, the item and the assignee, and the functions check them
// (membership, the assignee being a current member) again.

export type ItemFormState = FormState & {
  raw?: RawItemForm;
  /** A fresh key for the next item, once one has been added. */
  nextKey?: string;
};

const ids = z.object({ householdId: z.uuid(), itemId: z.uuid() });

/** The shopping list, the Household page and the journal. */
function revalidateHouseholdPages() {
  revalidatePath("/households/[householdId]", "layout");
}

function readIds(formData: FormData) {
  return ids.safeParse({
    householdId: formValue(formData, "householdId"),
    itemId: formValue(formData, "itemId"),
  });
}

async function memberIds(householdId: string) {
  const household = await getHousehold(householdId);
  const members = await listMembersInJoinOrder(household.id);
  return { household, memberIds: members.map((m) => m.userId) };
}

/** Adds an item and stays on the list, ready for the next one. */
export async function addItem(
  _previous: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  await requireUser();
  const householdId = z.uuid().safeParse(formValue(formData, "householdId"));
  const requestKey = z.uuid().safeParse(formValue(formData, "requestKey"));
  if (!householdId.success || !requestKey.success) {
    return { status: "error", message: "Reload the page and try again." };
  }

  const ctx = await memberIds(householdId.data);
  const raw = readItemForm(formData);
  const result = validateItem(raw, ctx);
  if (!result.ok)
    return { status: "error", fieldErrors: result.fieldErrors, raw };

  const item = result.value;
  const supabase = await createClient();
  const { data: itemId, error } = await supabase.rpc("add_shopping_item", {
    target_household_id: ctx.household.id,
    item_name: item.name,
    ...(item.quantity ? { item_quantity: item.quantity } : {}),
    ...(item.note ? { item_note: item.note } : {}),
    ...(item.assigneeId ? { item_assignee_id: item.assigneeId } : {}),
    request_key: requestKey.data,
  });
  if (error || !itemId) {
    return {
      status: "error",
      message: householdErrorMessage(error?.code),
      raw,
    };
  }

  revalidateHouseholdPages();
  return {
    status: "success",
    message: `Added ${itemLabel(item)} to the list.`,
    nextKey: randomUUID(),
  };
}

export async function updateItem(
  _previous: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  await requireUser();
  const parsed = readIds(formData);
  const expectedUpdatedAt = z.iso
    .datetime({ offset: true })
    .safeParse(formValue(formData, "expectedUpdatedAt"));
  if (!parsed.success || !expectedUpdatedAt.success) {
    return { status: "error", message: "Reload the page and try again." };
  }

  // The item as it is now, read under RLS: a 404 for anyone else's.
  const { household, view } = await getShoppingItem(
    parsed.data.householdId,
    parsed.data.itemId,
  );
  if (view.state === "removed") {
    return { status: "error", message: householdErrorMessage("HJ028") };
  }
  const { memberIds: active } = await memberIds(household.id);
  const raw = readItemForm(formData);
  const result = validateItem(raw, {
    memberIds: active,
    currentAssigneeId: view.item.assigneeId,
  });
  if (!result.ok)
    return { status: "error", fieldErrors: result.fieldErrors, raw };

  const item = result.value;
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_shopping_item", {
    target_item_id: view.item.id,
    item_name: item.name,
    ...(item.quantity ? { item_quantity: item.quantity } : {}),
    ...(item.note ? { item_note: item.note } : {}),
    ...(item.assigneeId ? { item_assignee_id: item.assigneeId } : {}),
    expected_updated_at: expectedUpdatedAt.data,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code), raw };
  }

  revalidateHouseholdPages();
  redirect(`/households/${household.id}/shopping?updated=1`);
}

type ItemCall =
  "purchase_shopping_item" | "reopen_shopping_item" | "remove_shopping_item";

async function itemAction(
  formData: FormData,
  fn: ItemCall,
  success: (name: string) => string,
): Promise<FormState> {
  await requireUser();
  const parsed = readIds(formData);
  if (!parsed.success) return { status: "error", message: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, {
    target_item_id: parsed.data.itemId,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code) };
  }
  revalidateHouseholdPages();
  refresh();
  // The name only echoes what the form showed; nothing is read back from it.
  const name = formValue(formData, "itemName").slice(0, 200);
  return { status: "success", message: success(name || "The item") };
}

export async function purchaseItem(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return itemAction(
    formData,
    "purchase_shopping_item",
    (name) => `${name} is marked as bought.`,
  );
}

export async function reopenItem(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return itemAction(
    formData,
    "reopen_shopping_item",
    (name) => `${name} is back on the list.`,
  );
}

export async function removeItem(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return itemAction(
    formData,
    "remove_shopping_item",
    (name) => `${name} is off the list.`,
  );
}
