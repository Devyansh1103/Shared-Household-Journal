"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import { TextField } from "@/components/text-field";
import { FieldGroup } from "@/components/ui/field";
import { initialFormState } from "@/lib/auth/form-state";
import { updateProfile } from "../actions";

export function ProfileForm({
  displayName,
  email,
}: {
  displayName: string;
  email: string;
}) {
  const [state, formAction] = useActionState(updateProfile, initialFormState);

  return (
    <form action={formAction} noValidate className="space-y-5">
      {state.status === "error" && state.message ? (
        <FormAlert tone="error">{state.message}</FormAlert>
      ) : null}
      {state.status === "success" ? (
        <FormAlert tone="success">{state.message}</FormAlert>
      ) : null}

      <FieldGroup>
        <TextField
          id="profile-name"
          name="displayName"
          label="Your name"
          description="Shown to the people in your households."
          autoComplete="name"
          maxLength={80}
          required
          defaultValue={state.values?.displayName ?? displayName}
          error={state.fieldErrors?.displayName}
        />
        <div className="space-y-1">
          <p className="type-label">Email</p>
          <p className="type-body break-all">{email}</p>
          <p className="type-help">
            Only you can see your email address. It can&apos;t be changed yet.
          </p>
        </div>
      </FieldGroup>

      <SubmitButton pendingLabel="Saving…">Save profile</SubmitButton>
    </form>
  );
}
