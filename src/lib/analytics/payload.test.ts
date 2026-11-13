import { describe, expect, it } from "vitest";
import { checkAnalytics, parseAnalytics } from "./payload";

const OLIVE = "11111111-1111-4111-8111-111111111111";
const PAT = "22222222-2222-4222-8222-222222222222";
const E1 = "e0000000-0000-4000-8000-000000000001";
const E2 = "e0000000-0000-4000-8000-000000000002";

// 1–13 Nov 2026 (weeks): Olive paid 3000 for groceries split 1500/1500, and
// Pat paid 1000 for dining, all his.
function payload(over: Record<string, unknown> = {}) {
  return {
    from: "2026-11-01",
    to: "2026-11-13",
    previous_from: "2026-10-01",
    previous_to: "2026-10-13",
    bucket: "day",
    total_minor: "4000",
    expense_count: 2,
    previous_total_minor: "0",
    previous_count: 0,
    by_category: [
      { category: "groceries", total_minor: "3000", expense_count: 1 },
      { category: "dining", total_minor: "1000", expense_count: 1 },
    ],
    trend: Array.from({ length: 13 }, (_, i) => ({
      start: `2026-11-${String(i + 1).padStart(2, "0")}`,
      total_minor: i === 1 ? "3000" : i === 4 ? "1000" : "0",
      expense_count: i === 1 || i === 4 ? 1 : 0,
    })),
    members: [
      {
        user_id: OLIVE,
        paid_minor: "3000",
        paid_count: 1,
        share_minor: "1500",
      },
      { user_id: PAT, paid_minor: "1000", paid_count: 1, share_minor: "2500" },
    ],
    largest: [
      {
        expense_id: E1,
        description: "Groceries",
        amount_minor: "3000",
        category: "groceries",
        expense_date: "2026-11-02",
        paid_by: OLIVE,
      },
      {
        expense_id: E2,
        description: "Dinner",
        amount_minor: "1000",
        category: "dining",
        expense_date: "2026-11-05",
        paid_by: PAT,
      },
    ],
    people: [
      { user_id: OLIVE, display_name: "Olive", is_active: true },
      { user_id: PAT, display_name: "Pat", is_active: true },
    ],
    ...over,
  };
}

const asked: Parameters<typeof checkAnalytics>[1] = {
  from: "2026-11-01",
  to: "2026-11-13",
  compareFrom: "2026-10-01",
  compareTo: "2026-10-13",
  category: null,
  payer: null,
};
const check = (p: unknown, a = asked) => checkAnalytics(parseAnalytics(p)!, a);

describe("parseAnalytics", () => {
  it("reads money as BigInt and refuses anything unexpected", () => {
    const data = parseAnalytics(payload());
    expect(data?.members[1]).toEqual({
      userId: PAT,
      paidMinor: BigInt(1000),
      paidCount: 1,
      shareMinor: BigInt(2500),
    });
    expect(parseAnalytics(payload({ total_minor: "40.00" }))).toBeNull();
    expect(parseAnalytics(payload({ bucket: "year" }))).toBeNull();
    expect(parseAnalytics(payload({ notes: [] }))).toBeNull();
  });
});

describe("checkAnalytics", () => {
  it("accepts figures that add up", () => {
    expect(check(payload())).toEqual({ ok: true });
  });

  it("refuses parts that don't add up to the total", () => {
    expect(check(payload({ total_minor: "4001" }))).toMatchObject({
      ok: false,
    });
    expect(
      check(
        payload({
          by_category: [
            { category: "groceries", total_minor: "4000", expense_count: 1 },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "category_mismatch" });
    // Shares that don't add up to the total (someone's share counted twice).
    expect(
      check(
        payload({
          members: [
            {
              user_id: OLIVE,
              paid_minor: "3000",
              paid_count: 1,
              share_minor: "3000",
            },
            {
              user_id: PAT,
              paid_minor: "1000",
              paid_count: 1,
              share_minor: "2500",
            },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "member_mismatch" });
  });

  it("refuses gaps in the trend, the wrong range, and largest expenses out of order", () => {
    const trend = payload().trend.filter((_, i) => i !== 6);
    expect(check(payload({ trend }))).toEqual({
      ok: false,
      code: "trend_mismatch",
    });
    expect(check(payload({ trend: payload().trend.slice(0, 12) }))).toEqual({
      ok: false,
      code: "trend_mismatch",
    });
    expect(check(payload(), { ...asked, from: "2026-11-02" })).toEqual({
      ok: false,
      code: "range_mismatch",
    });
    expect(check(payload({ previous_to: "2026-11-01" }))).toEqual({
      ok: false,
      code: "range_mismatch",
    });
    const largest = [...payload().largest].reverse();
    expect(check(payload({ largest }))).toEqual({
      ok: false,
      code: "largest_mismatch",
    });
  });

  it("refuses rows a filter should have left out", () => {
    expect(check(payload(), { ...asked, category: "groceries" })).toEqual({
      ok: false,
      code: "category_mismatch",
    });
    expect(check(payload(), { ...asked, payer: PAT })).toMatchObject({
      ok: false,
    });
  });

  it("accepts an empty range", () => {
    expect(
      check(
        payload({
          total_minor: "0",
          expense_count: 0,
          by_category: [],
          trend: payload().trend.map((t) => ({
            ...t,
            total_minor: "0",
            expense_count: 0,
          })),
          members: [],
          largest: [],
        }),
      ),
    ).toEqual({ ok: true });
  });
});
