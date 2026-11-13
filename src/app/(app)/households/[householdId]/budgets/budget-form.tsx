"use client";

import { useActionState, useId } from "react";
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
import type { RawBudgetForm } from "@/lib/budgets/form";
import { BUDGET_PERIODS, PERIOD_ADJECTIVES } from "@/lib/budgets/period";
import { EXPENSE_CATEGORIES } from "@/lib/expenses/categories";
import type { BudgetFormState } from "./actions";

type Action = (
  previous: BudgetFormState,
  formData: FormData,
) => Promise<BudgetFormState>;

/**
 * A budget: what it covers, for which period, and its limit. Editing changes
 * only the limit (a different category or period is a different budget).
 * Each answer from the server is numbered so the fields start again from
 * what was submitted: React resets a form's fields after its action, and a
 * select would otherwise go back to its first option silently.
 */
export function BudgetForm({
  mode,
  action,
  hidden,
  currency,
  exponent,
  defaults,
}: {
  mode: "create" | "edit";
  action: Action;
  /** Hidden fields naming the household and budget; the server re-checks them. */
  hidden: Record<string, string>;
  currency: string;
  exponent: number;
  defaults: RawBudgetForm;
}) {
  const [state, formAction] = useActionState<
    BudgetFormState & { attempt?: number },
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
        {mode === "create" ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field data-invalid={errors.category ? true : undefined}>
              <FieldLabel htmlFor={fid("category")}>What it covers</FieldLabel>
              <NativeSelect
                id={fid("category")}
                name="category"
                className="w-full"
                defaultValue={values.category}
                aria-invalid={errors.category ? true : undefined}
                aria-describedby={`${fid("category-help")}${errors.category ? ` ${fid("category-error")}` : ""}`}
              >
                <NativeSelectOption value="all">
                  Everything the household spends
                </NativeSelectOption>
                {EXPENSE_CATEGORIES.map((c) => (
                  <NativeSelectOption key={c.value} value={c.value}>
                    {c.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription id={fid("category-help")}>
                One budget for everything, and one per category if you like.
              </FieldDescription>
              <FieldError id={fid("category-error")}>
                {errors.category}
              </FieldError>
            </Field>
            <Field data-invalid={errors.period ? true : undefined}>
              <FieldLabel htmlFor={fid("period")}>Period</FieldLabel>
              <NativeSelect
                id={fid("period")}
                name="period"
                className="w-full"
                defaultValue={values.period}
                aria-invalid={errors.period ? true : undefined}
                aria-describedby={`${fid("period-help")}${errors.period ? ` ${fid("period-error")}` : ""}`}
              >
                {BUDGET_PERIODS.map((p) => (
                  <NativeSelectOption key={p} value={p}>
                    {PERIOD_ADJECTIVES[p]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription id={fid("period-help")}>
                Weeks run Monday to Sunday; months and quarters are calendar
                ones.
              </FieldDescription>
              <FieldError id={fid("period-error")}>{errors.period}</FieldError>
            </Field>
          </div>
        ) : null}
        <TextField
          id={fid("limit")}
          name="limit"
          label={`Limit (${currency})`}
          description={
            mode === "create"
              ? "It starts with the current period. Nothing unused carries over."
              : "From the current period on. Periods that have ended keep the limit they had."
          }
          inputMode={exponent > 0 ? "decimal" : "numeric"}
          autoComplete="off"
          className="type-amount"
          required
          defaultValue={values.limit}
          error={errors.limit}
        />
      </FieldGroup>
      <SubmitButton pendingLabel="Saving…">
        {mode === "create" ? "Add budget" : "Save limit"}
      </SubmitButton>
    </form>
  );
}
