import { describe, expect, it } from "vitest";
import { entryDescriber, type EntryDescription } from "./describe";
import type {
  ExpenseChangeFields,
  JournalDetail,
  JournalEntity,
  JournalEntry,
  JournalPerson,
} from "./payload";

const HOUSEHOLD = "6f1c2f4e-8a7b-4c3d-9e2f-1a2b3c4d5e6f";
const OLIVE = "11111111-1111-4111-8111-111111111111";
const PAT = "22222222-2222-4222-8222-222222222222";
const QUIN = "33333333-3333-4333-8333-333333333333";
const RAJ = "44444444-4444-4444-8444-444444444444";
const GONE = "55555555-5555-4555-8555-555555555555";
const EXPENSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SETTLEMENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const PEOPLE: JournalPerson[] = [
  { userId: OLIVE, displayName: "Olive", isActive: true },
  { userId: PAT, displayName: "Pat", isActive: true },
  { userId: QUIN, displayName: "Quin", isActive: false },
  { userId: RAJ, displayName: "Raj", isActive: true },
];

/** Described as Pat sees it, in a household that uses rupees. */
const describeForPat = entryDescriber({
  householdId: HOUSEHOLD,
  viewerId: PAT,
  currency: "INR",
  people: PEOPLE,
});

const activeExpense: JournalEntity = {
  available: true,
  id: EXPENSE,
  state: "active",
};
const activePayment: JournalEntity = {
  available: true,
  id: SETTLEMENT,
  state: "active",
};

function entry(
  detail: JournalDetail,
  {
    actorId = OLIVE,
    entity = null,
  }: { actorId?: string | null; entity?: JournalEntity | null } = {},
): JournalEntry {
  return {
    id: "e0000000-0000-4000-8000-000000000001",
    householdId: HOUSEHOLD,
    actorId,
    createdUs: BigInt("1763029800000000"),
    detail,
    entity,
  };
}

const groceries = {
  description: "Groceries",
  amountMinor: BigInt(125000),
  category: "groceries" as const,
  paidBy: OLIVE,
};

const beforeEdit: ExpenseChangeFields = {
  ...groceries,
  expenseDate: "2026-11-12",
  splitMethod: "equal",
  participants: [OLIVE, PAT],
};

function updated(
  after: Partial<ExpenseChangeFields>,
  sharesChanged = false,
): JournalEntry {
  return entry(
    {
      type: "expense_updated",
      before: beforeEdit,
      after: { ...beforeEdit, ...after },
      sharesChanged,
    },
    { entity: activeExpense },
  );
}

/** Every piece of text an entry shows (not its link target). */
function texts(d: EntryDescription): string[] {
  return [
    d.title,
    d.summary ?? "",
    d.categoryLabel,
    ...d.context,
    ...d.changes.flatMap((c) =>
      c.kind === "value" ? [c.label, c.from, c.to] : [c.label, c.text],
    ),
    d.link?.label ?? "",
    d.link?.accessibleLabel ?? "",
  ];
}

