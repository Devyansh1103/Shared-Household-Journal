"use client";

import { useActionState, useId } from "react";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  CATEGORY_INFO,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "@/lib/notifications/categories";
import {
  saveNotificationPreferences,
  type PreferencesState,
} from "../../notifications/actions";

/**
 * One household's notification types (D12): a tick for each, all on until
 * switched off. Each save is numbered so the ticks start again from what's
 * saved: React resets a form's fields after its action, and an unticked box
 * would otherwise come back ticked, silently.
 */
export function PreferencesForm({
  householdId,
  householdName,
  muted,
}: {
  householdId: string;
  householdName: string;
  muted: NotificationCategory[];
}) {
  const [state, formAction] = useActionState<PreferencesState, FormData>(
    saveNotificationPreferences,
    { status: "idle" },
  );
  const uid = useId();

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="householdId" value={householdId} />
      <FieldSet>
        <FieldLegend className="type-card-title">{householdName}</FieldLegend>
        <FieldDescription>
          What you&apos;re notified about in this household.
        </FieldDescription>
        <FieldGroup key={state.attempt ?? 0} className="gap-4">
          {NOTIFICATION_CATEGORIES.map((category) => {
            const id = `${uid}-${category}`;
            return (
              <Field key={category} orientation="horizontal">
                <Checkbox
                  id={id}
                  name="category"
                  value={category}
                  defaultChecked={!muted.includes(category)}
                  aria-describedby={`${id}-help`}
                />
                <FieldContent>
                  <FieldLabel htmlFor={id}>
                    {CATEGORY_INFO[category].label}
                  </FieldLabel>
                  <FieldDescription id={`${id}-help`}>
                    {CATEGORY_INFO[category].description}
                  </FieldDescription>
                </FieldContent>
              </Field>
            );
          })}
        </FieldGroup>
      </FieldSet>
      {state.status === "error" && state.message ? (
        <FormAlert tone="error">{state.message}</FormAlert>
      ) : null}
      {state.status === "success" ? (
        <FormAlert tone="success">Saved for {householdName}.</FormAlert>
      ) : null}
      {/* The household is the card's heading; the name tells the forms apart
          for screen readers, and a long one doesn't push a button off a phone. */}
      <SubmitButton
        pendingLabel="Saving…"
        aria-label={`Save for ${householdName}`}
      >
        Save
      </SubmitButton>
    </form>
  );
}
