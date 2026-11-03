"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import { TextField } from "@/components/text-field";
import { FieldGroup } from "@/components/ui/field";
import { initialFormState } from "@/lib/auth/form-state";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/schemas";
import { signUp } from "../actions";

export function SignUpForm() {
  const [state, formAction] = useActionState(signUp, initialFormState);
  const errors = state.fieldErrors ?? {};

  if (state.status === "success") {
    return (
      <div className="space-y-3">
        <FormAlert tone="success">{state.message}</FormAlert>
        <p className="type-secondary">
          The link expires in an hour. If it doesn&apos;t arrive, check your
          spam folder, or sign up again with the same address to get a new one.
        </p>
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
          id="sign-up-name"
          name="displayName"
          label="Your name"
          description="Shown to the people in your households."
          autoComplete="name"
          maxLength={80}
          required
          defaultValue={state.values?.displayName}
          error={errors.displayName}
        />
        <TextField
          id="sign-up-email"
          name="email"
          type="email"
          label="Email"
          description="Only you can see this."
          autoComplete="email"
          required
          defaultValue={state.values?.email}
          error={errors.email}
        />
        <TextField
          id="sign-up-password"
          name="password"
          type="password"
          label="Password"
          description={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          autoComplete="new-password"
          required
          error={errors.password}
        />
      </FieldGroup>

      <SubmitButton pendingLabel="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}