describe("household entries", () => {
  it("say who created the household, joined, left or was removed", () => {
    expect(
      describeForPat(entry({ type: "household_created", name: "Flat 4B" })),
    ).toMatchObject({
      category: "household",
      categoryLabel: "Household",
      title: "Olive created the household “Flat 4B”",
      summary: null,
      link: null,
    });

    const joined = describeForPat(
      entry(
        { type: "member_joined", userId: PAT, inviterId: OLIVE },
        { actorId: PAT },
      ),
    );
    expect(joined.title).toBe("You joined the household");
    expect(joined.context).toEqual(["Invited by Olive"]);
    expect(joined.link).toEqual({
      href: `/households/${HOUSEHOLD}#members`,
      label: "See members",
      accessibleLabel: "See members",
    });

    expect(
      describeForPat(
        entry(
          { type: "member_joined", userId: RAJ, inviterId: null },
          { actorId: RAJ },
        ),
      ).context,
    ).toEqual([]);
    expect(
      describeForPat(
        entry(
          { type: "member_joined", userId: RAJ, inviterId: PAT },
          { actorId: RAJ },
        ),
      ).context,
    ).toEqual(["Invited by you"]);

    // The sentence says they left, so no "(left)" label here.
    expect(
      describeForPat(
        entry({ type: "member_left", userId: QUIN }, { actorId: QUIN }),
      ).title,
    ).toBe("Quin left the household");
    expect(
      describeForPat(entry({ type: "member_removed", userId: QUIN })).title,
    ).toBe("Olive removed Quin from the household");
    // Elsewhere, someone who has since left keeps the label (D13).
    expect(
      describeForPat(
        entry(
          { type: "member_joined", userId: QUIN, inviterId: OLIVE },
          { actorId: QUIN },
        ),
      ).title,
    ).toBe("Quin (left) joined the household");
  });

  it("say who handed over ownership and what happened to invite links", () => {
    expect(
      describeForPat(
        entry({
          type: "ownership_transferred",
          fromUserId: OLIVE,
          toUserId: PAT,
        }),
      ).title,
    ).toBe("Olive made you the owner");
    expect(
      describeForPat(
        entry(
          { type: "ownership_transferred", fromUserId: PAT, toUserId: RAJ },
          { actorId: PAT },
        ),
      ).title,
    ).toBe("You made Raj the owner");

    const created = describeForPat(entry({ type: "invitation_created" }));
    expect(created.title).toBe("Olive created an invite link");
    expect(created.link?.href).toBe(`/households/${HOUSEHOLD}#invite-links`);

    expect(
      describeForPat(entry({ type: "invitation_revoked", createdBy: OLIVE })),
    ).toMatchObject({ title: "Olive revoked an invite link", context: [] });
    expect(
      describeForPat(entry({ type: "invitation_revoked", createdBy: PAT }))
        .context,
    ).toEqual(["Created by you"]);
  });
});

describe("expense entries", () => {
  it("say who added, deleted or restored what, for how much, paid by whom", () => {
    const added = describeForPat(
      entry(
        { type: "expense_created", expense: groceries },
        { entity: activeExpense },
      ),
    );
    expect(added).toEqual({
      category: "expenses",
      categoryLabel: "Expense",
      title: "Olive added an expense",
      summary: "Groceries — ₹1,250.00",
      context: ["Paid by Olive"],
      changes: [],
      link: {
        href: `/households/${HOUSEHOLD}/expenses/${EXPENSE}`,
        label: "View expense",
        accessibleLabel: "View expense: Groceries",
      },
      unavailable: false,
    });

    const deleted = describeForPat(
      entry(
        { type: "expense_deleted", expense: { ...groceries, paidBy: PAT } },
        {
          actorId: PAT,
          entity: { available: true, id: EXPENSE, state: "deleted" },
        },
      ),
    );
    expect(deleted.title).toBe("You deleted an expense");
    expect(deleted.context).toEqual(["Paid by you"]);
    expect(deleted.link?.label).toBe("View deleted expense");
    expect(deleted.link?.accessibleLabel).toBe(
      "View deleted expense: Groceries",
    );

    expect(
      describeForPat(
        entry(
          { type: "expense_restored", expense: groceries },
          { entity: activeExpense },
        ),
      ).title,
    ).toBe("Olive restored an expense");
  });

  it("name people who have left, and never show an unknown person's id", () => {
    const d = describeForPat(
      entry(
        { type: "expense_created", expense: { ...groceries, paidBy: GONE } },
        { actorId: QUIN, entity: activeExpense },
      ),
    );
    expect(d.title).toBe("Quin (left) added an expense");
    expect(d.context).toEqual(["Paid by Former member"]);
    expect(
      describeForPat(entry({ type: "invitation_created" }, { actorId: null }))
        .title,
    ).toBe("Someone created an invite link");
  });

  it("link nowhere when the expense isn't in the household any more", () => {
    const d = describeForPat(
      entry(
        { type: "expense_created", expense: groceries },
        { entity: { available: false } },
      ),
    );
    expect(d.link).toBeNull();
    expect(d.unavailable).toBe(true);
  });
});

