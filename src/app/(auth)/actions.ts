"use server";

import { redirect } from "next/navigation";
import {
  authErrorMessage,
  GENERIC_ERROR,
  isExistingAccountError,
} from "@/lib/auth/errors";
import { formValue, type FormState } from "@/lib/auth/form-state";
import { safeReturnPath } from "@/lib/auth/return-path";
import {
  fieldErrors,
  forgotPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";

export async function signIn(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = formValue(formData, "email");
  const parsed = signInSchema.safeParse({
    email,
    password: formValue(formData, "password"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrors(parsed.error),
      values: { email },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return {
      status: "error",
      message: authErrorMessage(error.code),
      values: { email },
    };
  }

  redirect(safeReturnPath(formValue(formData, "next")));
}

export async function signUp(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = {
    displayName: formValue(formData, "displayName"),
    email: formValue(formData, "email"),
  };
  const parsed = signUpSchema.safeParse({
    ...values,
    password: formValue(formData, "password"),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrors(parsed.error), values };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    // Read by the on_auth_user_created trigger to create the profile.
    options: { data: { display_name: parsed.data.displayName } },
  });

  // With email confirmation on, Supabase answers a duplicate sign-up like a
  // new one. Treat an explicit "already exists" the same way, so this form
  // never reveals whether an account exists.
  if (error && !isExistingAccountError(error.code)) {
    return { status: "error", message: authErrorMessage(error.code), values };
  }

  return {
    status: "success",
    message: `We've sent a confirmation link to ${parsed.data.email}. Open it to finish creating your account.`,
  };
}

export async function requestPasswordReset(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = formValue(formData, "email");
  const parsed = forgotPasswordSchema.safeParse({ email });
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrors(parsed.error),
      values: { email },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
  );

  // Rate limits apply whether or not the account exists, so saying so reveals
  // nothing. Any other outcome gets the same neutral answer.
  if (error && error.code?.startsWith("over_")) {
    return {
      status: "error",
      message: authErrorMessage(error.code),
      values: { email },
    };
  }
  if (error && error.status && error.status >= 500) {
    return { status: "error", message: GENERIC_ERROR, values: { email } };
  }

  return {
    status: "success",
    message: `If there's an account for ${parsed.data.email}, we've sent it a link to choose a new password.`,
  };
}
