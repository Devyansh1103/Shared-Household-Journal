import { describe, expect, it } from "vitest";
import {
  barPercent,
  budgetFigures,
  formatPermille,
  NEAR_LIMIT_PERCENT,
} from "./figures";

const b = (n: number | string) => BigInt(n);

describe("budgetFigures", () => {
  it("works out what's left and how much is used, below the limit", () => {
    expect(budgetFigures(b(800000), b(500000))).toEqual({
      limitMinor: b(800000),
      spentMinor: b(500000),
      remainingMinor: b(300000),
      overMinor: b(0),
      usedPermille: b(625),
      status: "on_track",
    });
  });

  it("says nothing is spent yet for an empty period", () => {
    expect(budgetFigures(b(800000), b(0))).toMatchObject({
      remainingMinor: b(800000),
      usedPermille: b(0),
      status: "not_started",
    });
  });

  it(`is near the limit from ${NEAR_LIMIT_PERCENT}%, exactly`, () => {
    expect(budgetFigures(b(10000), b(7999)).status).toBe("on_track");
    expect(budgetFigures(b(10000), b(8000)).status).toBe("near_limit");
    // Exactly at the limit: nothing left, not over.
    expect(budgetFigures(b(10000), b(10000))).toMatchObject({
      remainingMinor: b(0),
      overMinor: b(0),
      usedPermille: b(1000),
      status: "near_limit",
    });
  });

  it("shows overspending separately, never as a negative remainder", () => {
    expect(budgetFigures(b(10000), b(12550))).toMatchObject({
      remainingMinor: b(0),
      overMinor: b(2550),
      usedPermille: b(1255),
      status: "exceeded",
    });
  });

  it("never divides by a zero limit, and stays exact for large amounts", () => {
    expect(budgetFigures(b(0), b(0))).toMatchObject({
      usedPermille: null,
      status: "not_started",
    });
    expect(budgetFigures(b(0), b(1))).toMatchObject({
      usedPermille: null,
      status: "exceeded",
    });
    const big = budgetFigures(b("999999999999"), b("999999999998"));
    expect(big.remainingMinor).toBe(b(1));
    expect(big.usedPermille).toBe(b(999));
    expect(() => budgetFigures(b(1), b(-1))).toThrow(RangeError);
  });

  it("rounds a percentage down, so 99.95% never shows as 100%", () => {
    expect(budgetFigures(b(10000), b(9995)).usedPermille).toBe(b(999));
    expect(formatPermille(b(999))).toBe("99.9%");
    expect(formatPermille(b(1000))).toBe("100%");
    expect(formatPermille(b(625))).toBe("62.5%");
  });
});

describe("barPercent", () => {
  it("fills the bar up to the limit and no further", () => {
    expect(barPercent(budgetFigures(b(1000), b(250)))).toBe(25);
    expect(barPercent(budgetFigures(b(1000), b(5000)))).toBe(100);
    expect(barPercent(budgetFigures(b(1000), b(0)))).toBe(0);
  });
});
