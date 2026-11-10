"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { GENERIC_ERROR } from "@/lib/auth/errors";
import { formValue, type FormState } from "@/lib/auth/form-state";
import { fieldErrors } from "@/lib/auth/schemas";
import { requireUser } from "@/lib/auth/session";
import { householdErrorMessage } from "@/lib/households/errors";
import { createInviteToken, invitePath } from "@/lib/households/invite-token";
import {
  createHouseholdSchema,
  householdIdSchema,
  invitationActionSchema,
  memberActionSchema,
} from "@/lib/households/schemas";
import { createClient } from "@/lib/supabase/server";

// Every action re-checks the session itself. User ids for the caller come from
// the session inside the database functions (auth.uid()), never from the form;
// ids in the form only name the household or the member being acted on, and the
// functions check the caller's own membership and role before using them.

export type CreateInviteState = FormState & {
  invite?: { path: string; expiresAt: string; maxUses: number };
};

export async function createHousehold(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const values = {
    name: formValue(formData, "name"),
    currency: formValue(formData, "currency"),
    timezone: formValue(formData, "timezone"),
  };
  const parsed = createHouseholdSchema.safeParse({
    ...values,
    requestKey: formValue(formData, "requestKey"),
  });
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    if (errors.requestKey) {
      return {
        status: "error",
        message: "Reload the page and try again.",
        values,
      };
    }
    return { status: "error", fieldErrors: errors, values };
  }

  const supabase = await createClient();
  const { data: householdId, error } = await supabase.rpc("create_household", {
    household_name: parsed.data.name,
    currency: parsed.data.currency,
    time_zone: parsed.data.timezone,
    request_key: parsed.data.requestKey,
  });
  if (error || !householdId) {
    if (error?.code === "22023") {
      return {
        status: "error",
        fieldErrors: { timezone: householdErrorMessage(error.code) },
        values,
      };
    }
    return {
      status: "error",
      message: householdErrorMessage(error?.code),
      values,
    };
  }

  redirect(`/households/${householdId}?created=1`);
}

export async function createInvite(
  _previous: CreateInviteState,
  formData: FormData,
): Promise<CreateInviteState> {
  await requireUser();
  const householdId = householdIdSchema.safeParse(
    formValue(formData, "householdId"),
  );
  if (!householdId.success) return { status: "error", message: GENERIC_ERROR };

  // The raw token leaves the server only in this response; the database
  // stores its hash. RLS allows the insert for active members only (D4).
  const { token, tokenHash } = createInviteToken();
  const supabase = await createClient();
  // Expiry and use limit are the database defaults (D5); O6 is still open, so
  // members can't choose other values here.
  const { data, error } = await supabase
    .from("invitations")
    .insert({ household_id: householdId.data, token_hash: tokenHash })
    .select("expires_at, max_uses")
    .single();
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code) };
  }

  refresh();
  return {
    status: "success",
    message: "Your invite link is ready.",
    invite: {
      path: invitePath(token),
      expiresAt: data.expires_at,
      maxUses: data.max_uses,
    },
  };
}

export async function revokeInvite(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const parsed = invitationActionSchema.safeParse({
    householdId: formValue(formData, "householdId"),
    invitationId: formValue(formData, "invitationId"),
  });
  if (!parsed.success) return { status: "error", message: GENERIC_ERROR };

  // RLS allows this only for the invite's creator or the owner (D4).
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.invitationId)
    .eq("household_id", parsed.data.householdId)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code) };
  }
  if (data.length === 0) {
    return {
      status: "error",
      message:
        "That link couldn't be revoked. It may already be revoked, or only its creator or the owner can revoke it.",
    };
  }

  refresh();
  return { status: "success", message: "The invite link is revoked." };
}

export async function leaveHousehold(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const householdId = householdIdSchema.safeParse(
    formValue(formData, "householdId"),
  );
  if (!householdId.success) return { status: "error", message: GENERIC_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_household", {
    target_household_id: householdId.data,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code) };
  }

  redirect("/home?left=1");
}

export async function removeMember(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const parsed = memberActionSchema.safeParse({
    householdId: formValue(formData, "householdId"),
    userId: formValue(formData, "userId"),
  });
  if (!parsed.success) return { status: "error", message: GENERIC_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_member", {
    target_household_id: parsed.data.householdId,
    member_user_id: parsed.data.userId,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code) };
  }

  refresh();
  return { status: "success", message: "They've been removed." };
}

export async function transferOwnership(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const parsed = memberActionSchema.safeParse({
    householdId: formValue(formData, "householdId"),
    userId: formValue(formData, "userId"),
  });
  if (!parsed.success) return { status: "error", message: GENERIC_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_ownership", {
    target_household_id: parsed.data.householdId,
    new_owner_user_id: parsed.data.userId,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code) };
  }

  refresh();
  return { status: "success", message: "Ownership has been handed over." };
}

export async function deleteHousehold(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const householdId = householdIdSchema.safeParse(
    formValue(formData, "householdId"),
  );
  if (!householdId.success) return { status: "error", message: GENERIC_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_household", {
    target_household_id: householdId.data,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code) };
  }

  redirect("/home?deleted=1");
}
