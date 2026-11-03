"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { authErrorMessage, GENERIC_ERROR } from "@/lib/auth/errors";
import { formValue, type FormState } from "@/lib/auth/form-state";
import {
  fieldErrors,
  newPasswordSchema,
  profileSchema,
} from "@/lib/auth/schemas";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  // Ends this device's session on the server and clears the cookies.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/sign-in?signed_out=1");
}

export async function updateProfile(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  // The id comes from the verified session, never from the form.
  const user = await requireUser();
  const displayName = formValue(formData, "displayName");
  const parsed = profileSchema.safeParse({ displayName });
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrors(parsed.error),
      values: { displayName },
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.displayName })
    .eq("id", user.id)
    .select("display_name")
    .maybeSingle();
  if (error || !data) {
    return { status: "error", message: GENERIC_ERROR, values: { displayName } };
  }

  // Re-render so the header shows the new name too.
  refresh();
  return {
    status: "success",
    message: "Your profile is saved.",
    values: { displayName: data.display_name },
  };
}

export async function updatePassword(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const parsed = newPasswordSchema.safeParse({
    password: formValue(formData, "password"),
    confirmPassword: formValue(formData, "confirmPassword"),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return { status: "error", message: authErrorMessage(error.code) };
  }

  return { status: "success", message: "Your password has been changed." };
}
