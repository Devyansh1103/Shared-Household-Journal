// The notification centre's view, read from the URL and written back to it:
// all or unread, and the page (a cursor, as in the journal). Pure.

import {
  formatCursor,
  parseCursor,
  type JournalCursor,
} from "@/lib/journal/query";
import type { Database } from "@/lib/supabase/database.types";

export const NOTIFICATIONS_PAGE_SIZE = 20;

export type NotificationsShow = "all" | "unread";

export type NotificationsQuery = {
  show: NotificationsShow;
  /** Null for the newest. */
  before: JournalCursor | null;
};

export type RawNotificationsQuery = { show: string; before: string };

export type NotificationsQueryResult =
  | { ok: true; query: NotificationsQuery }
  | { ok: false; problem: "show" | "cursor" };

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function readNotificationsQuery(
  params: SearchParams,
): RawNotificationsQuery {
  return { show: one(params.show), before: one(params.before) };
}

/** Checks the URL; nothing is guessed. */
export function parseNotificationsQuery(
  raw: RawNotificationsQuery,
): NotificationsQueryResult {
  const show = raw.show === "" ? "all" : raw.show;
  if (show !== "all" && show !== "unread")
    return { ok: false, problem: "show" };
  if (raw.before === "") return { ok: true, query: { show, before: null } };
  const before = parseCursor(raw.before);
  if (!before) return { ok: false, problem: "cursor" };
  return { ok: true, query: { show, before } };
}

export function notificationsHref(base: string, query: NotificationsQuery) {
  const params = new URLSearchParams();
  if (query.show !== "all") params.set("show", query.show);
  if (query.before) params.set("before", formatCursor(query.before));
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}

export type MyNotificationsArgs =
  Database["public"]["Functions"]["my_notifications"]["Args"];

export function notificationsArgs(
  query: NotificationsQuery,
): MyNotificationsArgs {
  return {
    unread_only: query.show === "unread",
    // At most Number.MAX_SAFE_INTEGER (parseCursor): exact as a number.
    ...(query.before
      ? { before_us: Number(query.before.us), before_id: query.before.id }
      : {}),
    page_size: NOTIFICATIONS_PAGE_SIZE,
  };
}
