// Reading and validating the recurring bill forms (roadmap Phase 14): adding a
// bill, editing its details, and changing its schedule. Pure: the Server
// Actions pass the household's real members, its currency's decimal places
// and "today" in its timezone (D11); the database checks everything again.
//
// What, how much, the category, who usually pays and the default split are
// validated by validateExpenseForm, the expense form's own rules, so a bill
// can never pre-fill an expense the expense form would refuse.

import type { Share, SplitMethod } from "@/domain/money/split";
import type { ExpenseCategory } from "@/lib/expenses/categories";
import { isCalendarDate } from "@/lib/expenses/dates";
import { readExpenseForm, validateExpenseForm } from "@/lib/expenses/form";
import {
  addDays,
  BILL_FREQUENCIES,
  MAX_INTERVAL,
  SCHEDULE_PRESETS,
  type BillFrequency,
} from "./schedule";

/** How far back a first due date may be: a year (catching up stays small). */
export const EARLIEST_START_DAYS = 366;
/** How far ahead a first or next due date may be: ten years. */
export const LATEST_START_DAYS = 3660;
export const NOTES_MAX_LENGTH = 500;

/** The forms as typed, kept to show again after an error. */
export type RawBillForm = {
  description: string;
  amount: string;
  category: string;
  paidBy: string;
  splitMethod: string;
  participants: string[];
  shares: Record<string, string>;
  percents: Record<string, string>;
  /** A preset's value, or "custom". */
  schedule: string;
  /** Custom schedules only. */
  unit: string;
  every: string;
  /** First due date (new bill) or next due date (new schedule). */
  startsOn: string;
  endsOn: string;
  notes: string;
};

export type BillDetails = {
  description: string;
  amountMinor: bigint;
  category: ExpenseCategory;
  payerId: string;
  splitMethod: SplitMethod;
  shares: Share[];
  endsOn: string | null;
  notes: string | null;
};

export type BillSchedule = {
  unit: BillFrequency;
  every: number;
  startsOn: string;
};

type Errors = Record<string, string>;

export type Validation<T> =
  { ok: true; value: T } | { ok: false; fieldErrors: Errors };

export function readBillForm(formData: FormData): RawBillForm {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const expense = readExpenseForm(formData);
  return {
    description: expense.description,
    amount: expense.amount,
    category: expense.category,
    paidBy: expense.paidBy,
    splitMethod: expense.splitMethod,
    participants: expense.participants,
    shares: expense.shares,
    percents: expense.percents,
    schedule: text("schedule"),
    unit: text("unit"),
    every: text("every"),
    startsOn: text("startsOn"),
    endsOn: text("endsOn"),
    notes: text("notes"),
  };
}

/**
 * What it is, the expected amount, who usually pays, the default split, the
 * notes and the optional last due date. `memberIds` are the active members in
 * join order (ADR-004).
 */
export function validateBillDetails(
  raw: RawBillForm,
  context: { memberIds: string[]; exponent: number; today: string },
): Validation<BillDetails> {
  const errors: Errors = {};
  const money = validateExpenseForm(
    { ...raw, expenseDate: context.today },
    { memberIds: context.memberIds, exponent: context.exponent },
  );
  if (!money.ok) {
    Object.assign(errors, money.fieldErrors);
    if (errors.description) {
      errors.description =
        raw.description.trim() === ""
          ? "Name the bill, like “Electricity” or “Rent”."
          : errors.description;
    }
    if (errors.paidBy) errors.paidBy = "Choose who usually pays it.";
  }

  let endsOn: string | null = null;
  if (raw.endsOn.trim() !== "") {
    if (!isCalendarDate(raw.endsOn)) errors.endsOn = "Choose a real date.";
    else endsOn = raw.endsOn;
  }

  const notes = raw.notes.trim();
  if (notes.length > NOTES_MAX_LENGTH) {
    errors.notes = `Use ${NOTES_MAX_LENGTH} characters or fewer.`;
  }

  if (!money.ok || Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }
  const { expense } = money;
  return {
    ok: true,
    value: {
      description: expense.description,
      amountMinor: expense.amountMinor,
      category: expense.category,
      payerId: expense.paidBy,
      splitMethod: expense.splitMethod,
      shares: expense.shares,
      endsOn,
      notes: notes === "" ? null : notes,
    },
  };
}

