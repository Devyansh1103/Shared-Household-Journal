"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
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
import { initialFormState } from "@/lib/auth/form-state";
import {
  normalizeTimeZone,
  timeZoneLabel,
  type CurrencyOption,
} from "@/lib/households/options";
import { createHousehold } from "../actions";

const noSubscription = () => () => {};
const deviceTimeZone = () =>
  normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
const noDeviceTimeZone = () => null;

export function CreateHouseholdForm({
  requestKey,
  currencies,
  timeZones,
  defaultCurrency,
}: {
  requestKey: string;
  currencies: CurrencyOption[];
  timeZones: string[];
  defaultCurrency: string;
}) {
  const [state, formAction] = useActionState(createHousehold, initialFormState);

  // Suggest the device's timezone once in the browser; the server render has none.
  const detected = useSyncExternalStore(
    noSubscription,
    deviceTimeZone,
    noDeviceTimeZone,
  );
  const [chosenTimeZone, setChosenTimeZone] = useState<string | null>(null);
  const suggested =
    detected && timeZones.includes(detected) ? detected : undefined;
  const timeZone = chosenTimeZone ?? state.values?.timezone ?? suggested ?? "";

  const errors = state.fieldErrors ?? {};
  /** Help text always; the error message too when there is one. */
  const describedBy = (id: string, error: string | undefined) =>
    error ? `${id}-help ${id}-error` : `${id}-help`;

  return (
    <form action={formAction} noValidate className="space-y-6">
      {state.status === "error" && state.message ? (
        <FormAlert tone="error">{state.message}</FormAlert>
      ) : null}
      <input type="hidden" name="requestKey" value={requestKey} />

      <FieldGroup>
        <TextField
          id="household-name"
          name="name"
          label="Household name"
          description="Something everyone will recognise, like “Flat 4B” or “The Green House”."
          autoComplete="off"
          maxLength={80}
          required
          defaultValue={state.values?.name}
          error={errors.name}
        />

        <Field data-invalid={errors.currency ? true : undefined}>
          <FieldLabel htmlFor="household-currency">Currency</FieldLabel>
          <NativeSelect
            id="household-currency"
            name="currency"
            className="w-full"
            defaultValue={state.values?.currency ?? defaultCurrency}
            aria-invalid={errors.currency ? true : undefined}
            aria-describedby={describedBy(
              "household-currency",
              errors.currency,
            )}
          >
            {currencies.map((currency) => (
              <NativeSelectOption key={currency.code} value={currency.code}>
                {currency.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription id="household-currency-help">
            All shared costs are recorded in this currency. It&apos;s locked
            once the first expense is added.
          </FieldDescription>
          <FieldError id="household-currency-error">
            {errors.currency}
          </FieldError>
        </Field>

        <Field data-invalid={errors.timezone ? true : undefined}>
          <FieldLabel htmlFor="household-timezone">Timezone</FieldLabel>
          <NativeSelect
            id="household-timezone"
            name="timezone"
            className="w-full"
            value={timeZone}
            onChange={(event) => setChosenTimeZone(event.target.value)}
            required
            aria-invalid={errors.timezone ? true : undefined}
            aria-describedby={describedBy(
              "household-timezone",
              errors.timezone,
            )}
          >
            <NativeSelectOption value="" disabled>
              Choose a timezone
            </NativeSelectOption>
            {timeZones.map((zone) => (
              <NativeSelectOption key={zone} value={zone}>
                {timeZoneLabel(zone)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription id="household-timezone-help">
            Used for due dates and times.
            {suggested ? " We’ve picked your device’s timezone." : null}
          </FieldDescription>
          <FieldError id="household-timezone-error">
            {errors.timezone}
          </FieldError>
        </Field>
      </FieldGroup>

      <SubmitButton pendingLabel="Creating household…">
        Create household
      </SubmitButton>
    </form>
  );
}
