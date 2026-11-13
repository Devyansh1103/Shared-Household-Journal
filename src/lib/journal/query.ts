// The household journal (roadmap Phase 13): which entries to show, read from
// the URL and written back to it, so a view can be refreshed, bookmarked or
// shared; and turned into the arguments of public.household_journal.
//
// Pure: no database, no clock. Nothing here trusts the URL: a filter or a
// cursor that isn't valid is reported, and nothing is fetched with it.

import type { Database } from "@/lib/supabase/database.types";

/** Entries per page. */
export const JOURNAL_PAGE_SIZE = 25;

/** What the journal can be narrowed to, in the order the filters list them. */
export const JOURNAL_FILTERS = [
  "all",
  "expenses",
  "settlements",
  "bills",
  "shopping",
  "chores",
  "household",
] as const;
export type JournalFilter = (typeof JOURNAL_FILTERS)[number];
/** The groups entries belong to; "all" is every group. */
export type JournalCategory = Exclude<JournalFilter, "all">;

export const FILTER_LABELS: Record<JournalFilter, string> = {
  all: "All activity",
  expenses: "Expenses",
  settlements: "Settlements",
  bills: "Bills",
  shopping: "Shopping",
  chores: "Chores",
  household: "Household",
};

/**
 * Where a page starts: strictly older than the entry that happened at `us`
 * (microseconds since the epoch) and has this id. Entries are ordered by
 * (time, id), newest first.
 */
export type JournalCursor = { us: bigint; id: string };

export type JournalQuery = {
  filter: JournalFilter;
  /** Null for the newest entries. */
  before: JournalCursor | null;
};

/** The URL's values as given. */
export type RawJournalQuery = { show: string; before: string };

export type JournalQueryResult =
  | { ok: true; query: JournalQuery }
  | { ok: false; problem: "filter" | "cursor" };

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** The URL's search params, as the journal page receives them. */
export function readJournalQuery(params: SearchParams): RawJournalQuery {
  return { show: one(params.show), before: one(params.before) };
}

/** Lowercase, as Postgres writes uuids: the order of ids depends on it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The cursor's time travels as a JSON number, so it must stay exact. */
const MAX_CURSOR_US = BigInt(Number.MAX_SAFE_INTEGER);

/** "1763029800123456.6f1c2f4e-…": the time in microseconds, then the id. */
export function formatCursor(cursor: JournalCursor): string {
  return `${cursor.us}.${cursor.id}`;
}

/** A cursor from the URL, or null if it isn't exactly one. */
export function parseCursor(text: string): JournalCursor | null {
  const match = /^(0|[1-9][0-9]{0,15})\.([0-9a-f-]{36})$/.exec(text);
  if (!match || !UUID.test(match[2])) return null;
  const us = BigInt(match[1]);
  if (us > MAX_CURSOR_US) return null;
  return { us, id: match[2] };
}

function isFilter(value: string): value is JournalFilter {
  return (JOURNAL_FILTERS as readonly string[]).includes(value);
}

/** Checks the URL's filter and cursor. Nothing else in the URL is used. */
export function parseJournalQuery(raw: RawJournalQuery): JournalQueryResult {
  const show = raw.show === "" ? "all" : raw.show;
  if (!isFilter(show)) return { ok: false, problem: "filter" };
  if (raw.before === "")
    return { ok: true, query: { filter: show, before: null } };
  const before = parseCursor(raw.before);
  if (!before) return { ok: false, problem: "cursor" };
  return { ok: true, query: { filter: show, before } };
}

/**
 * A link to the journal: the filter (left out for everything) and the
 * cursor (left out for the newest entries), in a fixed order.
 */
export function journalHref(base: string, query: JournalQuery): string {
  const params = new URLSearchParams();
  if (query.filter !== "all") params.set("show", query.filter);
  if (query.before) params.set("before", formatCursor(query.before));
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}

export type HouseholdJournalArgs =
  Database["public"]["Functions"]["household_journal"]["Args"];

/** The query as arguments of public.household_journal. */
export function journalArgs(
  householdId: string,
  query: JournalQuery,
): HouseholdJournalArgs {
  return {
    target_household_id: householdId,
    ...(query.filter !== "all" ? { category_filter: query.filter } : {}),
    // At most Number.MAX_SAFE_INTEGER (parseCursor): exact as a number.
    ...(query.before
      ? { before_us: Number(query.before.us), before_id: query.before.id }
      : {}),
    page_size: JOURNAL_PAGE_SIZE,
  };
}