function isFrequency(value: string): value is BillFrequency {
  return (BILL_FREQUENCIES as readonly string[]).includes(value);
}

/**
 * How often it repeats and when the (new) schedule starts. `earliest` and
 * `latest` bound the start date; `startsOnLabel` names it in the errors.
 */
export function validateSchedule(
  raw: Pick<RawBillForm, "schedule" | "unit" | "every" | "startsOn">,
  {
    earliest,
    latest,
    tooEarly,
  }: { earliest: string; latest: string; tooEarly: string },
): Validation<BillSchedule> {
  const errors: Errors = {};
  let unit: BillFrequency | null = null;
  let every = 0;

  const preset = SCHEDULE_PRESETS.find((p) => p.value === raw.schedule);
  if (preset) {
    unit = preset.unit;
    every = preset.every;
  } else if (raw.schedule === "custom") {
    if (!isFrequency(raw.unit)) errors.unit = "Choose weeks, months or years.";
    else unit = raw.unit;
    if (!/^[1-9][0-9]?$/.test(raw.every) || Number(raw.every) > MAX_INTERVAL) {
      errors.every = `Enter a whole number from 1 to ${MAX_INTERVAL}.`;
    } else {
      every = Number(raw.every);
    }
  } else {
    errors.schedule = "Choose how often it repeats.";
  }

  if (!isCalendarDate(raw.startsOn)) {
    errors.startsOn = "Choose a real date.";
  } else if (raw.startsOn < earliest) {
    errors.startsOn = tooEarly;
  } else if (raw.startsOn > latest) {
    errors.startsOn = "Choose a date within the next ten years.";
  }

  if (Object.keys(errors).length > 0 || unit === null) {
    return { ok: false, fieldErrors: errors };
  }
  return { ok: true, value: { unit, every, startsOn: raw.startsOn } };
}

/** A new bill: its details and its schedule, the last due date not before the first. */
export function validateNewBill(
  raw: RawBillForm,
  context: { memberIds: string[]; exponent: number; today: string },
): Validation<{ details: BillDetails; schedule: BillSchedule }> {
  const details = validateBillDetails(raw, context);
  const schedule = validateSchedule(raw, {
    earliest: addDays(context.today, -EARLIEST_START_DAYS),
    latest: addDays(context.today, LATEST_START_DAYS),
    tooEarly: "Choose a date within the past year.",
  });
  const errors: Errors = {
    ...(details.ok ? {} : details.fieldErrors),
    ...(schedule.ok ? {} : schedule.fieldErrors),
  };
  if (
    details.ok &&
    schedule.ok &&
    details.value.endsOn !== null &&
    details.value.endsOn < schedule.value.startsOn
  ) {
    errors.endsOn = "The last due date can't be before the first.";
  }
  if (!details.ok || !schedule.ok || Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }
  return {
    ok: true,
    value: { details: details.value, schedule: schedule.value },
  };
}

/** A new schedule for an existing bill: from today, after every period so far. */
export function validateNewSchedule(
  raw: Pick<RawBillForm, "schedule" | "unit" | "every" | "startsOn">,
  context: { today: string; latestStoredDueOn: string | null },
): Validation<BillSchedule> {
  const afterStored =
    context.latestStoredDueOn !== null &&
    addDays(context.latestStoredDueOn, 1) > context.today
      ? addDays(context.latestStoredDueOn, 1)
      : context.today;
  return validateSchedule(raw, {
    earliest: afterStored,
    latest: addDays(context.today, LATEST_START_DAYS),
    tooEarly:
      afterStored === context.today
        ? "Choose today or a later date."
        : "Choose a date after the last period that's already been recorded or skipped.",
  });
}
