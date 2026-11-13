import { describe, expect, it } from "vitest";
import { readBudgetForm, validateLimit, validateNewBudget } from "./form";

describe("validateNewBudget", () => {
  it("reads everything, or a category, with an exact limit", () => {
    expect(
      validateNewBudget(
        { category: "all", period: "month", limit: "25,000" },
        { exponent: 2 },
      ),
    ).toEqual({
      ok: true,
      value: { category: null, period: "month", limitMinor: BigInt(2500000) },
    });
    expect(
      validateNewBudget(
        { category: "groceries", period: "week", limit: "1999.99" },
        { exponent: 2 },
      ),
    ).toEqual({
      ok: true,
      value: {
        category: "groceries",
        period: "week",
        limitMinor: BigInt(199999),
      },
    });
  });

  it("refuses unknown categories and periods, and limits that aren't positive", () => {
    const result = validateNewBudget(
      { category: "pets", period: "year", limit: "-5" },
      { exponent: 2 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors).sort()).toEqual([
        "category",
        "limit",
        "period",
      ]);
    }
    for (const limit of ["", "0", "0.00", "12.345", "1e5", "abc"]) {
      expect(validateLimit(limit, 2).ok, limit).toBe(false);
    }
    expect(validateLimit("1000000000000", 0).ok).toBe(false); // too large
    expect(validateLimit("5000", 0)).toEqual({ ok: true, minor: BigInt(5000) });
    expect(validateLimit("5000.5", 0).ok).toBe(false); // no decimals in JPY-like currencies
  });

  it("reads only its own fields", () => {
    const data = new FormData();
    data.set("category", "rent");
    data.set("period", "quarter");
    data.set("limit", "10");
    data.set("currency", "USD");
    expect(readBudgetForm(data)).toEqual({
      category: "rent",
      period: "quarter",
      limit: "10",
    });
  });
});
