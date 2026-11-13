import { describe, expect, it } from "vitest";
import {
  billBoard,
  billState,
  boardCounts,
  canManageBill,
  periodBadge,
  personName,
  splitDefaults,
} from "./board";
import type {
  BillDetail,
  BillPeriod,
  BillSummary,
  HouseholdBills,
} from "./payload";

const HOUSEHOLD = "6f1c2f4e-8a7b-4c3d-9e2f-1a2b3c4d5e6f";
const OLIVE = "11111111-1111-4111-8111-111111111111";
const PAT = "22222222-2222-4222-8222-222222222222";
const QUIN = "33333333-3333-4333-8333-333333333333";
const TODAY = "2026-11-13";

function bill(id: string, change: Partial<BillSummary> = {}): BillSummary {
  return {
    id,
    householdId: HOUSEHOLD,
    description: `Bill ${id.slice(0, 2)}`,
    amountMinor: BigInt(100000),
    category: "utilities",
    payerId: OLIVE,
    frequency: "month",
    every: 1,
    endsOn: null,
    paused: false,
    createdBy: OLIVE,
    nextDueOn: "2026-12-01",
    ...change,
  };
}

const RENT = "aa000000-0000-4000-8000-000000000001";
const POWER = "bb000000-0000-4000-8000-000000000002";
const WIFI = "cc000000-0000-4000-8000-000000000003";
const GYM = "dd000000-0000-4000-8000-000000000004";
const OLD = "ee000000-0000-4000-8000-000000000005";

const data: HouseholdBills = {
  today: TODAY,
  bills: [
    bill(RENT, { nextDueOn: "2026-12-01" }),
    bill(POWER, { nextDueOn: "2026-11-15" }),
    bill(WIFI, { nextDueOn: "2026-11-20" }),
    bill(GYM, { paused: true, nextDueOn: null }),
    bill(OLD, { nextDueOn: null, endsOn: "2026-10-01" }),
  ],
  open: [
    {
      billId: RENT,
      dueOn: "2026-10-01",
      expectedMinor: BigInt(90000),
      stored: true,
    },
    {
      billId: GYM,
      dueOn: "2026-11-01",
      expectedMinor: BigInt(5000),
      stored: true,
    },
    {
      billId: POWER,
      dueOn: TODAY,
      expectedMinor: BigInt(100000),
      stored: false,
    },
  ],
  paidRecently: [
    {
      billId: RENT,
      dueOn: "2026-11-01",
      expenseId: "ff000000-0000-4000-8000-000000000009",
      amountMinor: BigInt(100500),
      expenseDate: "2026-11-02",
      paidBy: PAT,
    },
  ],
  people: [
    { userId: OLIVE, displayName: "Olive", isActive: true },
    { userId: PAT, displayName: "Pat", isActive: true },
    { userId: QUIN, displayName: "Quin", isActive: false },
  ],
};

describe("billBoard", () => {
  const board = billBoard(data);
  const ids = (items: { bill: BillSummary; dueOn: string }[]) =>
    items.map((i) => `${i.bill.id.slice(0, 2)} ${i.dueOn}`);

  it("puts open periods and each bill's next one where they belong, by date", () => {
    expect(ids(board.overdue)).toEqual(["aa 2026-10-01", "dd 2026-11-01"]);
    expect(ids(board.dueToday)).toEqual(["bb 2026-11-13"]);
    expect(ids(board.dueSoon)).toEqual(["bb 2026-11-15", "cc 2026-11-20"]);
    expect(ids(board.upcoming)).toEqual(["aa 2026-12-01"]);
    expect(board.overdue[0]).toMatchObject({
      expectedMinor: BigInt(90000),
      kind: "overdue",
      label: "43 days overdue",
    });
    expect(board.dueSoon[0].label).toBe("Due in 2 days");
    expect(board.upcoming[0].expectedMinor).toBe(BigInt(100000));
  });

  it("lists paused and ended bills, and what was paid recently", () => {
    expect(board.paused.map((b) => b.id)).toEqual([GYM]);
    expect(board.ended.map((b) => b.id)).toEqual([OLD]);
    expect(board.paidRecently).toHaveLength(1);
    expect(board.paidRecently[0].bill.id).toBe(RENT);
    expect(boardCounts(board)).toEqual({ overdue: 2, dueToday: 1, dueSoon: 2 });
  });

  it("is empty for a household without bills", () => {
    const empty = billBoard({ ...data, bills: [], open: [], paidRecently: [] });
    expect(boardCounts(empty)).toEqual({ overdue: 0, dueToday: 0, dueSoon: 0 });
    expect(empty.upcoming).toEqual([]);
  });
});

