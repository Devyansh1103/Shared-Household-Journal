import { describe, expect, it } from "vitest";
import {
  checkJournal,
  compareKeys,
  ENTRY_CATEGORIES,
  entryCategory,
  nextCursor,
  parseJournalPayload,
  type JournalEntryType,
  type JournalPage,
} from "./payload";
import type { JournalCursor } from "./query";

const HOUSEHOLD = "6f1c2f4e-8a7b-4c3d-9e2f-1a2b3c4d5e6f";
const OTHER_HOUSEHOLD = "7a2d3e5f-9b8c-4d4e-8f3a-2b3c4d5e6f7a";
const OLIVE = "11111111-1111-4111-8111-111111111111";
const PAT = "22222222-2222-4222-8222-222222222222";
const QUIN = "33333333-3333-4333-8333-333333333333";
const EXPENSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SETTLEMENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Event ids that sort in the order of n. */
function eventId(n: number): string {
  return `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const expenseDetail = {
  description: "Groceries",
  amount_minor: "125000",
  category: "groceries",
  paid_by: OLIVE,
};
const expenseChange = {
  ...expenseDetail,
  expense_date: "2026-11-12",
  split_method: "equal",
  participants: [OLIVE, PAT],
};
const settlementDetail = {
  from_user: PAT,
  to_user: OLIVE,
  amount_minor: "50000",
  settled_on: "2026-11-12",
  recorded_by: PAT,
};

const DETAILS: Record<JournalEntryType, unknown> = {
  household_created: { name: "Flat 4B" },
  member_joined: { user_id: PAT, inviter_id: OLIVE },
  member_left: { user_id: QUIN },
  member_removed: { user_id: QUIN },
  ownership_transferred: { from_user_id: OLIVE, to_user_id: PAT },
  invitation_created: {},
  invitation_revoked: { created_by: PAT },
  expense_created: expenseDetail,
  expense_updated: {
    before: expenseChange,
    after: { ...expenseChange, amount_minor: "130000" },
    shares_changed: true,
  },
  expense_deleted: expenseDetail,
  expense_restored: expenseDetail,
  settlement_recorded: settlementDetail,
  settlement_voided: settlementDetail,
};

function entityFor(type: JournalEntryType) {
  const category = ENTRY_CATEGORIES[type];
  if (category === "expenses") {
    return { available: true, id: EXPENSE, state: "active" };
  }
  if (category === "settlements") {
    return { available: true, id: SETTLEMENT, state: "active" };
  }
  return null;
}

type RawRow = {
  event_id: string;
  household_id: string;
  type: string;
  actor_id: string | null;
  created_us: string;
  detail: unknown;
  entity: unknown;
};

/** Rows newest first: row i happened i seconds before the first. */
function rowsOf(types: JournalEntryType[]): RawRow[] {
  return types.map((type, i) => ({
    event_id: eventId(1000 - i),
    household_id: HOUSEHOLD,
    type,
    actor_id: OLIVE,
    created_us: String(BigInt("1763029800000000") - BigInt(i * 1_000_000)),
    detail: DETAILS[type],
    entity: entityFor(type),
  }));
}

const ALL_TYPES = Object.keys(ENTRY_CATEGORIES) as JournalEntryType[];

function payload(rows: RawRow[], hasMore = false) {
  return {
    has_more: hasMore,
    rows,
    people: [
      { user_id: OLIVE, display_name: "Olive", is_active: true },
      { user_id: PAT, display_name: "Pat", is_active: true },
      { user_id: QUIN, display_name: "Quin", is_active: false },
    ],
  };
}

function parsed(rows: RawRow[], hasMore = false): JournalPage {
  const page = parseJournalPayload(payload(rows, hasMore));
  if (!page) throw new Error("expected the payload to parse");
  return page;
}

describe("parseJournalPayload", () => {
  it("reads every type of entry, with money and times as BigInt", () => {
    const page = parsed(rowsOf(ALL_TYPES));
    expect(page.entries.map((e) => e.detail.type)).toEqual(ALL_TYPES);
    expect(page.entries[0]).toMatchObject({
      id: eventId(1000),
      householdId: HOUSEHOLD,
      actorId: OLIVE,
      createdUs: BigInt("1763029800000000"),
      detail: { type: "household_created", name: "Flat 4B" },
      entity: null,
    });
    const created = page.entries.find(
      (e) => e.detail.type === "expense_created",
    );
    expect(created?.detail).toEqual({
      type: "expense_created",
      expense: {
        description: "Groceries",
        amountMinor: BigInt(125000),
        category: "groceries",
        paidBy: OLIVE,
      },
    });
    const updated = page.entries.find(
      (e) => e.detail.type === "expense_updated",
    );
    expect(updated?.detail).toMatchObject({
      type: "expense_updated",
      before: { amountMinor: BigInt(125000), participants: [OLIVE, PAT] },
      after: { amountMinor: BigInt(130000), splitMethod: "equal" },
      sharesChanged: true,
    });
    const recorded = page.entries.find(
      (e) => e.detail.type === "settlement_recorded",
    );
    expect(recorded?.detail).toEqual({
      type: "settlement_recorded",
      settlement: {
        fromUser: PAT,
        toUser: OLIVE,
        amountMinor: BigInt(50000),
        settledOn: "2026-11-12",
        recordedBy: PAT,
      },
    });
    expect(page.people).toContainEqual({
      userId: QUIN,
      displayName: "Quin",
      isActive: false,
    });
  });

  it("allows an actor-less change and an invitation that no longer exists", () => {
    const [row] = rowsOf(["member_joined"]);
    const page = parsed([
      { ...row, actor_id: null, detail: { user_id: PAT, inviter_id: null } },
    ]);
    expect(page.entries[0]).toMatchObject({
      actorId: null,
      detail: { type: "member_joined", userId: PAT, inviterId: null },
    });
  });

  it("refuses an entry carrying a field the journal doesn't show", () => {
    const [recorded] = rowsOf(["settlement_recorded"]);
    expect(
      parseJournalPayload(
        payload([
          { ...recorded, detail: { ...settlementDetail, note: "Rent, cash" } },
        ]),
      ),
    ).toBeNull();
    const [invite] = rowsOf(["invitation_created"]);
    expect(
      parseJournalPayload(payload([{ ...invite, detail: { max_uses: 10 } }])),
    ).toBeNull();
    const [created] = rowsOf(["expense_created"]);
    expect(
      parseJournalPayload(
        payload([{ ...created, detail: { ...expenseDetail, splits: [] } }]),
      ),
    ).toBeNull();
    expect(
      parseJournalPayload(payload([{ ...created, summary: {} } as RawRow])),
    ).toBeNull();
    expect(
      parseJournalPayload({ ...payload([created]), household_total: 1 }),
    ).toBeNull();
  });

  it("refuses unknown types, wrong shapes and impossible values", () => {
    const [created] = rowsOf(["expense_created"]);
    const bad: RawRow[] = [
      { ...created, type: "chore_completed" },
      { ...created, type: "settlement_recorded" },
      { ...created, detail: { ...expenseDetail, amount_minor: "0" } },
      { ...created, detail: { ...expenseDetail, amount_minor: "12.50" } },
      { ...created, detail: { ...expenseDetail, amount_minor: 125000 } },
      { ...created, detail: { ...expenseDetail, category: "pets" } },
      { ...created, detail: { ...expenseDetail, paid_by: "olive" } },
      { ...created, created_us: "-5" },
      { ...created, created_us: "1.5" },
      { ...created, event_id: "not-a-uuid" },
      { ...created, entity: { available: true, id: EXPENSE } },
      { ...created, entity: { available: "yes" } },
    ];
    for (const row of bad) {
      expect(
        parseJournalPayload(payload([row])),
        JSON.stringify(row),
      ).toBeNull();
    }
    expect(parseJournalPayload(null)).toBeNull();
    expect(parseJournalPayload({ has_more: false, rows: [] })).toBeNull();
  });
});

describe("compareKeys", () => {
  it("orders by time, then by id for the same time", () => {
    const at = (us: number, n: number): JournalCursor => ({
      us: BigInt(us),
      id: eventId(n),
    });
    expect(compareKeys(at(1, 9), at(2, 1))).toBeLessThan(0);
    expect(compareKeys(at(2, 1), at(2, 9))).toBeLessThan(0);
    expect(compareKeys(at(2, 9), at(2, 9))).toBe(0);
    expect(compareKeys(at(3, 1), at(2, 9))).toBeGreaterThan(0);
  });
});

describe("entryCategory", () => {
  it("puts each type under the filter that shows it", () => {
    const page = parsed(rowsOf(ALL_TYPES));
    expect(page.entries.map(entryCategory)).toEqual([
      ...Array(7).fill("household"),
      ...Array(4).fill("expenses"),
      ...Array(2).fill("settlements"),
    ]);
  });
});

describe("checkJournal", () => {
  const options = {
    householdId: HOUSEHOLD,
    filter: "all" as const,
    before: null,
    pageSize: 25,
  };

  it("accepts a page in order, for every filter it matches", () => {
    expect(checkJournal(parsed(rowsOf(ALL_TYPES)), options)).toEqual({
      ok: true,
    });
    const expenses = parsed(
      rowsOf(["expense_created", "expense_updated", "expense_deleted"]),
    );
    expect(checkJournal(expenses, { ...options, filter: "expenses" })).toEqual({
      ok: true,
    });
    expect(checkJournal(parsed([]), options)).toEqual({ ok: true });
  });

  it("orders entries at the same time by id", () => {
    const [a, b] = rowsOf(["invitation_created", "invitation_created"]);
    const same = { ...b, created_us: a.created_us };
    expect(checkJournal(parsed([a, same]), options)).toEqual({ ok: true });
    expect(checkJournal(parsed([same, a]), options)).toEqual({
      ok: false,
      code: "order_mismatch",
    });
  });

  it("refuses entries out of order or repeated", () => {
    const rows = rowsOf(["expense_created", "expense_deleted"]);
    expect(checkJournal(parsed([...rows].reverse()), options)).toEqual({
      ok: false,
      code: "order_mismatch",
    });
    expect(checkJournal(parsed([rows[0], rows[0]]), options)).toEqual({
      ok: false,
      code: "duplicate_entry",
    });
  });

  it("refuses another household's entry", () => {
    const [row] = rowsOf(["expense_created"]);
    expect(
      checkJournal(
        parsed([{ ...row, household_id: OTHER_HOUSEHOLD }]),
        options,
      ),
    ).toEqual({ ok: false, code: "foreign_entry" });
  });

  it("refuses an entry the filter doesn't allow", () => {
    const page = parsed(rowsOf(["expense_created", "settlement_recorded"]));
    expect(checkJournal(page, { ...options, filter: "expenses" })).toEqual({
      ok: false,
      code: "filter_mismatch",
    });
    expect(checkJournal(page, { ...options, filter: "household" })).toEqual({
      ok: false,
      code: "filter_mismatch",
    });
  });

  it("refuses a record state that doesn't fit the entry", () => {
    const [expense] = rowsOf(["expense_created"]);
    const [payment] = rowsOf(["settlement_voided"]);
    const [member] = rowsOf(["member_left"]);
    for (const row of [
      { ...expense, entity: null },
      { ...expense, entity: { available: true, id: EXPENSE, state: "voided" } },
      {
        ...payment,
        entity: { available: true, id: SETTLEMENT, state: "deleted" },
      },
      { ...member, entity: { available: false } },
    ]) {
      expect(checkJournal(parsed([row]), options)).toEqual({
        ok: false,
        code: "entity_mismatch",
      });
    }
    // A record that's gone is allowed: the entry just can't link to it.
    expect(
      checkJournal(
        parsed([{ ...expense, entity: { available: false } }]),
        options,
      ),
    ).toEqual({ ok: true });
    expect(
      checkJournal(
        parsed([
          {
            ...expense,
            entity: { available: true, id: EXPENSE, state: "deleted" },
          },
        ]),
        options,
      ),
    ).toEqual({ ok: true });
  });

  it("refuses more than a page, or a short page that promises more", () => {
    const rows = rowsOf(ALL_TYPES);
    expect(
      checkJournal(parsed(rows), { ...options, pageSize: rows.length - 1 }),
    ).toEqual({ ok: false, code: "page_mismatch" });
    expect(
      checkJournal(parsed(rows, true), {
        ...options,
        pageSize: rows.length + 1,
      }),
    ).toEqual({ ok: false, code: "page_mismatch" });
    expect(
      checkJournal(parsed(rows, true), { ...options, pageSize: rows.length }),
    ).toEqual({ ok: true });
  });

  it("refuses entries that aren't strictly older than the cursor", () => {
    const rows = rowsOf(["expense_created", "expense_deleted"]);
    const page = parsed(rows);
    const first = page.entries[0];
    const at = (us: bigint, id: string) => ({
      ...options,
      before: { us, id },
    });
    expect(
      checkJournal(page, at(first.createdUs + BigInt(1), first.id)),
    ).toEqual({
      ok: true,
    });
    expect(checkJournal(page, at(first.createdUs, eventId(9999)))).toEqual({
      ok: true,
    });
    for (const before of [
      at(first.createdUs, first.id),
      at(first.createdUs, eventId(1)),
      at(first.createdUs - BigInt(1), eventId(9999)),
    ]) {
      expect(checkJournal(page, before)).toEqual({
        ok: false,
        code: "cursor_mismatch",
      });
    }
  });

  it("refuses a person listed twice", () => {
    const page = parsed(rowsOf(["member_left"]));
    expect(
      checkJournal(
        { ...page, people: [...page.people, page.people[0]] },
        options,
      ),
    ).toEqual({ ok: false, code: "people_mismatch" });
  });
});

describe("nextCursor", () => {
  it("is the last entry when more are promised, otherwise there's none", () => {
    const rows = rowsOf(["expense_created", "expense_deleted"]);
    const page = parsed(rows, true);
    expect(nextCursor(page)).toEqual({
      us: page.entries[1].createdUs,
      id: page.entries[1].id,
    });
    expect(nextCursor(parsed(rows, false))).toBeNull();
    expect(nextCursor(parsed([], true))).toBeNull();
  });
});
