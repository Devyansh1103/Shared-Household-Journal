"use client";

import { useActionState, useId, useSyncExternalStore } from "react";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { createInvite, type CreateInviteState } from "../actions";

const initialState: CreateInviteState = { status: "idle" };
const noSubscription = () => () => {};
const browserOrigin = () => window.location.origin;
const noOrigin = () => "";

/** Creates an invite link and shows it once. Nothing is emailed. */
export function InvitePanel({
  householdId,
  timeZone,
}: {
  householdId: string;
  timeZone: string;
}) {
  const [state, formAction] = useActionState(createInvite, initialState);
  const origin = useSyncExternalStore(noSubscription, browserOrigin, noOrigin);
  const link = state.invite ? `${origin}${state.invite.path}` : null;
  // Two households' pages can both be mounted (the previous one hidden).
  const linkId = `${useId()}-invite-link`;

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invite link copied.");
    } catch {
      toast.error("Couldn't copy the link. Select it and copy it yourself.");
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <form action={formAction}>
        <input type="hidden" name="householdId" value={householdId} />
        <SubmitButton pendingLabel="Creating link…">
          Create invite link
        </SubmitButton>
      </form>

      {state.status === "error" && state.message ? (
        <FormAlert tone="error">{state.message}</FormAlert>
      ) : null}

      {link && state.invite ? (
        <div className="space-y-3">
          <FormAlert tone="success">
            Copy this link now and send it yourself. For your security it&apos;s
            shown only once.
          </FormAlert>
          <Field>
            <FieldLabel htmlFor={linkId}>Invite link</FieldLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={linkId}
                readOnly
                value={link}
                onFocus={(event) => event.currentTarget.select()}
                aria-describedby={`${linkId}-help`}
                className="font-mono text-sm"
              />
              <Button type="button" variant="secondary" onClick={copy}>
                <CopyIcon aria-hidden="true" data-icon="inline-start" />
                Copy link
              </Button>
            </div>
            <FieldDescription id={`${linkId}-help`}>
              Works until {formatDateTime(state.invite.expiresAt, timeZone)},
              for up to {state.invite.maxUses} people.
            </FieldDescription>
          </Field>
        </div>
      ) : null}
    </div>
  );
}
