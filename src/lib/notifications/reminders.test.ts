import { describe, expect, it } from "vitest";
import type { HouseholdBills } from "@/lib/bills/payload";
import type { HouseholdBudgets } from "@/lib/budgets/payload";
import type { Chore } from "@/lib/chores/board";
import { householdReminders } from "./reminders";

const H = "6f1c2f4e-8a7b-4c3d-9e2f-1a2b3c4d5e6f";
const OLIVE = "11111111-1111-4111-8111-111111111111";
const PAT = "22222222-2222-4222-8222-222222222222";
const BILL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TODAY = "2026-11-13";

const bills: HouseholdBills = {
  today: TODAY,
  bills: [
    {
      id: BILL,
      householdId: H,
      description: "Electricity",
      amountMinor: BigInt(200000),
      category: "utilities",
      payerId: OLIVE,
      frequency: "month",
      every: 1,
      endsOn: null,
      paused: false,
      createdBy: OLIVE,
      nextDueOn: "2026-12-10",
    },
  ],
  open: [
    {
      billId: BILL,
      dueOn: "2026-11-10",
      expectedMinor: BigInt(200000),
      stored: false,
    },
    // Stored early for next month: not due yet, so not a reminder.
    {
      billId: BILL,
      dueOn: "2026-12-10",
      expectedMinor: BigInt(200000),
      stored: true,
    },
  ],
  paidRecently: [],
  people: [],
};

function chore(n: number, over: Partial<Chore>): Chore {
  return {
    id: `c0000000-0000-4000-8000-00000000000${n}`,
    householdId: H,
    title: `Chore ${n}`,
    description: null,
    assigneeId: null,
    dueOn: TODAY,
    priority: "medium",
    createdBy: PAT,
    completedAt: null,
    completedBy: null,
    createdAt: "2026-11-01T10:00:00+00:00",
    updatedAt: "2026-11-01T10:00:00+00:00",
    ...over,
  };
}

const month: HouseholdBudgets = {
  today: TODAY,
  period: "month",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  totalSpentMinor: BigInt(900000),
  totalCount: 3,
  activeCounts: { week: 0, month: 3, quarter: 0 },
  budgets: [
    {
      id: "b0000000-0000-4000-8000-000000000001",
      householdId: H,
      category: null,
      period: "month",
      startsOn: "2026-11-01",
      archived: false,
      updatedAt: "",
      limitMinor: BigInt(800000),
      spentMinor: BigInt(900000),
      expenseCount: 3,
    },
    {
      id: "b0000000-0000-4000-8000-000000000002",
      householdId: H,
      category: "groceries",
      period: "month",
      startsOn: "2026-11-01",
      archived: false,
      updatedAt: "",
      limitMinor: BigInt(500000),
      spentMinor: BigInt(400000),
      expenseCount: 2,
    },
    {
      id: "b0000000-0000-4000-8000-000000000003",
      householdId: H,
      category: "dining",
      period: "month",
      startsOn: "2026-11-01",
      archived: false,
      updatedAt: "",
      limitMinor: BigInt(500000),
      spentMinor: BigInt(100000),
      expenseCount: 1,
    },
  ],
};

describe("householdReminders", () => {
  const reminders = householdReminders(
    {
      household: { id: H, name: "Home", currencyCode: "INR" },
      today: TODAY,
      bills,
      chores: [
        chore(1, { assigneeId: OLIVE, dueOn: "2026-11-11" }), // mine, overdue
        chore(2, {}), // nobody's, due today
        chore(3, { assigneeId: PAT }), // someone else's
        chore(4, { assigneeId: OLIVE, dueOn: "2026-11-14" }), // not due yet
        chore(5, { assigneeId: OLIVE, dueOn: null }), // any time
        chore(6, { assigneeId: OLIVE, completedAt: "2026-11-12T10:00:00Z" }), // done
      ],
      budgets: [month],
    },
    OLIVE,
  );

  it("lists what's due or overdue, and budgets near or over, most urgent first", () => {
    expect(reminders.map((r) => [r.kind, r.label, r.title])).toEqual([
      ["bill", "Overdue", "Electricity"],
      ["budget", "Over budget", "Monthly budget for everything"],
      ["chore", "Overdue", "Chore 1"],
      ["budget", "Near limit", "Monthly budget for groceries"],
      ["chore", "Due today", "Chore 2"],
    ]);
  });

  it("says why in words and links to the page that deals with it", () => {
    const byTitle = new Map(reminders.map((r) => [r.title, r]));
    expect(byTitle.get("Electricity")).toMatchObject({
      tone: "danger",
      detail: "3 days overdue · ₹2,000.00 expected",
      href: `/households/${H}/bills/${BILL}`,
    });
    expect(byTitle.get("Monthly budget for everything")?.detail).toBe(
      "₹1,000.00 over the limit of ₹8,000.00",
    );
    expect(byTitle.get("Monthly budget for groceries")?.detail).toBe(
      "80% used · ₹1,000.00 left",
    );
    expect(byTitle.get("Chore 2")).toMatchObject({
      tone: "warning",
      detail: "Due today · assigned to nobody",
      href: `/households/${H}/chores`,
    });
  });

  it("is empty when there's nothing, and when data couldn't be read", () => {
    expect(
      householdReminders(
        {
          household: { id: H, name: "Home", currencyCode: "INR" },
          today: TODAY,
          bills: null,
          chores: null,
          budgets: [],
        },
        OLIVE,
      ),
    ).toEqual([]);
  });
});
