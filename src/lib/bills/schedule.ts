// Recurring bill schedules (roadmap Phase 14, D10, ADR-010): when each period
// is due, and how to say it. Calendar dates only ("YYYY-MM-DD", D11), in plain
// UTC arithmetic, so a date never shifts across a timezone.
//
// The same rules as private.bill_due_date in the database, and the tests
// compare the two: period k is always worked out from the first due date (the
// anchor), never from the period before. So a monthly bill on the 31st falls
// on the last day of shorter months and comes back to the 31st afterwards; a
// yearly bill on 29 February falls on 28 February in other years.
//
// Pure: no database, no clock.

import type { Database } from "@/lib/supabase/database.types";

export type BillFrequency = Database["public"]["Enums"]["bill_frequency"];

export const BILL_FREQUENCIES = [
  "week",
  "month",
  "year",
] as const satisfies readonly BillFrequency[];

/** "Every N weeks/months/years": N is 1 to 52 (a database check too). */
export const MAX_INTERVAL = 52;

/**
 * D27 (proposed): a period counts as "due soon" from this many days before
 * its due date, in the household's timezone.
 */
export const DUE_SOON_DAYS = 7;

/** The schedules the form offers by name; anything else is "custom". */
export const SCHEDULE_PRESETS = [
  { value: "weekly", label: "Every week", unit: "week", every: 1 },
  { value: "fortnightly", label: "Every 2 weeks", unit: "week", every: 2 },
  { value: "monthly", label: "Every month", unit: "month", every: 1 },
  {
    value: "quarterly",
    label: "Every 3 months (quarterly)",
    unit: "month",
    every: 3,
  },
  { value: "yearly", label: "Every year", unit: "year", every: 1 },
] as const satisfies readonly {
  value: string;
  label: string;
  unit: BillFrequency;
  every: number;
}[];

export type SchedulePreset = (typeof SCHEDULE_PRESETS)[number]["value"];

function parts(date: string): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number);
  return [year, month, day];
}

function iso(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = parts(date);
  return iso(year, month, day + days);
}

/** Months added the way Postgres adds them: the day is kept, or the month's last. */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = parts(date);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return iso(y, m, Math.min(day, daysInMonth(y, m)));
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

/** When period k (from 0) of a schedule is due. */
export function dueDate(
  anchor: string,
  unit: BillFrequency,
  every: number,
  k: number,
): string {
  switch (unit) {
    case "week":
      return addDays(anchor, 7 * every * k);
    case "month":
      return addMonths(anchor, every * k);
    case "year":
      return addMonths(anchor, 12 * every * k);
  }
}

/** The first `count` due dates from the anchor, within an optional end date. */
export function firstDueDates(
  anchor: string,
  unit: BillFrequency,
  every: number,
  count: number,
  endsOn: string | null = null,
): string[] {
  const dates: string[] = [];
  for (let k = 0; dates.length < count; k++) {
    const date = dueDate(anchor, unit, every, k);
    if (endsOn !== null && date > endsOn) break;
    dates.push(date);
  }
  return dates;
}

const UNIT_WORDS: Record<BillFrequency, [string, string]> = {
  week: ["week", "weeks"],
  month: ["month", "months"],
  year: ["year", "years"],
};

/** "Every month", "Every 2 weeks", "Every 3 months". */
export function scheduleLabel(unit: BillFrequency, every: number): string {
  const [one, many] = UNIT_WORDS[unit];
  return every === 1 ? `Every ${one}` : `Every ${every} ${many}`;
}

/** The named schedule for a unit and interval, or "custom". */
export function presetFor(
  unit: BillFrequency,
  every: number,
): SchedulePreset | "custom" {
  return (
    SCHEDULE_PRESETS.find((p) => p.unit === unit && p.every === every)?.value ??
    "custom"
  );
}

export type DueKind = "overdue" | "today" | "soon" | "later";

/** Where a due date stands, seen from `today` (both household dates, D11). */
export function dueKind(dueOn: string, today: string): DueKind {
  const days = daysBetween(today, dueOn);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return days <= DUE_SOON_DAYS ? "soon" : "later";
}

/** "Due today", "Due tomorrow", "Due in 5 days", "1 day overdue". */
export function dueLabel(dueOn: string, today: string): string {
  const days = daysBetween(today, dueOn);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days > 1) return `Due in ${days} days`;
  return days === -1 ? "1 day overdue" : `${-days} days overdue`;
}
