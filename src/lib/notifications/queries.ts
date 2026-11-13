import "server-only";
import { requireUser } from "@/lib/auth/session";
import { getBills } from "@/lib/bills/queries";
import { getBudgets } from "@/lib/budgets/queries";
import { BUDGET_PERIODS } from "@/lib/budgets/period";
import type { HouseholdBudgets } from "@/lib/budgets/payload";
import type { Chore } from "@/lib/chores/board";
import { todayIn } from "@/lib/expenses/dates";
import { listMyHouseholds } from "@/lib/households/queries";
import { createClient } from "@/lib/supabase/server";
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "./categories";
import {
  checkNotifications,
  parseNotifications,
  type NotificationsPage,
} from "./payload";
import {
  NOTIFICATIONS_PAGE_SIZE,
  notificationsArgs,
  type NotificationsQuery,
} from "./query";
import { householdReminders, type Reminder } from "./reminders";

// Data access for notifications (roadmap Phase 17, D12). Everything runs as
// the signed-in person under RLS: their own notifications, in households
// they're an active member of. Writes go through mark_notifications_read and
// set_notification_preferences; notifications themselves are written only by
// the database, with the journal event they're about.

export type NotificationsView =
  { ok: true; page: NotificationsPage } | { ok: false; reason: "not_verified" };

export async function getNotifications(
  query: NotificationsQuery,
): Promise<NotificationsView> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "my_notifications",
    notificationsArgs(query),
  );
  if (error) throw new Error("Could not load your notifications.");
  const page = parseNotifications(data);
  const check = page
    ? checkNotifications(page, {
        unreadOnly: query.show === "unread",
        before: query.before,
        pageSize: NOTIFICATIONS_PAGE_SIZE,
      })
    : ({ ok: false, code: "malformed" } as const);
  if (!page || !check.ok) {
    // The reason only: no names, amounts or ids in logs.
    console.error(
      `Notifications failed verification: ${check.ok ? "malformed" : check.code}`,
    );
    return { ok: false, reason: "not_verified" };
  }
  return { ok: true, page };
}

/** One of the signed-in person's notifications, or null (anyone else's, or none). */
export async function getNotification(
  notificationId: string,
): Promise<NotificationsPage | null> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_notifications", {
    target_notification_id: notificationId,
    page_size: 1,
  });
  if (error) throw new Error("Could not load the notification.");
  const page = parseNotifications(data);
  if (
    !page ||
    page.items.length !== 1 ||
    page.items[0].id !== notificationId ||
    !checkNotifications(page, { unreadOnly: false, before: null, pageSize: 1 })
      .ok
  ) {
    return null;
  }
  return page;
}

/** For each household, the types the signed-in person switched off. */
export async function getMutedCategories(): Promise<
  Map<string, Set<NotificationCategory>>
> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("household_id, category, enabled");
  if (error) throw new Error("Could not load your notification settings.");
  const muted = new Map<string, Set<NotificationCategory>>();
  for (const row of data) {
    if (row.enabled) continue;
    if (!(NOTIFICATION_CATEGORIES as readonly string[]).includes(row.category))
      continue;
    const set = muted.get(row.household_id) ?? new Set<NotificationCategory>();
    set.add(row.category);
    muted.set(row.household_id, set);
  }
  return muted;
}

export type RemindersView = {
  reminders: Reminder[];
  /** Households whose bills, chores or budgets couldn't be read just now. */
  incomplete: string[];
};

const CHORE_COLUMNS =
  "id, household_id, title, description, assignee_id, due_on, priority, created_by, completed_at, completed_by, created_at, updated_at";

/**
 * What needs attention now in each of the signed-in person's households.
 * The caller must have called io(): "today" is the household's date (D11).
 */
export async function getReminders(): Promise<RemindersView> {
  const user = await requireUser();
  const households = await listMyHouseholds();
  const supabase = await createClient();
  const incomplete: string[] = [];

  const perHousehold = await Promise.all(
    households.map(async (household) => {
      const today = todayIn(household.timezone);
      try {
        const [bills, chores, ...budgets] = await Promise.all([
          getBills(household.id),
          supabase
            .from("chores")
            .select(CHORE_COLUMNS)
            .eq("household_id", household.id)
            .is("removed_at", null)
            .is("completed_at", null)
            .not("due_on", "is", null)
            .lte("due_on", today)
            .order("due_on", { ascending: true })
            .limit(100),
          ...BUDGET_PERIODS.map((period) =>
            getBudgets(household.id, period, null),
          ),
        ]);
        if (!bills.ok || chores.error || budgets.some((b) => !b.ok)) {
          incomplete.push(household.name);
        }
        const choreRows: Chore[] = (chores.data ?? [])
          .filter((row) => row.household_id === household.id)
          .map((row) => ({
            id: row.id,
            householdId: row.household_id,
            title: row.title,
            description: row.description,
            assigneeId: row.assignee_id,
            dueOn: row.due_on,
            priority: row.priority,
            createdBy: row.created_by,
            completedAt: row.completed_at,
            completedBy: row.completed_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }));
        return householdReminders(
          {
            household: {
              id: household.id,
              name: household.name,
              currencyCode: household.currencyCode,
            },
            today,
            bills: bills.ok ? bills.bills : null,
            chores: choreRows,
            budgets: budgets.flatMap((b): HouseholdBudgets[] =>
              b.ok ? [b.data] : [],
            ),
          },
          user.id,
        );
      } catch {
        incomplete.push(household.name);
        return [];
      }
    }),
  );
  return { reminders: perHousehold.flat(), incomplete };
}