describe("expense edits (D6)", () => {
  it("list each field that changed, old and new", () => {
    const d = describeForPat(
      updated({
        description: "Groceries and milk",
        amountMinor: BigInt(130050),
        category: "household_supplies",
        expenseDate: "2026-11-13",
        paidBy: PAT,
        splitMethod: "percentage",
      }),
    );
    expect(d.title).toBe("Olive edited an expense");
    expect(d.summary).toBe("Groceries and milk — ₹1,300.50");
    expect(d.changes).toEqual([
      {
        kind: "value",
        label: "Description",
        from: "“Groceries”",
        to: "“Groceries and milk”",
      },
      { kind: "value", label: "Amount", from: "₹1,250.00", to: "₹1,300.50" },
      {
        kind: "value",
        label: "Category",
        from: "Groceries",
        to: "Household supplies",
      },
      { kind: "value", label: "Date", from: "12 Nov 2026", to: "13 Nov 2026" },
      { kind: "value", label: "Paid by", from: "Olive", to: "you" },
      { kind: "value", label: "Split", from: "Equally", to: "By percentage" },
    ]);
  });

  it("say who was added to or removed from the split, by name", () => {
    expect(
      describeForPat(updated({ participants: [OLIVE, PAT, QUIN, RAJ] }))
        .changes,
    ).toEqual([
      {
        kind: "text",
        label: "Who shares it",
        text: "added Quin (left) and Raj",
      },
    ]);
    expect(
      describeForPat(updated({ participants: [OLIVE, RAJ] }, true)).changes,
    ).toEqual([
      {
        kind: "text",
        label: "Who shares it",
        text: "added Raj; removed you",
      },
    ]);
  });

  it("mention changed shares only when nothing else explains them", () => {
    expect(describeForPat(updated({}, true)).changes).toEqual([
      { kind: "text", label: "Shares", text: "changed" },
    ]);
    expect(
      describeForPat(updated({ amountMinor: BigInt(200000) }, true)).changes,
    ).toEqual([
      { kind: "value", label: "Amount", from: "₹1,250.00", to: "₹2,000.00" },
    ]);
    expect(
      describeForPat(updated({ splitMethod: "custom" }, true)).changes,
    ).toEqual([
      {
        kind: "value",
        label: "Split",
        from: "Equally",
        to: "By custom amounts",
      },
    ]);
    expect(describeForPat(updated({}, false)).changes).toEqual([]);
  });
});

describe("payment entries (D9)", () => {
  const payment = {
    fromUser: OLIVE,
    toUser: PAT,
    amountMinor: BigInt(50000),
    settledOn: "2026-11-12",
    recordedBy: OLIVE,
  };

  it("use D9's wording, whichever of the two recorded it", () => {
    const byPayer = describeForPat(
      entry(
        { type: "settlement_recorded", settlement: payment },
        { entity: activePayment },
      ),
    );
    expect(byPayer).toMatchObject({
      category: "settlements",
      categoryLabel: "Payment",
      title: "Olive recorded a payment of ₹500.00 to you",
      summary: null,
      context: ["Paid on 12 Nov 2026"],
      link: {
        href: `/households/${HOUSEHOLD}/settlements/${SETTLEMENT}`,
        label: "View payment",
        accessibleLabel: "View payment: Payment from Olive to you, ₹500.00",
      },
    });

    const byRecipient = describeForPat(
      entry(
        {
          type: "settlement_recorded",
          settlement: { ...payment, recordedBy: PAT },
        },
        { actorId: PAT, entity: activePayment },
      ),
    );
    expect(byRecipient.title).toBe(
      "You recorded a payment of ₹500.00 from Olive",
    );
  });

  it("say a voided payment no longer counts, and link to it as voided", () => {
    const d = describeForPat(
      entry(
        { type: "settlement_voided", settlement: payment },
        {
          actorId: RAJ,
          entity: { available: true, id: SETTLEMENT, state: "voided" },
        },
      ),
    );
    expect(d).toMatchObject({
      title: "Raj voided a payment",
      summary: "Payment from Olive to you — ₹500.00",
      context: ["Paid on 12 Nov 2026", "It no longer counts towards balances"],
      link: { label: "View voided payment" },
    });
  });

  it("never claim money was sent, transferred or completed", () => {
    for (const type of ["settlement_recorded", "settlement_voided"] as const) {
      const text = texts(
        describeForPat(
          entry({ type, settlement: payment }, { entity: activePayment }),
        ),
      ).join(" ");
      expect(text).not.toMatch(/sent|transfer|complete|pending/i);
    }
  });
});

