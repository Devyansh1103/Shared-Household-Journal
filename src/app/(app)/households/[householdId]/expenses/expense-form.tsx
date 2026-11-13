"use client";

import { useActionState, useId, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { SplitFields, type FormMember } from "@/components/split-fields";
import { SubmitButton } from "@/components/submit-button";
import { TextField } from "@/components/text-field";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { EXPENSE_CATEGORIES } from "@/lib/expenses/categories";
import type { RawExpenseForm } from "@/lib/expenses/form";
import type { ExpenseFormState } from "./actions";

export type { FormMember };

type ExpenseFormProps = {
  action: (
    previous: ExpenseFormState,
    formData: FormData,
  ) => Promise<ExpenseFormState>;
  /** Hidden fields naming the household and expense; the server re-checks them. */
  hidden: Record<string, string>;
  /** Active members in the order they joined. */
  members: FormMember[];
  currency: string;
  exponent: number;
  defaults: RawExpenseForm;
  submitLabel: string;
  pendingLabel: string;
};

/**
 * The expense form. The split preview uses the same engine the server uses,
 * so what you see is exactly what is saved. Recording a recurring bill
 * (roadmap Phase 14) uses it too, pre-filled from the bill.
 */
export function ExpenseForm({
  action,
  hidden,
  members,
  currency,
  exponent,
  defaults,
  submitLabel,
  pendingLabel,
}: ExpenseFormProps) {
  // Each answer from the server is numbered, and the fields start again from
  // what was submitted: React resets a form's fields after its action, and a
  // select or a tick would otherwise go back to its first default (a payer or
  // a participant changed back, silently).
  const [state, formAction] = useActionState<
    ExpenseFormState & { attempt?: number },
    FormData
  >(
    async (previous, formData) => ({
      ...(await action(previous, formData)),
      attempt: (previous.attempt ?? 0) + 1,
    }),
    { status: "idle" },
  );
  // Next.js keeps the previous page mounted (hidden) after navigating, so the
  // create and edit forms can both be in the document: ids must be unique.
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

      <ExpenseFields
        key={state.attempt ?? 0}
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

function ExpenseFields({
  fid,
  values,
  errors,
  members,
  currency,
  exponent,
}: {
  fid: (name: string) => string;
  values: RawExpenseForm;
  errors: Record<string, string>;
  members: FormMember[];
  currency: string;
  exponent: number;
}) {
  const [amount, setAmount] = useState(values.amount);
  // The selects are uncontrolled on purpose: their default is what was
  // submitted (this component starts again after every answer), and a form
  // reset goes back to the default. A controlled select has no default, so a
  // reset would show its first option instead.

  return (
    <FieldGroup>
      <TextField
        id={fid("description")}
        name="description"
        label="What was it for?"
        maxLength={120}
        autoComplete="off"
        required
        defaultValue={values.description}
        error={errors.description}
      />

      <TextField
        id={fid("amount")}
        name="amount"
        label={`Amount (${currency})`}
        description={
          exponent > 0
            ? `Up to ${exponent} decimal place${exponent === 1 ? "" : "s"}, like 1250.${"5".padEnd(exponent, "0")}.`
            : "A whole amount, like 1250."
        }
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
            {EXPENSE_CATEGORIES.map((category) => (
              <NativeSelectOption key={category.value} value={category.value}>
                {category.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldError id={fid("category-error")}>{errors.category}</FieldError>
        </Field>

        <TextField
          id={fid("date")}
          name="expenseDate"
          type="date"
          label="Date"
          required
          defaultValue={values.expenseDate}
          error={errors.expenseDate}
        />
      </div>

      <Field data-invalid={errors.paidBy ? true : undefined}>
        <FieldLabel htmlFor={fid("paid-by")}>Paid by</FieldLabel>
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

      <SplitFields
        fid={fid}
        members={members}
        currency={currency}
        exponent={exponent}
        amount={amount}
        defaults={values}
        errors={errors}
      />
    </FieldGroup>
  );
}
