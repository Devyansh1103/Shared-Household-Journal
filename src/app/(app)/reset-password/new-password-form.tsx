"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import { TextField } from "@/components/text-field";
import { FieldGroup } from "@/components/ui/field";
import { initialFormState } from "@/lib/auth/form-state";
import { SIGNED_IN_HOME } from "@/lib/auth/return-path";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/schemas";
import { updatePassword } from "../actions";

export function NewPasswordForm() {
  const [state, formAction] = useActionState(updatePassword, initialFormState);
  const errors = state.fieldErrors ?? {};

  if (state.status === "success") {
    return (
      <div className="space-y-4">
        <FormAlert tone="success">{state.message}</FormAlert>
        <Link
          href={SIGNED_IN_HOME}
          className="type-secondary font-medium text-primary underline underline-offset-4"
        >
          Go to your home page
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className="space-y-5">
      {state.status === "error" && state.message ? (
        <FormAlert tone="error">{state.message}</FormAlert>
      ) : null}
      <FieldGroup>
        <TextField
          id="new-password"
          name="password"
          type="password"
          label="New password"
          description={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          autoComplete="new-password"
          required
          error={errors.password}
        />
        <TextField
          id="confirm-password"
          name="confirmPassword"
          type="password"
          label="Confirm new password"
          autoComplete="new-password"
          required
          error={errors.confirmPassword}
        />
      </FieldGroup>
      <SubmitButton pendingLabel="Saving…">Save new password</SubmitButton>
    </form>
  );
}
