"use client";

import { useState } from "react";
import { TextField } from "@/components/text-field";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { isCalendarDate } from "@/lib/expenses/dates";
import {
  firstDueDates,
  MAX_INTERVAL,
  SCHEDULE_PRESETS,
  type BillFrequency,
} from "@/lib/bills/schedule";
import { formatDate } from "@/lib/format";

export type ScheduleDefaults = {
  schedule: string;
  unit: string;
  every: string;
  startsOn: string;
};

const UNITS: { value: BillFrequency; label: string }[] = [
  { value: "week", label: "Weeks" },
  { value: "month", label: "Months" },
  { value: "year", label: "Years" },
];

/**
 * How often a bill repeats and when (its first or next due date), with the
 * next few due dates worked out by the same rules the database uses: a bill
 * on the 31st falls on the last day of shorter months.
 *
 * The form starts these fields again from what was submitted after every
 * answer (a key), and the selects are uncontrolled: React resets a form's
 * fields after its action, and a reset goes back to their default, which is
 * then what was submitted. State only follows them, for the preview.
 */
export function ScheduleFields({
  fid,
  defaults,
  errors,
  startsOnLabel,
  startsOnHelp,
}: {
  fid: (name: string) => string;
  defaults: ScheduleDefaults;
  errors: Record<string, string>;
  startsOnLabel: string;
  startsOnHelp: string;
}) {
  const [schedule, setSchedule] = useState(defaults.schedule || "monthly");
  const [unit, setUnit] = useState(defaults.unit || "month");
  const [every, setEvery] = useState(defaults.every || "1");
  const [startsOn, setStartsOn] = useState(defaults.startsOn);

  const preset = SCHEDULE_PRESETS.find((p) => p.value === schedule);
  const chosen =
    preset ??
    (schedule === "custom" &&
    UNITS.some((u) => u.value === unit) &&
    /^[1-9][0-9]?$/.test(every) &&
    Number(every) <= MAX_INTERVAL
      ? { unit: unit as BillFrequency, every: Number(every) }
      : null);
  const preview =
    chosen && isCalendarDate(startsOn)
      ? firstDueDates(startsOn, chosen.unit, chosen.every, 4).map(formatDate)
      : null;

  return (
    <>
      <Field data-invalid={errors.schedule ? true : undefined}>
        <FieldLabel htmlFor={fid("schedule")}>How often is it due?</FieldLabel>
        <NativeSelect
          id={fid("schedule")}
          name="schedule"
          className="w-full"
          defaultValue={schedule}
          onChange={(event) => setSchedule(event.target.value)}
          aria-invalid={errors.schedule ? true : undefined}
          aria-describedby={errors.schedule ? fid("schedule-error") : undefined}
        >
          {SCHEDULE_PRESETS.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value="custom">
            Another interval…
          </NativeSelectOption>
        </NativeSelect>
        <FieldError id={fid("schedule-error")}>{errors.schedule}</FieldError>
      </Field>

      {schedule === "custom" ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={errors.every ? true : undefined}>
            <FieldLabel htmlFor={fid("every")}>Every</FieldLabel>
            <Input
              id={fid("every")}
              name="every"
              inputMode="numeric"
              autoComplete="off"
              value={every}
              onChange={(event) => setEvery(event.target.value)}
              aria-invalid={errors.every ? true : undefined}
              aria-describedby={errors.every ? fid("every-error") : undefined}
            />
            <FieldError id={fid("every-error")}>{errors.every}</FieldError>
          </Field>
          <Field data-invalid={errors.unit ? true : undefined}>
            <FieldLabel htmlFor={fid("unit")}>
              Weeks, months or years
            </FieldLabel>
            <NativeSelect
              id={fid("unit")}
              name="unit"
              className="w-full"
              defaultValue={unit}
              onChange={(event) => setUnit(event.target.value)}
              aria-invalid={errors.unit ? true : undefined}
              aria-describedby={errors.unit ? fid("unit-error") : undefined}
            >
              {UNITS.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError id={fid("unit-error")}>{errors.unit}</FieldError>
          </Field>
        </div>
      ) : null}

      <TextField
        id={fid("starts-on")}
        name="startsOn"
        type="date"
        label={startsOnLabel}
        description={startsOnHelp}
        required
        value={startsOn}
        onChange={(event) => setStartsOn(event.target.value)}
        error={errors.startsOn}
      />
      <p className="type-secondary" aria-live="polite">
        {preview
          ? `Due on ${preview.join(", ")}, and so on.`
          : "Choose how often and a date to see when it's due."}
      </p>
    </>
  );
}
