"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formValue, type FormState } from "@/lib/auth/form-state";
import { requireUser } from "@/lib/auth/session";
import {
  householdErrorMessage,
  INVITE_INVALID_MESSAGE,
} from "@/lib/households/errors";
import { inviteTokenSchema } from "@/lib/households/schemas";
import { createClient } from "@/lib/supabase/server";

export async function acceptInvite(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  // Joining requires a verified session (D5). The joining user is auth.uid()
  // inside accept_invite, never a value from this form.
  await requireUser();
  const token = inviteTokenSchema.safeParse(formValue(formData, "token"));
  if (!token.success) {
    return { status: "error", message: INVITE_INVALID_MESSAGE };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("accept_invite", { token: token.data })
    .single();
  if (error || !data) {
    return { status: "error", message: householdErrorMessage(error?.code) };
  }

  const notice = data.already_member ? "already" : "joined";
  // The shell's household switcher lives in the shared layout: re-render it.
  revalidatePath("/", "layout");
  redirect(`/households/${data.joined_household_id}?${notice}=1`);
}
