// Reads what public.household_journal returns and checks it before anything
// is shown, as the expense history does (history-payload.ts): every entry is
// this household's, once, of a type the filter allows, older than the cursor
// and in the promised order. Otherwise the page says so and shows no entries.
//
// The shapes are strict: an entry carrying a field the journal doesn't show
// (a settlement's note, say) fails the parse instead of being passed on. The
// read model leaves those out in SQL; this is the second check.

import { z } from "zod";
import type { SplitMethod } from "@/domain/money/split";
import {
  CATEGORY_VALUES,
  type ExpenseCategory,
} from "@/lib/expenses/categories";
import type { Database } from "@/lib/supabase/database.types";
import type { JournalCategory, JournalCursor, JournalFilter } from "./query";

type EventType = Database["public"]["Enums"]["activity_event_type"];

/**
 * The event types the journal shows, and the filter each belongs to. Every
 * type that exists today is here; a type added later must be added on
 * purpose, here and in public.household_journal.
 */
export const ENTRY_CATEGORIES = {
  household_created: "household",
  member_joined: "household",
  member_left: "household",
  member_removed: "household",
  ownership_transferred: "household",
  invitation_created: "household",
  invitation_revoked: "household",
  expense_created: "expenses",
  expense_updated: "expenses",
  expense_deleted: "expenses",
  expense_restored: "expenses",
  settlement_recorded: "settlements",
  settlement_voided: "settlements",
} as const satisfies Record<EventType, JournalCategory>;

export type JournalEntryType = keyof typeof ENTRY_CATEGORIES;

const ENTRY_TYPES = Object.keys(ENTRY_CATEGORIES) as [
  JournalEntryType,
  ...JournalEntryType[],
];

const id = z.uuid();
/** Amounts are whole minor units above zero, as text. */
const amount = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform((value) => BigInt(value));
const microseconds = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform((value) => BigInt(value));

const SPLIT_METHOD_VALUES = [
  "equal",
  "percentage",
  "custom",
] as const satisfies readonly SplitMethod[];

const expenseShape = {
  description: z.string(),
  amount_minor: amount,
  category: z.enum(CATEGORY_VALUES),
  paid_by: id,
};
const expenseSchema = z.strictObject(expenseShape);
const expenseChangeSchema = z.strictObject({
  ...expenseShape,
  expense_date: z.iso.date(),
  split_method: z.enum(SPLIT_METHOD_VALUES),
  participants: z.array(id),
});
const settlementSchema = z.strictObject({
  from_user: id,
  to_user: id,
  amount_minor: amount,
  settled_on: z.iso.date(),
  recorded_by: id,
});

const detailSchemas = {
  household_created: z.strictObject({ name: z.string() }),
  member_joined: z.strictObject({ user_id: id, inviter_id: id.nullable() }),
  member_left: z.strictObject({ user_id: id }),
  member_removed: z.strictObject({ user_id: id }),
  ownership_transferred: z.strictObject({ from_user_id: id, to_user_id: id }),
  invitation_created: z.strictObject({}),
  invitation_revoked: z.strictObject({ created_by: id }),
  expense_created: expenseSchema,
  expense_updated: z.strictObject({
    before: expenseChangeSchema,
    after: expenseChangeSchema,
    shares_changed: z.boolean(),
  }),
  expense_deleted: expenseSchema,
  expense_restored: expenseSchema,
  settlement_recorded: settlementSchema,
  settlement_voided: settlementSchema,
} satisfies Record<JournalEntryType, z.ZodType>;

const entitySchema = z
  .union([
    z.strictObject({ available: z.literal(false) }),
    z.strictObject({
      available: z.literal(true),
      id,
      state: z.enum(["active", "deleted", "voided"]),
    }),
  ])
  .nullable();

const payloadSchema = z.strictObject({
  has_more: z.boolean(),
  rows: z.array(
    z.strictObject({
      event_id: id,
      household_id: id,
      type: z.enum(ENTRY_TYPES),
      actor_id: id.nullable(),
      created_us: microseconds,
      detail: z.unknown(),
      entity: entitySchema,
    }),
  ),
  people: z.array(
    z.strictObject({
      user_id: id,
      display_name: z.string(),
      is_active: z.boolean(),
    }),
  ),
});

export type ExpenseFields = {
  description: string;
  amountMinor: bigint;
  category: ExpenseCategory;
  paidBy: string;
};