describe("bill entries (roadmap Phase 14)", () => {
  const BILL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const billEntity: JournalEntity = {
    available: true,
    id: BILL,
    state: "active",
  };
  const rent = {
    description: "Rent",
    amountMinor: BigInt(2000000),
    category: "rent" as const,
    payerId: OLIVE,
    frequency: "month" as const,
    every: 1,
    anchorOn: "2026-12-01",
    endsOn: null,
  };

  it("say who added a bill, what it is, how often, and link to it", () => {
    expect(
      describeForPat(
        entry({ type: "bill_created", bill: rent }, { entity: billEntity }),
      ),
    ).toEqual({
      category: "bills",
      categoryLabel: "Bill",
      title: "Olive added a bill",
      summary: "Rent — ₹20,000.00 expected",
      context: ["Every month, from 1 Dec 2026"],
      changes: [],
      link: {
        href: `/households/${HOUSEHOLD}/bills/${BILL}`,
        label: "View bill",
        accessibleLabel: "View bill: Rent",
      },
      unavailable: false,
    });
  });

  it("list what a change changed, old and new", () => {
    const d = describeForPat(
      entry(
        {
          type: "bill_updated",
          before: rent,
          after: {
            ...rent,
            amountMinor: BigInt(2100000),
            payerId: PAT,
            frequency: "week",
            every: 2,
            anchorOn: "2027-01-04",
            endsOn: "2027-12-31",
          },
        },
        { entity: billEntity },
      ),
    );
    expect(d.title).toBe("Olive changed a bill");
    expect(d.changes).toEqual([
      {
        kind: "value",
        label: "Expected amount",
        from: "₹20,000.00",
        to: "₹21,000.00",
      },
      { kind: "value", label: "Usually paid by", from: "Olive", to: "you" },
      {
        kind: "value",
        label: "Schedule",
        from: "Every month, from 1 Dec 2026",
        to: "Every 2 weeks, from 4 Jan 2027",
      },
      {
        kind: "value",
        label: "Last due date",
        from: "none",
        to: "31 Dec 2027",
      },
    ]);
  });

  it("say who paused, resumed, ended or skipped, never that anything was paid", () => {
    const title = (detail: JournalDetail) =>
      describeForPat(entry(detail, { entity: billEntity })).title;
    expect(title({ type: "bill_paused", description: "Rent" })).toBe(
      "Olive paused a bill",
    );
    expect(title({ type: "bill_resumed", description: "Rent" })).toBe(
      "Olive resumed a bill",
    );
    const ended = describeForPat(
      entry(
        { type: "bill_ended", description: "Rent", endsOn: "2026-11-13" },
        { entity: billEntity },
      ),
    );
    expect([ended.title, ended.context]).toEqual([
      "Olive ended a bill",
      ["Last due date 13 Nov 2026"],
    ]);
    const skipped = describeForPat(
      entry(
        { type: "bill_skipped", description: "Rent", dueOn: "2026-12-01" },
        { actorId: PAT, entity: billEntity },
      ),
    );
    expect(skipped).toMatchObject({
      title: "You skipped a bill period",
      summary: "Rent, due 1 Dec 2026",
      context: ["Nothing was recorded for it"],
    });
    expect(
      title({
        type: "bill_unskipped",
        description: "Rent",
        dueOn: "2026-12-01",
      }),
    ).toBe("Olive undid skipping a bill period");
    expect(
      describeForPat(
        entry(
          { type: "bill_paused", description: "Rent" },
          { entity: { available: false } },
        ),
      ),
    ).toMatchObject({ link: null, unavailable: true });
  });
});