describe("billState", () => {
  it("is paused, ended (nothing left on the schedule) or active", () => {
    expect(billState({ paused: true, nextDueOn: null })).toBe("paused");
    expect(billState({ paused: false, nextDueOn: null })).toBe("ended");
    expect(billState({ paused: false, nextDueOn: "2026-12-01" })).toBe(
      "active",
    );
  });
});

describe("periodBadge", () => {
  const period = (change: Partial<BillPeriod>): BillPeriod => ({
    dueOn: "2026-11-01",
    stored: true,
    expectedMinor: BigInt(1000),
    status: "open",
    expense: null,
    deletedExpenseCount: 0,
    skippedAt: null,
    skippedBy: null,
    ...change,
  });
  const expense = (expenseDate: string) => ({
    id: "ff000000-0000-4000-8000-000000000009",
    amountMinor: BigInt(1000),
    expenseDate,
    paidBy: OLIVE,
  });

  it("says paid on time or late from the expense's date, never from the due date alone", () => {
    expect(
      periodBadge(
        period({ status: "recorded", expense: expense("2026-11-01") }),
        TODAY,
      ),
    ).toEqual({ status: "success", label: "Paid on time", actionable: false });
    expect(
      periodBadge(
        period({ status: "recorded", expense: expense("2026-10-28") }),
        TODAY,
      ).label,
    ).toBe("Paid on time");
    expect(
      periodBadge(
        period({ status: "recorded", expense: expense("2026-11-05") }),
        TODAY,
      ).label,
    ).toBe("Paid late");
  });

  it("marks open periods as overdue or due today, and only open or upcoming ones as actionable", () => {
    expect(periodBadge(period({}), TODAY)).toEqual({
      status: "danger",
      label: "Overdue",
      actionable: true,
    });
    expect(periodBadge(period({ dueOn: TODAY }), TODAY).label).toBe(
      "Due today",
    );
    expect(
      periodBadge(period({ status: "upcoming", dueOn: "2026-12-01" }), TODAY),
    ).toEqual({ status: "neutral", label: "Upcoming", actionable: true });
    expect(
      periodBadge(
        period({ status: "skipped", skippedAt: "x", skippedBy: OLIVE }),
        TODAY,
      ),
    ).toEqual({ status: "neutral", label: "Skipped", actionable: false });
  });
});

describe("canManageBill (D27, proposed)", () => {
  const b = bill(RENT, { createdBy: OLIVE, payerId: PAT });
  it("allows who added it, who usually pays and the owner, and nobody else", () => {
    expect(canManageBill(b, { userId: OLIVE, isOwner: false })).toBe(true);
    expect(canManageBill(b, { userId: PAT, isOwner: false })).toBe(true);
    expect(canManageBill(b, { userId: QUIN, isOwner: true })).toBe(true);
    expect(canManageBill(b, { userId: QUIN, isOwner: false })).toBe(false);
  });
});

describe("splitDefaults", () => {
  const detail = (
    splitMethod: "equal" | "percentage" | "custom",
    shares: BillDetail["shares"],
  ) =>
    ({
      bill: { splitMethod } as BillDetail["bill"],
      shares,
    }) as Pick<BillDetail, "bill" | "shares">;

  it("pre-fills percentages and amounts as typed, leaving out people who have left", () => {
    expect(
      splitDefaults(
        detail("percentage", [
          { userId: OLIVE, percentageBp: 6000, shareMinor: null },
          { userId: PAT, percentageBp: 2500, shareMinor: null },
          { userId: QUIN, percentageBp: 1500, shareMinor: null },
        ]),
        [OLIVE, PAT],
        2,
      ),
    ).toEqual({
      splitMethod: "percentage",
      participants: [OLIVE, PAT],
      shares: {},
      percents: { [OLIVE]: "60", [PAT]: "25", [QUIN]: "15" },
    });
    expect(
      splitDefaults(
        detail("custom", [
          { userId: OLIVE, percentageBp: null, shareMinor: BigInt(150050) },
          { userId: PAT, percentageBp: null, shareMinor: BigInt(0) },
        ]),
        [OLIVE, PAT],
        2,
      ).shares,
    ).toEqual({ [OLIVE]: "1500.50", [PAT]: "0.00" });
  });
});

describe("personName", () => {
  it("says you, the name, (left) or Former member", () => {
    expect(personName(data.people, OLIVE, OLIVE)).toBe("you");
    expect(personName(data.people, PAT, OLIVE)).toBe("Pat");
    expect(personName(data.people, QUIN, OLIVE)).toBe("Quin (left)");
    expect(
      personName(data.people, "99999999-9999-4999-8999-999999999999", OLIVE),
    ).toBe("Former member");
  });
});