export type ExpenseChangeFields = ExpenseFields & {
  expenseDate: string;
  splitMethod: SplitMethod;
  /** Who shares it, by id, sorted. Their shares stay out. */
  participants: string[];
};

export type SettlementFields = {
  fromUser: string;
  toUser: string;
  amountMinor: bigint;
  settledOn: string;
  recordedBy: string;
};

/** What each type of entry carries; nothing else reaches the page. */
export type JournalDetail =
  | { type: "household_created"; name: string }
  | { type: "member_joined"; userId: string; inviterId: string | null }
  | { type: "member_left"; userId: string }
  | { type: "member_removed"; userId: string }
  | { type: "ownership_transferred"; fromUserId: string; toUserId: string }
  | { type: "invitation_created" }
  | { type: "invitation_revoked"; createdBy: string }
  | {
      type: "expense_created" | "expense_deleted" | "expense_restored";
      expense: ExpenseFields;
    }
  | {
      type: "expense_updated";
      before: ExpenseChangeFields;
      after: ExpenseChangeFields;
      /** Someone's share changed (the shares themselves stay out). */
      sharesChanged: boolean;
    }
  | {
      type: "settlement_recorded" | "settlement_voided";
      settlement: SettlementFields;
    };

/**
 * The expense or payment an entry is about, as it is now: null for other
 * entries; unavailable if it isn't in this household (nothing to link to).
 */
export type JournalEntity =
  | { available: false }
  | { available: true; id: string; state: "active" | "deleted" | "voided" };

export type JournalEntry = {
  id: string;
  householdId: string;
  /** Null only for a change made outside a user session. */
  actorId: string | null;
  /** When it happened, in microseconds since the epoch: exact. */
  createdUs: bigint;
  detail: JournalDetail;
  entity: JournalEntity | null;
};

export type JournalPerson = {
  userId: string;
  displayName: string;
  /** False for someone who has left (D13): shown with "(left)". */
  isActive: boolean;
};

export type JournalPage = {
  /** Older entries exist past this page. */
  hasMore: boolean;
  /** Newest first. */
  entries: JournalEntry[];
  /** Everyone the entries mention. */
  people: JournalPerson[];
};

function expenseFields(value: z.infer<typeof expenseSchema>): ExpenseFields {
  return {
    description: value.description,
    amountMinor: value.amount_minor,
    category: value.category,
    paidBy: value.paid_by,
  };
}

function expenseChange(
  value: z.infer<typeof expenseChangeSchema>,
): ExpenseChangeFields {
  return {
    ...expenseFields(value),
    expenseDate: value.expense_date,
    splitMethod: value.split_method,
    participants: value.participants,
  };
}

function settlementFields(
  value: z.infer<typeof settlementSchema>,
): SettlementFields {
  return {
    fromUser: value.from_user,
    toUser: value.to_user,
    amountMinor: value.amount_minor,
    settledOn: value.settled_on,
    recordedBy: value.recorded_by,
  };
}

/** One entry's detail as typed values, or null if it isn't its type's shape. */
function parseDetail(
  type: JournalEntryType,
  detail: unknown,
): JournalDetail | null {
  switch (type) {
    case "household_created": {
      const d = detailSchemas[type].safeParse(detail);
      return d.success ? { type, name: d.data.name } : null;
    }
    case "member_joined": {
      const d = detailSchemas[type].safeParse(detail);
      return d.success
        ? { type, userId: d.data.user_id, inviterId: d.data.inviter_id }
        : null;
    }
    case "member_left":
    case "member_removed": {
      const d = detailSchemas[type].safeParse(detail);
      return d.success ? { type, userId: d.data.user_id } : null;
    }
    case "ownership_transferred": {
      const d = detailSchemas[type].safeParse(detail);
      return d.success
        ? { type, fromUserId: d.data.from_user_id, toUserId: d.data.to_user_id }
        : null;
    }
    case "invitation_created": {
      const d = detailSchemas[type].safeParse(detail);
      return d.success ? { type } : null;
    }
    case "invitation_revoked": {
      const d = detailSchemas[type].safeParse(detail);
      return d.success ? { type, createdBy: d.data.created_by } : null;
    }
    case "expense_created":
    case "expense_deleted":
    case "expense_restored": {
      const d = detailSchemas[type].safeParse(detail);
      return d.success ? { type, expense: expenseFields(d.data) } : null;
    }
    case "expense_updated": {
      const d = detailSchemas[type].safeParse(detail);
      return d.success
        ? {
            type,
            before: expenseChange(d.data.before),
            after: expenseChange(d.data.after),
            sharesChanged: d.data.shares_changed,
          }
        : null;
    }
    case "settlement_recorded":
    case "settlement_voided": {
      const d = detailSchemas[type].safeParse(detail);
      return d.success ? { type, settlement: settlementFields(d.data) } : null;
    }
  }
}

