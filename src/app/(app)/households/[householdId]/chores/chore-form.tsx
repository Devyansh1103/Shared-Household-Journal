"use client";

import { useActionState, useId } from "react";
import {
  AssigneeField,
  type AssigneeOption,
} from "@/components/assignee-field";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import { TextField } from "@/components/text-field";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  CHORE_DESCRIPTION_MAX,
  CHORE_PRIORITIES,
  CHORE_TITLE_MAX,
  PRIORITY_LABELS,
  type RawChoreForm,
} from "@/lib/chores/form";
import type { ChoreFormState } from "./actions";

type Action = (
  previous: ChoreFormState,
  formData: FormData,
) => Promise<ChoreFormState>;

/**
 * A chore: what, who, when, how urgent. Each answer from the server is
 * numbered so the fields start again from what was submitted: React resets a
 * form's fields after its action, and a select would otherwise go back to its
 * first option silently.
 */
export function ChoreForm({
  action,
  hidden,
  members,
  former,
  viewerId,
  defaults,
  submitLabel,
}: {
  action: Action;
  /** Hidden fields naming the household and chore; the server re-checks them. */
  hidden: Record<string, string>;
  members: AssigneeOption[];
  former?: AssigneeOption | null;
  viewerId: string;
  defaults: RawChoreForm;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<
    ChoreFormState & { attempt?: number },
    FormData
  >(
    async (previous, formData) => ({
      ...(await action(previous, formData)),
      attempt: (previous.attempt ?? 0) + 1,
    }),
    { status: "idle" },
  );
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const values = state.raw ?? defaults;
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate className="space-y-6">
      {state.status === "error" && state.message ? (
        <FormAlert tone="error">{state.message}</FormAlert>
      ) : null}
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <FieldGroup key={state.attempt ?? 0}>
        <TextField
          id={fid("title")}
          name="title"
          label="What needs doing?"
          maxLength={CHORE_TITLE_MAX}
          autoComplete="off"
          required
          defaultValue={values.title}
          error={errors.title}
        />
        <AssigneeField
          id={fid("assignee")}
          label="Who's doing it? (optional)"
          description="Anyone can pick up a chore that's assigned to nobody."
          members={members}
          former={former}
          viewerId={viewerId}
          defaultValue={values.assignee}
          error={errors.assignee}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            id={fid("due-on")}
            name="dueOn"
            type="date"
            label="Due date (optional)"
            description="Leave it empty if it can be done any time."
            defaultValue={values.dueOn}
            error={errors.dueOn}
          />
          <Field data-invalid={errors.priority ? true : undefined}>
            <FieldLabel htmlFor={fid("priority")}>Priority</FieldLabel>
            <NativeSelect
              id={fid("priority")}
              name="priority"
              className="w-full"
              defaultValue={values.priority}
              aria-invalid={errors.priority ? true : undefined}
              aria-describedby={
                errors.priority ? fid("priority-error") : undefined
              }
            >
              {CHORE_PRIORITIES.map((priority) => (
                <NativeSelectOption key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError id={fid("priority-error")}>
              {errors.priority}
            </FieldError>
          </Field>
        </div>
        <Field data-invalid={errors.description ? true : undefined}>
          <FieldLabel htmlFor={fid("description")}>
            Details (optional)
          </FieldLabel>
          <Textarea
            id={fid("description")}
            name="description"
            maxLength={CHORE_DESCRIPTION_MAX}
            defaultValue={values.description}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={`${fid("description-help")}${errors.description ? ` ${fid("description-error")}` : ""}`}
          />
          <FieldDescription id={fid("description-help")}>
            Anything that helps, like where the supplies are. Shown on the
            chores page only, not in the journal.
          </FieldDescription>
          <FieldError id={fid("description-error")}>
            {errors.description}
          </FieldError>
        </Field>
      </FieldGroup>
      <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
    </form>
  );
}
