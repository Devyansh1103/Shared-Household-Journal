// Notification types (D12: on or off per household and per type). They are
// the journal's categories, so a notification's type is the journal filter
// its event is under. Who gets each is D30 (decided 2026-11-13), applied in
// private.notification_recipients.

import type { Database } from "@/lib/supabase/database.types";

export type NotificationCategory =
  Database["public"]["Enums"]["notification_category"];

/** In the order the settings list them. */
export const NOTIFICATION_CATEGORIES = [
  "expenses",
  "settlements",
  "bills",
  "shopping",
  "chores",
  "budgets",
  "household",
] as const satisfies readonly NotificationCategory[];

export const CATEGORY_INFO: Record<
  NotificationCategory,
  { label: string; description: string }
> = {
  expenses: {
    label: "Expenses",
    description:
      "An expense you paid for or share in is added, changed, deleted or restored.",
  },
  settlements: {
    label: "Payments",
    description:
      "Someone records or voids a payment between you and them. Recorded in the app only: no money is moved.",
  },
  bills: {
    label: "Recurring bills",
    description:
      "A bill you usually pay or share in is added, changed, paused, resumed, ended or skipped.",
  },
  shopping: {
    label: "Shopping list",
    description:
      "An item is assigned to you, changes, is put back or removed, or an item you added is bought.",
  },
  chores: {
    label: "Chores",
    description:
      "A chore is assigned to you, changes, is reopened or removed, or a chore you added is done.",
  },
  budgets: {
    label: "Budgets",
    description: "Someone sets, changes or removes a budget.",
  },
  household: {
    label: "Members",
    description:
      "Someone joins, leaves or is removed, or the household has a new owner.",
  },
};

export function isNotificationCategory(
  value: string,
): value is NotificationCategory {
  return (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The types to switch off, from the ones a form left ticked. Anything that
 * isn't a type is ignored; every type not ticked is muted.
 */
export function mutedFromChecked(
  checked: readonly string[],
): NotificationCategory[] {
  const on = new Set(checked.filter(isNotificationCategory));
  return NOTIFICATION_CATEGORIES.filter((c) => !on.has(c));
}