/** The payload as typed values, or null if it isn't exactly what's expected. */
export function parseJournalPayload(payload: unknown): JournalPage | null {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  const entries: JournalEntry[] = [];
  for (const row of parsed.data.rows) {
    const detail = parseDetail(row.type, row.detail);
    if (!detail) return null;
    entries.push({
      id: row.event_id,
      householdId: row.household_id,
      actorId: row.actor_id,
      createdUs: row.created_us,
      detail,
      entity: row.entity,
    });
  }
  return {
    hasMore: parsed.data.has_more,
    entries,
    people: parsed.data.people.map((person) => ({
      userId: person.user_id,
      displayName: person.display_name,
      isActive: person.is_active,
    })),
  };
}

/** Which filter an entry belongs to. */
export function entryCategory(entry: JournalEntry): JournalCategory {
  return ENTRY_CATEGORIES[entry.detail.type];
}

/** Code-point order: the order Postgres gives lowercase uuids. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareBig(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Oldest first by (time, id): the journal's order, reversed. */
export function compareKeys(a: JournalCursor, b: JournalCursor): number {
  return compareBig(a.us, b.us) || compareText(a.id, b.id);
}

export function entryKey(entry: JournalEntry): JournalCursor {
  return { us: entry.createdUs, id: entry.id };
}

/** The cursor for the next (older) page, if there is one. */
export function nextCursor(page: JournalPage): JournalCursor | null {
  const last = page.entries.at(-1);
  return page.hasMore && last ? entryKey(last) : null;
}

export type JournalCheckCode =
  | "page_mismatch"
  | "foreign_entry"
  | "duplicate_entry"
  | "filter_mismatch"
  | "entity_mismatch"
  | "order_mismatch"
  | "cursor_mismatch"
  | "people_mismatch";

export type JournalCheck = { ok: true } | { ok: false; code: JournalCheckCode };

function fail(code: JournalCheckCode): JournalCheck {
  return { ok: false, code };
}

/** The record an entry may be about, and the states that record can be in. */
function entityMatches(entry: JournalEntry): boolean {
  const category = entryCategory(entry);
  if (category === "household") return entry.entity === null;
  if (entry.entity === null) return false;
  if (!entry.entity.available) return true;
  return category === "expenses"
    ? entry.entity.state !== "voided"
    : entry.entity.state !== "deleted";
}

/**
 * Checks a page of the journal before it's shown:
 * - at most a page of entries, and a full page when more are promised;
 * - every entry is this household's, once, and allowed by the filter;
 * - expense and payment entries, and only those, say what they're about;
 * - newest first by (time, id), all strictly older than the cursor;
 * - each person is listed once.
 */
export function checkJournal(
  page: JournalPage,
  {
    householdId,
    filter,
    before,
    pageSize,
  }: {
    householdId: string;
    filter: JournalFilter;
    before: JournalCursor | null;
    pageSize: number;
  },
): JournalCheck {
  const { entries } = page;
  if (
    entries.length > pageSize ||
    (page.hasMore && entries.length !== pageSize)
  ) {
    return fail("page_mismatch");
  }

  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) return fail("duplicate_entry");
    ids.add(entry.id);
    if (entry.householdId !== householdId) return fail("foreign_entry");
    if (filter !== "all" && entryCategory(entry) !== filter) {
      return fail("filter_mismatch");
    }
    if (!entityMatches(entry)) return fail("entity_mismatch");
  }

  for (let i = 1; i < entries.length; i++) {
    if (compareKeys(entryKey(entries[i - 1]), entryKey(entries[i])) <= 0) {
      return fail("order_mismatch");
    }
  }
  if (
    before &&
    entries.length > 0 &&
    compareKeys(entryKey(entries[0]), before) >= 0
  ) {
    return fail("cursor_mismatch");
  }

  const people = new Set(page.people.map((p) => p.userId));
  if (people.size !== page.people.length) return fail("people_mismatch");
  return { ok: true };
}
