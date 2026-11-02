"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

const CATEGORIES = [
  "Rent",
  "Utilities",
  "Groceries",
  "Household supplies",
  "Internet",
  "Dining",
  "Transport",
  "Other",
];

type Errors = Partial<Record<"description" | "amount", string>>;

/** Demonstrates field layout and validation states. Nothing is saved. */
export function FormDemo() {
  const [errors, setErrors] = useState<Errors>({});

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next: Errors = {};
    if (!String(data.get("description") ?? "").trim()) {
      next.description = "Add a short description, like “Electricity bill”.";
    }
    if (!/^\d+(\.\d{1,2})?$/.test(String(data.get("amount") ?? "").trim())) {
      next.amount = "Enter an amount like 1250 or 1250.50.";
    }
    setErrors(next);
    if (Object.keys(next).length === 0) {
      toast.success("Looks good — this demo doesn’t save anything.");
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-md">
      <FieldGroup>
        <Field data-invalid={errors.description ? true : undefined}>
          <FieldLabel htmlFor="demo-description">Description</FieldLabel>
          <Input
            id="demo-description"
            name="description"
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={
              errors.description ? "demo-description-error" : undefined
            }
          />
          <FieldError id="demo-description-error">
            {errors.description}
          </FieldError>
        </Field>

        <Field data-invalid={errors.amount ? true : undefined}>
          <FieldLabel htmlFor="demo-amount">Amount (₹)</FieldLabel>
          <Input
            id="demo-amount"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            className="type-amount"
            aria-invalid={errors.amount ? true : undefined}
            aria-describedby={`demo-amount-help${errors.amount ? " demo-amount-error" : ""}`}
          />
          <FieldDescription id="demo-amount-help">
            Up to two decimal places.
          </FieldDescription>
          <FieldError id="demo-amount-error">{errors.amount}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="demo-category">Category</FieldLabel>
          <NativeSelect
            id="demo-category"
            name="category"
            defaultValue="Utilities"
            className="w-full"
          >
            {CATEGORIES.map((category) => (
              <NativeSelectOption key={category} value={category}>
                {category}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <FieldSet>
          <FieldLegend variant="label">How should it be split?</FieldLegend>
          <RadioGroup name="split" defaultValue="equal">
            {[
              ["equal", "Equally"],
              ["percentage", "By percentage"],
              ["custom", "Custom amounts"],
            ].map(([value, label]) => (
              <Field key={value} orientation="horizontal">
                <RadioGroupItem value={value} id={`demo-split-${value}`} />
                <FieldLabel
                  htmlFor={`demo-split-${value}`}
                  className="font-normal"
                >
                  {label}
                </FieldLabel>
              </Field>
            ))}
          </RadioGroup>
        </FieldSet>

        <Field>
          <FieldLabel htmlFor="demo-note">Note (optional)</FieldLabel>
          <Textarea id="demo-note" name="note" />
        </Field>

        <Field orientation="horizontal">
          <Checkbox id="demo-remind" name="remind" />
          <FieldLabel htmlFor="demo-remind" className="font-normal">
            Remind me when this is due next month
          </FieldLabel>
        </Field>

        <Field orientation="horizontal">
          <Button type="submit">Check form</Button>
          <Button type="reset" variant="ghost" onClick={() => setErrors({})}>
            Clear
          </Button>
        </Field>
      </FieldGroup>
    </form>
  );
}

export function ToastDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        onClick={() => toast.success("Expense recorded")}
      >
        Success toast
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.error("Couldn’t save. Check your connection and try again.")
        }
      >
        Error toast
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.info("Rent is due in 3 days")}
      >
        Info toast
      </Button>
    </div>
  );
}