describe("shopping and chore entries (roadmap Phase 15)", () => {
  const ITEM = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const CHORE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const milk = { name: "Milk", quantity: "1 litre", assigneeId: PAT };
  const bins = {
    title: "Take out the bins",
    assigneeId: QUIN,
    dueOn: "2026-11-14",
    priority: "high" as const,
  };
  const item = (state: "active" | "purchased" | "removed"): JournalEntity => ({
    available: true,
    id: ITEM,
    state,
  });
  const chore = (state: "active" | "completed" | "removed"): JournalEntity => ({
    available: true,
    id: CHORE,
    state,
  });

  it("say who added an item, for whom, and link to the list", () => {
    expect(
      describeForPat(
        entry(
          { type: "shopping_item_added", item: milk },
          { entity: item("active") },
        ),
      ),
    ).toEqual({
      category: "shopping",
      categoryLabel: "Shopping",
      title: "Olive added an item to the shopping list",
      summary: "Milk (1 litre)",
      context: ["For you to get"],
      changes: [],
      link: {
        href: `/households/${HOUSEHOLD}/shopping`,
        label: "View shopping list",
        accessibleLabel: "View shopping list",
      },
      unavailable: false,
    });
  });

  it("list an item's changes, and only flag a changed note", () => {
    const d = describeForPat(
      entry(
        {
          type: "shopping_item_updated",
          before: milk,
          after: { name: "Oat milk", quantity: null, assigneeId: null },
          noteChanged: true,
        },
        { entity: item("active") },
      ),
    );
    expect(d.changes).toEqual([
      { kind: "value", label: "Item", from: "“Milk”", to: "“Oat milk”" },
      { kind: "value", label: "Quantity", from: "1 litre", to: "none" },
      { kind: "value", label: "Getting it", from: "you", to: "nobody" },
      { kind: "text", label: "Note", text: "changed" },
    ]);
  });

  it("say an item was bought without calling it an expense", () => {
    const d = describeForPat(
      entry(
        { type: "shopping_item_purchased", name: "Milk", quantity: null },
        { actorId: PAT, entity: item("purchased") },
      ),
    );
    expect(d).toMatchObject({
      title: "You bought an item on the shopping list",
      summary: "Milk",
      context: ["Not recorded as an expense"],
    });
    // A removed item isn't on the list any more: nothing to link to.
    expect(
      describeForPat(
        entry(
          { type: "shopping_item_removed", name: "Milk", quantity: null },
          { entity: item("removed") },
        ),
      ),
    ).toMatchObject({
      title: "Olive removed an item from the shopping list",
      link: null,
      unavailable: false,
    });
  });

  it("say who added a chore, for whom, when and how urgent", () => {
    const d = describeForPat(
      entry(
        { type: "chore_created", chore: bins },
        { entity: chore("active") },
      ),
    );
    expect(d).toMatchObject({
      category: "chores",
      categoryLabel: "Chore",
      title: "Olive added a chore",
      summary: "Take out the bins",
      context: ["Assigned to Quin (left)", "Due 14 Nov 2026", "High priority"],
      link: { href: `/households/${HOUSEHOLD}/chores`, label: "View chores" },
    });
    expect(
      describeForPat(
        entry(
          {
            type: "chore_created",
            chore: {
              ...bins,
              assigneeId: null,
              dueOn: null,
              priority: "medium",
            },
          },
          { entity: chore("active") },
        ),
      ).context,
    ).toEqual(["Assigned to nobody"]);
  });

  it("list a chore's changes, including a reassignment", () => {
    const d = describeForPat(
      entry(
        {
          type: "chore_updated",
          before: bins,
          after: { ...bins, assigneeId: PAT, dueOn: null, priority: "low" },
          descriptionChanged: true,
        },
        { entity: chore("active") },
      ),
    );
    expect(d.title).toBe("Olive changed a chore");
    expect(d.changes).toEqual([
      { kind: "value", label: "Assigned to", from: "Quin (left)", to: "you" },
      { kind: "value", label: "Due date", from: "14 Nov 2026", to: "none" },
      { kind: "value", label: "Priority", from: "High", to: "Low" },
      { kind: "text", label: "Details", text: "changed" },
    ]);
  });

  it("say who completed, reopened or removed a chore", () => {
    const title = (
      type: "chore_completed" | "chore_reopened" | "chore_removed",
    ) =>
      describeForPat(
        entry(
          { type, title: "Take out the bins" },
          { entity: chore("completed") },
        ),
      ).title;
    expect(title("chore_completed")).toBe("Olive completed a chore");
    expect(title("chore_reopened")).toBe("Olive reopened a chore");
    expect(title("chore_removed")).toBe("Olive removed a chore");
  });
});

