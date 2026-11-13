import { describe, expect, it } from "vitest";
import {
  checkBillDetail,
  checkHouseholdBills,
  parseBillDetail,
  parseHouseholdBills,
} from "./payload";

const HOUSEHOLD = "6f1c2f4e-8a7b-4c3d-9e2f-1a2b3c4d5e6f";
const OTHER = "7a2d3e5f-9b8c-4d4e-8f3a-2b3c4d5e6f7a";
const OLIVE = "11111111-1111-4111-8111-111111111111";
const BILL = "aa000000-0000-4000-8000-000000000001";
const EXPENSE = "ff000000-0000-4000-8000-000000000009";

const rawBill = {
  bill_id: BILL,
  household_id: HOUSEHOLD,
  description: "Rent",
  amount_minor: "2000000",
  category: "rent",
  payer_id: OLIVE,
  frequency: "month",
  interval_count: 1,
  ends_on: null,
  paused: false,
  created_by: OLIVE,
  next_due_on: "2026-12-01",
};

const householdPayload = {
  today: "2026-11-13",
  bills: [rawBill],
  open: [
    {
      bill_id: BILL,
      due_on: "2026-10-01",
      expected_amount_minor: "1900000",
      stored: true,
    },
    {
      bill_id: BILL,
      due_on: "2026-11-01",
      expected_amount_minor: "2000000",
      stored: false,
    },
  ],
  paid_recently: [
    {
      bill_id: BILL,
      due_on: "2026-09-01",
      expense_id: EXPENSE,
      amount_minor: "1900000",
      expense_date: "2026-10-20",
      paid_by: OLIVE,
    },
  ],
  people: [{ user_id: OLIVE, display_name: "Olive", is_active: true }],
};

const period = (change: Record<string, unknown>) => ({
  due_on: "2026-11-01",
  stored: true,
  expected_amount_minor: "2000000",
  status: "open",
  expense: null,
  deleted_expense_count: 0,
  skipped_at: null,
  skipped_by: null,
  ...change,
});

const detailPayload = {
  today: "2026-11-13",
  bill: {
    ...rawBill,
    notes: null,
    split_method: "equal",
    anchor_on: "2026-09-01",
    paused_at: null,
    paused_by: null,
    created_at: "2026-09-01T10:00:00+00:00",
    updated_at: "2026-09-01T10:00:00+00:00",
    cursor_due_on: "2026-11-01",
    latest_stored_due_on: "2026-10-01",
  },
  shares: [{ user_id: OLIVE, percentage_bp: null, share_minor: null }],
  periods: [
    period({ due_on: "2026-12-01", stored: false, status: "upcoming" }),
    period({ due_on: "2026-11-01", stored: false }),
    period({
      due_on: "2026-10-01",
      status: "skipped",
      skipped_at: "2026-10-02T00:00:00+00:00",
      skipped_by: OLIVE,
    }),
    period({
      due_on: "2026-09-01",
      status: "recorded",
      expense: {
        expense_id: EXPENSE,
        amount_minor: "1900000",
        expense_date: "2026-09-03",
        paid_by: OLIVE,
      },
    }),
  ],
  stored_count: 2,
  people: [{ user_id: OLIVE, display_name: "Olive", is_active: true }],
};

describe("parseHouseholdBills", () => {
  it("reads bills and periods with money as BigInt", () => {
    const data = parseHouseholdBills(householdPayload);
    expect(data?.bills[0]).toMatchObject({
      id: BILL,
      amountMinor: BigInt(2000000),
      frequency: "month",
      every: 1,
      nextDueOn: "2026-12-01",
    });
    expect(data?.open[0]).toEqual({
      billId: BILL,
      dueOn: "2026-10-01",
      expectedMinor: BigInt(1900000),
      stored: true,
    });
    expect(data && checkHouseholdBills(data, HOUSEHOLD)).toEqual({ ok: true });
  });

  it("refuses unexpected fields and impossible values", () => {
    expect(
      parseHouseholdBills({
        ...householdPayload,
        bills: [{ ...rawBill, notes: "x" }],
      }),
    ).toBeNull();
    expect(
      parseHouseholdBills({
        ...householdPayload,
        bills: [{ ...rawBill, amount_minor: "0" }],
      }),
    ).toBeNull();
    expect(
      parseHouseholdBills({
        ...householdPayload,
        bills: [{ ...rawBill, interval_count: 53 }],
      }),
    ).toBeNull();
    expect(parseHouseholdBills({ ...householdPayload, extra: 1 })).toBeNull();
  });
});

describe("checkHouseholdBills", () => {
  const check = (
    change: Partial<typeof householdPayload>,
    household = HOUSEHOLD,
  ) =>
    checkHouseholdBills(
      parseHouseholdBills({ ...householdPayload, ...change })!,
      household,
    );

  it("refuses another household's bill, unknown or repeated periods, and wrong dates", () => {
    expect(check({}, OTHER)).toEqual({ ok: false, code: "foreign_bill" });
    expect(
      check({ open: [{ ...householdPayload.open[0], bill_id: EXPENSE }] }),
    ).toEqual({ ok: false, code: "unknown_bill" });
    expect(
      check({ open: [householdPayload.open[0], householdPayload.open[0]] }),
    ).toEqual({ ok: false, code: "duplicate_period" });
    expect(check({ open: [...householdPayload.open].reverse() })).toEqual({
      ok: false,
      code: "order_mismatch",
    });
    // A period worked out from the schedule is open only once it has come.
    expect(
      check({
        open: [{ ...householdPayload.open[1], due_on: "2026-11-20" }],
      }),
    ).toEqual({ ok: false, code: "period_mismatch" });
    expect(
      check({ bills: [{ ...rawBill, next_due_on: "2026-11-13" }] }),
    ).toEqual({ ok: false, code: "period_mismatch" });
    expect(check({ bills: [{ ...rawBill, paused: true }] })).toEqual({
      ok: false,
      code: "period_mismatch",
    });
  });
});

describe("parseBillDetail and checkBillDetail", () => {
  it("reads a bill's periods, newest first, each in a state that fits", () => {
    const detail = parseBillDetail(detailPayload);
    expect(detail?.periods.map((p) => p.status)).toEqual([
      "upcoming",
      "open",
      "skipped",
      "recorded",
    ]);
    expect(detail?.periods[3].expense?.amountMinor).toBe(BigInt(1900000));
    expect(detail && checkBillDetail(detail, HOUSEHOLD)).toEqual({ ok: true });
  });

  it("refuses periods out of order, repeated, or in a state that doesn't fit", () => {
    const check = (periods: unknown[]) =>
      checkBillDetail(
        parseBillDetail({ ...detailPayload, periods })!,
        HOUSEHOLD,
      );
    const [upcoming, open, skipped, recorded] = detailPayload.periods;
    expect(check([open, upcoming])).toEqual({
      ok: false,
      code: "order_mismatch",
    });
    expect(check([open, open])).toEqual({
      ok: false,
      code: "duplicate_period",
    });
    for (const bad of [
      { ...recorded, expense: null },
      { ...open, expense: recorded.expense },
      { ...skipped, skipped_at: null },
      { ...upcoming, due_on: "2026-11-13" },
      { ...open, due_on: "2026-11-14" },
      { ...recorded, stored: false },
    ]) {
      expect(check([bad]), JSON.stringify(bad)).toEqual({
        ok: false,
        code: "period_mismatch",
      });
    }
    expect(checkBillDetail(parseBillDetail(detailPayload)!, OTHER)).toEqual({
      ok: false,
      code: "foreign_bill",
    });
  });
});
