// The journal's days (roadmap Phase 13): entries under "Today", "Yesterday",
// "Earlier this week", then one heading per earlier day, all in the
// household's timezone (D11). The week starts on the day the expense
// history's "This week" starts (WEEK_STARTS_ON, D25), so the two never
// disagree about what "this week" means.
//
// Pure: the page passes "now"; the tests run all of it on their own.

import { todayIn } from "@/lib/expenses/dates";
import { WEEK_STARTS_ON } from "@/lib/expenses/history";
import { formatLongDate, formatTime, formatWeekdayTime } from "@/lib/format";

export type DayKind = "today" | "yesterday" | "week" | "date";

export type DayGroup<T> = {
  /** "today", "yesterday", "week", or the day itself as "YYYY-MM-DD". */
  key: string;
  kind: DayKind;
  /** "Today", "Yesterday", "Earlier this week" or "Friday, 6 November 2026". */
  label: string;
  entries: T[];
};

const LABELS = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Earlier this week",
} as const;

/** Calendar arithmetic in UTC, so a date never shifts across a timezone. */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
function weekday(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** An instant from the journal's microseconds (to the millisecond). */
export function instantFromMicroseconds(us: bigint): Date {
  return new Date(Number(us / BigInt(1000)));
}

/** The household's calendar day an instant falls on, as "YYYY-MM-DD". */
export function dayIn(instant: Date, timeZone: string): string {
  return todayIn(timeZone, instant);
}

/**
 * Which heading a day goes under, seen from `today`. A day after today (a
 * clock running ahead) counts as today.
 */
export function dayKind(
  day: string,
  today: string,
  weekStartsOn: number = WEEK_STARTS_ON,
): DayKind {
  if (day >= today) return "today";
  if (day === addDays(today, -1)) return "yesterday";
  const weekStart = addDays(today, -((weekday(today) - weekStartsOn + 7) % 7));
  return day >= weekStart ? "week" : "date";
}

/**
 * Entries (newest first) under their headings, in order. Each heading
 * appears once, since entries of one day are next to each other.
 */
export function groupByDay<T>(
  entries: readonly T[],
  instantOf: (entry: T) => Date,
  {
    now,
    timeZone,
    weekStartsOn = WEEK_STARTS_ON,
  }: { now: Date; timeZone: string; weekStartsOn?: number },
): DayGroup<T>[] {
  const today = dayIn(now, timeZone);
  const groups: DayGroup<T>[] = [];
  for (const entry of entries) {
    const day = dayIn(instantOf(entry), timeZone);
    const kind = dayKind(day, today, weekStartsOn);
    const key = kind === "date" ? day : kind;
    const last = groups.at(-1);
    if (last?.key === key) {
      last.entries.push(entry);
    } else {
      groups.push({
        key,
        kind,
        label: kind === "date" ? formatLongDate(day) : LABELS[kind],
        entries: [entry],
      });
    }
  }
  return groups;
}

/**
 * The time beside an entry: the time of day ("10:30 am"), with the weekday
 * under "Earlier this week" ("Tue, 10:30 am"), where the heading doesn't say
 * which day it was.
 */
export function entryTimeLabel(
  instant: Date,
  kind: DayKind,
  timeZone: string,
): string {
  return kind === "week"
    ? formatWeekdayTime(instant, timeZone)
    : formatTime(instant, timeZone);
}
