"use client";

import { useActionState, useId, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { SplitFields, type FormMember } from "@/components/split-fields";
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
import type { RawBillForm } from "@/lib/bills/form";
import { NOTES_MAX_LENGTH } from "@/lib/bills/form";
import { EXPENSE_CATEGORIES } from "@/lib/expenses/categories";
import type { BillFormState } from "./actions";
import { ScheduleFields } from "./schedule-fields";

type Action = (
  previous: BillFormState,
  formData: FormData,
) => Promise<BillFormState>;

/**
 * Numbers each answer from the server, so the fields can start again from what
 * was submitted: React resets a form's fields after its action, and a select or
 * a tick would otherwise go back to its first default, silently.
 */
function useNumberedAction(action: Action) {
  return useActionState<BillFormState & { attempt?: number }, FormData>(
    async (previous, formData) => ({
      ...(await action(previous, formData)),
      attempt: (previous.attempt ?? 0) + 1,
    }),
    { status: "idle" },
  );
}

/**
 * A recurring bill: what it is, the expected amount, who usually pays, the
 * default split (the expense form's own split fields), and, for a new bill,
 * its schedule. "details" edits everything but the schedule, which has a form
 * of its own.
 */
export function BillForm({
  mode,
  action,
  hidden,
  members,
  currency,
  exponent,
  defaults,
  submitLabel,
  pendingLabel,
}: {
  mode: "create" | "details";
  action: Action;
  /** Hidden fields naming the household and bill; the server re-checks them. */
  hidden: Record<string, string>;
  /** Active members in the order they joined. */
  members: FormMember[];
  currency: string;
  exponent: number;
  defaults: RawBillForm;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [state, formAction] = useNumberedAction(action);
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;

  return (
    <form action={formAction} noValidate className="space-y-6">
      {state.status === "error" && state.message ? (
        <FormAlert tone="error">{state.message}</FormAlert>
      ) : null}
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <BillFields
        key={state.attempt ?? 0}
        mode={mode}
        fid={fid}
        values={state.raw ?? defaults}
        errors={state.fieldErrors ?? {}}
        members={members}
        currency={currency}
        exponent={exponent}
      />
      <SubmitButton pendingLabel={pendingLabel}>{submitLabel}</SubmitButton>
    </form>
  );
}

function BillFields({
  mode,
  fid,
  values,
  errors,
  members,
  currency,
  exponent,
}: {
  mode: "create" | "details";
  fid: (name: string) => string;
  values: RawBillForm;
  errors: Record<string, string>;
  members: FormMember[];
  currency: string;
  exponent: number;
}) {
  const [amount, setAmount] = useState(values.amount);
  // The selects are uncontrolled on purpose (see ExpenseForm): their default
  // is what was submitted, and a form reset goes back to the default.

  return (
    <FieldGroup>
      <TextField
        id={fid("description")}
        name="description"
        label="What is it?"
        description="Each period is recorded as an expense with this description."
        maxLength={120}
        autoComplete="off"
        required
        defaultValue={values.description}
        error={errors.description}
      />

      <TextField
        id={fid("amount")}
        name="amount"
        label={`Expected amount (${currency})`}
        description="What it usually comes to. When it's paid, you record the actual amount."
        inputMode={exponent > 0 ? "decimal" : "numeric"}
        autoComplete="off"
        className="type-amount"
        required
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        error={errors.amount}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field data-invalid={errors.category ? true : undefined}>
          <FieldLabel htmlFor={fid("category")}>Category</FieldLabel>
          <NativeSelect
            id={fid("category")}
            name="category"
            className="w-full"
            defaultValue={values.category}
            aria-invalid={errors.category ? true : undefined}
            aria-describedby={
              errors.category ? fid("category-error") : undefined
            }
          >
            <NativeSelectOption value="" disabled>
              Choose a category
            </NativeSelectOption>
            {EXPENSE_CATEGORIES.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldError id={fid("category-error")}>{errors.category}</FieldError>
        </Field>

        <Field data-invalid={errors.paidBy ? true : undefined}>
          <FieldLabel htmlFor={fid("paid-by")}>Usually paid by</FieldLabel>
          <NativeSelect
            id={fid("paid-by")}
            name="paidBy"
            className="w-full"
            defaultValue={values.paidBy}
            aria-invalid={errors.paidBy ? true : undefined}
            aria-describedby={errors.paidBy ? fid("paid-by-error") : undefined}
          >
            {members.map((member) => (
              <NativeSelectOption key={member.userId} value={member.userId}>
                {member.displayName}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldError id={fid("paid-by-error")}>{errors.paidBy}</FieldError>
        </Field>
      </div>

      {mode === "create" ? (
        <ScheduleFields
          fid={fid}
          defaults={values}
          errors={errors}
          startsOnLabel="First due date"
          startsOnHelp="Today, a date this past year if it's already due, or a later date."
        />
      ) : null}

      <TextField
        id={fid("ends-on")}
        name="endsOn"
        type="date"
        label="Last due date (optional)"
        description="Leave it empty if the bill keeps coming."
        defaultValue={values.endsOn}
        error={errors.endsOn}
      />

      <SplitFields
        fid={fid}
        members={members}
        currency={currency}
        exponent={exponent}
        amount={amount}
        defaults={values}
        errors={errors}
      />

      <Field data-invalid={errors.notes ? true : undefined}>
        <FieldLabel htmlFor={fid("notes")}>Notes (optional)</FieldLabel>
        <Textarea
          id={fid("notes")}
          name="notes"
          maxLength={NOTES_MAX_LENGTH}
          defaultValue={values.notes}
          aria-invalid={errors.notes ? true : undefined}
          aria-describedby={`${fid("notes-help")}${errors.notes ? ` ${fid("notes-error")}` : ""}`}
        />
        <FieldDescription id={fid("notes-help")}>
          Like an account number or where to pay. Shown on the bill&apos;s page
          only.
        </FieldDescription>
        <FieldError id={fid("notes-error")}>{errors.notes}</FieldError>
      </Field>
    </FieldGroup>
  );
}

/** A new schedule for an existing bill, from a next due date on. */
export function ScheduleForm({
  action,
  hidden,
  defaults,
}: {
  action: Action;
  hidden: Record<string, string>;
  defaults: Pick<RawBillForm, "schedule" | "unit" | "every" | "startsOn">;
}) {
  const [state, formAction] = useNumberedAction(action);
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;

  return (
    <form action={formAction} noValidate className="space-y-6">
      {state.status === "error" && state.message ? (
        <FormAlert tone="error">{state.message}</FormAlert>
      ) : null}
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <FieldGroup>
        <ScheduleFields
          key={state.attempt ?? 0}
          fid={fid}
          defaults={state.raw ?? defaults}
          errors={state.fieldErrors ?? {}}
          startsOnLabel="Next due date"
          startsOnHelp="Today or later, after every period that's already been recorded or skipped."
        />
      </FieldGroup>
      <SubmitButton pendingLabel="Saving…">Save schedule</SubmitButton>
    </form>
  );
}
