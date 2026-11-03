"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import { TextField } from "@/components/text-field";
import { FieldGroup } from "@/components/ui/field";
import { initialFormState } from "@/lib/auth/form-state";
import { signIn } from "../actions";

export type SignInNotice = "signed-out" | "invalid-link";

const NOTICES: Record<SignInNotice, { tone: "info" | "error"; text: string }> =
  {
    "signed-out": { tone: "info", text: "You've signed out." },
    "invalid-link": {
      tone: "error",
      text: "That link is invalid or has expired. Sign in, or ask for a new link.",
    },
  };

export function SignInForm({
  next,
  notice,
}: {
  next: string;
  notice?: SignInNotice;
}) {
  const [state, formAction] = useActionState(signIn, initialFormState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate className="space-y-5">
      {state.status === "error" && state.message ? (
        <FormAlert tone="error">{state.message}</FormAlert>
      ) : notice ? (
        <FormAlert tone={NOTICES[notice].tone}>
          {NOTICES[notice].text}
        </FormAlert>
      ) : null}

      <input type="hidden" name="next" value={next} />
      <FieldGroup>
        <TextField
          id="sign-in-email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
          error={errors.email}
        />
        <TextField
          id="sign-in-password"
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          required
          error={errors.password}
        />
      </FieldGroup>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
        <Link
          href="/forgot-password"
          className="type-secondary font-medium text-primary underline underline-offset-4"
        >
          Forgot your password?
        </Link>
      </div>
    </form>
  );
}