describe("every entry", () => {
  const all: JournalEntry[] = [
    entry(
      {
        type: "shopping_item_updated",
        before: { name: "Milk", quantity: null, assigneeId: GONE },
        after: { name: "Milk", quantity: null, assigneeId: null },
        noteChanged: false,
      },
      { actorId: GONE, entity: { available: false } },
    ),
    entry(
      {
        type: "chore_updated",
        before: {
          title: "Bins",
          assigneeId: GONE,
          dueOn: null,
          priority: "low",
        },
        after: {
          title: "Bins",
          assigneeId: OLIVE,
          dueOn: null,
          priority: "low",
        },
        descriptionChanged: false,
      },
      { actorId: GONE, entity: { available: false } },
    ),
    entry(
      {
        type: "bill_updated",
        before: {
          description: "Rent",
          amountMinor: BigInt(1),
          category: "rent",
          payerId: GONE,
          frequency: "year",
          every: 1,
          anchorOn: "2026-12-01",
          endsOn: null,
        },
        after: {
          description: "Rent",
          amountMinor: BigInt(2),
          category: "rent",
          payerId: GONE,
          frequency: "year",
          every: 1,
          anchorOn: "2026-12-01",
          endsOn: null,
        },
      },
      { actorId: GONE, entity: { available: false } },
    ),
    entry(
      { type: "bill_skipped", description: "Rent", dueOn: "2026-12-01" },
      {
        actorId: GONE,
        entity: { available: true, id: EXPENSE, state: "paused" },
      },
    ),
    entry({ type: "household_created", name: "Flat 4B" }),
    entry({ type: "member_joined", userId: GONE, inviterId: GONE }),
    entry({ type: "member_left", userId: GONE }),
    entry({ type: "member_removed", userId: GONE }),
    entry({ type: "ownership_transferred", fromUserId: GONE, toUserId: GONE }),
    entry({ type: "invitation_created" }, { actorId: GONE }),
    entry({ type: "invitation_revoked", createdBy: GONE }),
    entry(
      { type: "expense_created", expense: { ...groceries, paidBy: GONE } },
      { entity: activeExpense },
    ),
    updated({ paidBy: GONE, participants: [GONE, OLIVE] }, true),
    entry(
      { type: "expense_deleted", expense: groceries },
      { entity: { available: false } },
    ),
    entry(
      { type: "expense_restored", expense: groceries },
      { entity: activeExpense },
    ),
    entry(
      {
        type: "settlement_recorded",
        settlement: {
          fromUser: GONE,
          toUser: OLIVE,
          amountMinor: BigInt(1),
          settledOn: "2026-11-12",
          recordedBy: GONE,
        },
      },
      { entity: activePayment },
    ),
    entry(
      {
        type: "settlement_voided",
        settlement: {
          fromUser: OLIVE,
          toUser: GONE,
          amountMinor: BigInt(1),
          settledOn: "2026-11-12",
          recordedBy: OLIVE,
        },
      },
      { entity: { available: false } },
    ),
  ];

  it("shows no ids in its words, even for people the page doesn't know", () => {
    for (const e of all) {
      const d = describeForPat(e);
      expect(d.title).not.toBe("");
      for (const text of texts(d)) {
        expect(text, `${e.detail.type}: ${text}`).not.toMatch(UUID);
      }
    }
  });

  it("links only inside this household", () => {
    for (const e of all) {
      const href = describeForPat(e).link?.href;
      if (href) expect(href.startsWith(`/households/${HOUSEHOLD}`)).toBe(true);
    }
  });

  it("gives each link an accessible name that starts with its visible words", () => {
    for (const e of all) {
      const link = describeForPat(e).link;
      if (link) expect(link.accessibleLabel.startsWith(link.label)).toBe(true);
    }
  });
});
