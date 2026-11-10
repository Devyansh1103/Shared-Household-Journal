"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { initialFormState } from "@/lib/auth/form-state";
import { acceptInvite } from "./actions";

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(acceptInvite, initialFormState);

  return (
    <form action={formAction} className="space-y-4">
      {state.status === "error" && state.message ? (
        <FormAlert tone="error">{state.message}</FormAlert>
      ) : null}
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <SubmitButton pendingLabel="Joining…">Join household</SubmitButton>
        <Button variant="ghost" asChild>
          <Link href="/home">Not now</Link>
        </Button>
      </div>
    </form>
  );
}
