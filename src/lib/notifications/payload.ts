// Reads what public.my_notifications returns and checks it before anything is
// shown. Each notification carries its journal event in the journal's own
// projection, so it's parsed with the journal's strict shapes: a field the
// journal doesn't show (a note, say) fails the parse.

import { z } from "zod";
import {
  compareKeys,
  ENTRY_CATEGORIES,
  ENTRY_TYPES,
  entityMatches,
  entitySchema,
  parseDetail,
  type JournalEntry,
  type JournalPerson,
} from "@/lib/journal/payload";
import type { JournalCursor } from "@/lib/journal/query";
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "./categories";

const id = z.uuid();
const microseconds = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform((value) => BigInt(value));

const schema = z.strictObject({
  has_more: z.boolean(),
  unread_count: z.number().int().min(0),
  rows: z.array(
    z.strictObject({
      notification_id: id,
      household_id: id,
      household_name: z.string(),
      currency_code: z.string().regex(/^[A-Z]{3}$/),
      timezone: z.string().min(1),
      category: z.enum(NOTIFICATION_CATEGORIES),
      read: z.boolean(),
      created_us: microseconds,
      event: z.strictObject({
        event_id: id,
        type: z.enum(ENTRY_TYPES),
        actor_id: id.nullable(),
        detail: z.unknown(),
        entity: entitySchema,
      }),
    }),
  ),
  people: z.array(
    z.strictObject({
      household_id: id,
      user_id: id,
      display_name: z.string(),
      is_active: z.boolean(),
    }),
  ),
});

export type NotificationItem = {
  id: string;
  householdId: string;
  householdName: string;
  /** The household's currency (D1) and timezone (D11), for the words. */
  currency: string;
  timeZone: string;
  category: NotificationCategory;
  read: boolean;
  /** When the event happened, in microseconds since the epoch. */
  createdUs: bigint;
  /** The journal entry it's about, as the journal shows it. */
  entry: JournalEntry;
};

export type NotificationPerson = JournalPerson & { householdId: string };

export type NotificationsPage = {
  hasMore: boolean;
  unreadCount: number;
  /** Newest first. */
  items: NotificationItem[];
  /** Everyone the items mention, per household ("(left)" is per household). */
  people: NotificationPerson[];
};

export function parseNotifications(payload: unknown): NotificationsPage | null {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return null;
  const items: NotificationItem[] = [];
  for (const row of parsed.data.rows) {
    const detail = parseDetail(row.event.type, row.event.detail);
    if (!detail) return null;
    items.push({
      id: row.notification_id,
      householdId: row.household_id,
      householdName: row.household_name,
      currency: row.currency_code,
      timeZone: row.timezone,
      category: row.category,
      read: row.read,
      createdUs: row.created_us,
      entry: {
        id: row.event.event_id,
        householdId: row.household_id,
        actorId: row.event.actor_id,
        createdUs: row.created_us,
        detail,
        entity: row.event.entity,
      },
    });
  }
  return {
    hasMore: parsed.data.has_more,
    unreadCount: parsed.data.unread_count,
    items,
    people: parsed.data.people.map((p) => ({
      householdId: p.household_id,
      userId: p.user_id,
      displayName: p.display_name,
      isActive: p.is_active,
    })),
  };
}

/** The people of one household, as the journal's words need them. */
export function peopleIn(
  page: Pick<NotificationsPage, "people">,
  householdId: string,
): JournalPerson[] {
  return page.people
    .filter((p) => p.householdId === householdId)
    .map(({ userId, displayName, isActive }) => ({
      userId,
      displayName,
      isActive,
    }));
}

export function notificationKey(item: NotificationItem): JournalCursor {
  return { us: item.createdUs, id: item.id };
}

/** The cursor for the next (older) page, if there is one. */
export function nextNotificationsCursor(
  page: NotificationsPage,
): JournalCursor | null {
  const last = page.items.at(-1);
  return page.hasMore && last ? notificationKey(last) : null;
}

export type NotificationsCheckCode =
  | "page_mismatch"
  | "duplicate_notification"
  | "category_mismatch"
  | "entity_mismatch"
  | "read_mismatch"
  | "order_mismatch"
  | "cursor_mismatch"
  | "people_mismatch";

export type NotificationsCheck =
  { ok: true } | { ok: false; code: NotificationsCheckCode };

const fail = (code: NotificationsCheckCode): NotificationsCheck => ({
  ok: false,
  code,
});

/**
 * Checks a page before it's shown: at most a page (a full one when more are
 * promised); each notification once, of the type its event is, about a record
 * of the right kind; unread only when only unread ones were asked for; newest
 * first, strictly older than the cursor; no more unread than counted; each
 * person once per household.
 */
export function checkNotifications(
  page: NotificationsPage,
  asked: {
    unreadOnly: boolean;
    before: JournalCursor | null;
    pageSize: number;
  },
): NotificationsCheck {
  const { items } = page;
  if (
    items.length > asked.pageSize ||
    (page.hasMore && items.length !== asked.pageSize)
  ) {
    return fail("page_mismatch");
  }
  const ids = new Set<string>();
  const events = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id) || events.has(item.entry.id)) {
      return fail("duplicate_notification");
    }
    ids.add(item.id);
    events.add(item.entry.id);
    if (ENTRY_CATEGORIES[item.entry.detail.type] !== item.category) {
      return fail("category_mismatch");
    }
    if (!entityMatches(item.entry)) return fail("entity_mismatch");
    if (asked.unreadOnly && item.read) return fail("read_mismatch");
  }
  if (items.filter((i) => !i.read).length > page.unreadCount) {
    return fail("read_mismatch");
  }
  for (let i = 1; i < items.length; i++) {
    if (
      compareKeys(notificationKey(items[i - 1]), notificationKey(items[i])) <= 0
    ) {
      return fail("order_mismatch");
    }
  }
  if (
    asked.before &&
    items.length > 0 &&
    compareKeys(notificationKey(items[0]), asked.before) >= 0
  ) {
    return fail("cursor_mismatch");
  }
  const people = new Set(
    page.people.map((p) => `${p.householdId}|${p.userId}`),
  );
  if (people.size !== page.people.length) return fail("people_mismatch");
  return { ok: true };
}
