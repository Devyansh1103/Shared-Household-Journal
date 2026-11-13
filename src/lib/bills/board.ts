// The bills page's groups (roadmap Phase 14): what's overdue, due today, due
// soon or later, what was paid recently, and which bills are paused or have
// ended. Only from the household's real bills and periods, in its timezone
// (D11). Pure.
//
// This is the app's reminder for now: D12 brings in-app notifications in
// roadmap Phase 17, and nothing here sends anything.

import { formatBasisPoints } from "@/domain/money/amount";
import { minorToDecimalString } from "@/lib/format";
import type {
  BillDetail,
  BillPeriod,
  BillPerson,
  BillSummary,
  HouseholdBills,
  PaidPeriod,
} from "./payload";
import { dueKind, dueLabel, type DueKind } from "./schedule";

export type BillState = "active" | "paused" | "ended";

/** Paused; ended (no period left on the schedule); or active. */
export function billState(
  bill: Pick<BillSummary, "paused" | "nextDueOn">,
): BillState {
  if (bill.paused) return "paused";
  return bill.nextDueOn === null ? "ended" : "active";
}

export type BoardItem = {
  bill: BillSummary;
  dueOn: string;
  /** What this period is expected to cost. */
  expectedMinor: bigint;
  kind: DueKind;
  /** "Due today", "3 days overdue". */
  label: string;
};

export type Board = {
  overdue: BoardItem[];
  dueToday: BoardItem[];
  dueSoon: BoardItem[];
  upcoming: BoardItem[];
  paidRecently: (PaidPeriod & { bill: BillSummary })[];
  paused: BillSummary[];
  ended: BillSummary[];
};

const byDue = (a: BoardItem, b: BoardItem) =>
  a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0;

export function billBoard(data: HouseholdBills): Board {
  const bills = new Map(data.bills.map((b) => [b.id, b]));
  const board: Board = {
    overdue: [],
    dueToday: [],
    dueSoon: [],
    upcoming: [],
    paidRecently: [],
    paused: [],
    ended: [],
  };
  const place = (item: BoardItem) => {
    switch (item.kind) {
      case "overdue":
        board.overdue.push(item);
        break;
      case "today":
        board.dueToday.push(item);
        break;
      case "soon":
        board.dueSoon.push(item);
        break;
      case "later":
        board.upcoming.push(item);
        break;
    }
  };
  const item = (bill: BillSummary, dueOn: string, expectedMinor: bigint) => ({
    bill,
    dueOn,
    expectedMinor,
    kind: dueKind(dueOn, data.today),
    label: dueLabel(dueOn, data.today),
  });

  for (const period of data.open) {
    const bill = bills.get(period.billId);
    if (bill) place(item(bill, period.dueOn, period.expectedMinor));
  }
  for (const bill of data.bills) {
    if (bill.nextDueOn !== null) {
      place(item(bill, bill.nextDueOn, bill.amountMinor));
    }
    const state = billState(bill);
    if (state === "paused") board.paused.push(bill);
    if (state === "ended") board.ended.push(bill);
  }
  for (const paid of data.paidRecently) {
    const bill = bills.get(paid.billId);
    if (bill) board.paidRecently.push({ ...paid, bill });
  }
  board.overdue.sort(byDue);
  board.dueToday.sort(byDue);
  board.dueSoon.sort(byDue);
  board.upcoming.sort(byDue);
  return board;
}

/** How many periods need attention, for the Household page's reminder. */
export function boardCounts(board: Board): {
  overdue: number;
  dueToday: number;
  dueSoon: number;
} {
  return {
    overdue: board.overdue.length,
    dueToday: board.dueToday.length,
    dueSoon: board.dueSoon.length,
  };
}

export type PeriodBadge = {
  status: "danger" | "warning" | "info" | "neutral" | "success";
  label: string;
  /** It can be recorded (or skipped) now. */
  actionable: boolean;
};

/**
 * A period in words: "Upcoming", "Due today", "Overdue", "Paid on time",
 * "Paid late" (the expense is dated after the due date) or "Skipped".
 */
export function periodBadge(period: BillPeriod, today: string): PeriodBadge {
  switch (period.status) {
    case "recorded":
      return period.expense && period.expense.expenseDate > period.dueOn
        ? { status: "success", label: "Paid late", actionable: false }
        : { status: "success", label: "Paid on time", actionable: false };
    case "skipped":
      return { status: "neutral", label: "Skipped", actionable: false };
    case "upcoming":
      return { status: "neutral", label: "Upcoming", actionable: true };
    case "open":
      return period.dueOn === today
        ? { status: "warning", label: "Due today", actionable: true }
        : { status: "danger", label: "Overdue", actionable: true };
  }
}

/** D27 (proposed): who added it, who usually pays it, or the owner. */
export function canManageBill(
  bill: Pick<BillSummary, "createdBy" | "payerId">,
  viewer: { userId: string; isOwner: boolean },
): boolean {
  return (
    viewer.isOwner ||
    bill.createdBy === viewer.userId ||
    bill.payerId === viewer.userId
  );
}

/**
 * The bill's default split as the split fields' values: the people who are
 * still members, and their percentages or amounts as typed.
 */
export function splitDefaults(
  detail: Pick<BillDetail, "bill" | "shares">,
  activeIds: readonly string[],
  exponent: number,
): {
  splitMethod: string;
  participants: string[];
  shares: Record<string, string>;
  percents: Record<string, string>;
} {
  const active = new Set(activeIds);
  const shares: Record<string, string> = {};
  const percents: Record<string, string> = {};
  for (const share of detail.shares) {
    if (share.shareMinor !== null) {
      shares[share.userId] = minorToDecimalString(share.shareMinor, exponent);
    }
    if (share.percentageBp !== null) {
      percents[share.userId] = formatBasisPoints(share.percentageBp);
    }
  }
  return {
    splitMethod: detail.bill.splitMethod,
    participants: detail.shares
      .map((s) => s.userId)
      .filter((id) => active.has(id)),
    shares,
    percents,
  };
}

/** "Pat", "Pat (left)" (D13), "you", or "Former member". */
export function personName(
  people: readonly BillPerson[],
  userId: string,
  viewerId: string,
): string {
  if (userId === viewerId) return "you";
  const person = people.find((p) => p.userId === userId);
  if (!person) return "Former member";
  return person.isActive ? person.displayName : `${person.displayName} (left)`;
}
