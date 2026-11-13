import { describe, expect, it } from "vitest";
import { checkHouseholdBudgets, parseHouseholdBudgets } from "./payload";

const HOUSEHOLD = "6f1c2f4e-8a7b-4c3d-9e2f-1a2b3c4d5e6f";
const OTHER = "7a2d3e5f-9b8c-4d4e-8f3a-2b3c4d5e6f7a";
const A = "a0000000-0000-4000-8000-000000000001";
const B = "a0000000-0000-4000-8000-000000000002";

function payload(budgets: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    today: "2026-11-13",
    period: "month",
    period_start: "2026-11-01",
    period_end: "2026-11-30",
    total_spent_minor: "900000",
    total_count: 6,
    active_counts: { week: 0, month: 2, quarter: 1 },
    budgets,
    ...overrides,
  };
}

const overall = {
  budget_id: A,
  household_id: HOUSEHOLD,
  category: null,
  period: "month",
  starts_on: "2026-10-01",
  archived: false,
  updated_at: "2026-11-01T10:00:00+00:00",
  limit_minor: "2500000",
  spent_minor: "900000",
  expense_count: 6,
};
const groceries = {
  ...overall,
  budget_id: B,
  category: "groceries",
  spent_minor: "400000",
  expense_count: 3,
};
const context: Parameters<typeof checkHouseholdBudgets>[1] = {
  householdId: HOUSEHOLD,
  period: "month",
  onDate: null,
};

describe("parseHouseholdBudgets", () => {
  it("reads money as BigInt", () => {
    const data = parseHouseholdBudgets(payload([overall, groceries]));
    expect(data?.budgets[1]).toMatchObject({
      category: "groceries",
      limitMinor: BigInt(2500000),
      spentMinor: BigInt(400000),
    });
    expect(data?.totalSpentMinor).toBe(BigInt(900000));
  });

  it("refuses extra fields, zero limits and unknown periods", () => {
    for (const bad of [
      payload([{ ...overall, note: "x" }]),
      payload([{ ...overall, limit_minor: "0" }]),
      payload([{ ...overall, spent_minor: "-1" }]),
      payload([{ ...overall, spent_minor: 900000 }]),
      payload([], { period: "year" }),
    ]) {
      expect(parseHouseholdBudgets(bad)).toBeNull();
    }
  });
});

describe("checkHouseholdBudgets", () => {
  const check = (p: unknown, c = context) =>
    checkHouseholdBudgets(parseHouseholdBudgets(p)!, c);

  it("accepts consistent figures", () => {
    expect(check(payload([overall, groceries]))).toEqual({ ok: true });
    expect(check(payload([]))).toEqual({ ok: true });
  });

  it("refuses another household's budget, a repeated category or the wrong period", () => {
    expect(check(payload([{ ...overall, household_id: OTHER }]))).toEqual({
      ok: false,
      code: "foreign_budget",
    });
    expect(check(payload([groceries, { ...groceries, budget_id: A }]))).toEqual(
      {
        ok: false,
        code: "duplicate_budget",
      },
    );
    expect(check(payload([{ ...overall, starts_on: "2026-12-01" }]))).toEqual({
      ok: false,
      code: "period_mismatch",
    });
    expect(check(payload([]), { ...context, period: "week" })).toEqual({
      ok: false,
      code: "period_mismatch",
    });
    expect(check(payload([], { period_end: "2026-11-29" }))).toEqual({
      ok: false,
      code: "period_mismatch",
    });
    expect(check(payload([]), { ...context, onDate: "2026-10-05" })).toEqual({
      ok: false,
      code: "period_mismatch",
    });
  });

  it("refuses spending that doesn't add up", () => {
    expect(check(payload([{ ...overall, spent_minor: "899999" }]))).toEqual({
      ok: false,
      code: "spending_mismatch",
    });
    expect(check(payload([{ ...groceries, spent_minor: "900001" }]))).toEqual({
      ok: false,
      code: "spending_mismatch",
    });
  });
});
