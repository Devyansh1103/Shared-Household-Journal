import { describe, expect, it } from "vitest";
import {
  averageMinor,
  barWidth,
  compareTotals,
  sharePermille,
} from "./figures";

const b = (n: number | string) => BigInt(n);

describe("averageMinor", () => {
  it("rounds to the nearest minor unit, halves up, exactly", () => {
    expect(averageMinor(b(1000), 3)).toBe(b(333)); // 333.33…
    expect(averageMinor(b(1001), 2)).toBe(b(501)); // 500.5
    expect(averageMinor(b(2000), 3)).toBe(b(667)); // 666.67
    expect(averageMinor(b("999999999999"), 1)).toBe(b("999999999999"));
    expect(averageMinor(b(0), 0)).toBeNull();
  });
});

describe("compareTotals", () => {
  it("gives a percentage only when there was spending before", () => {
    expect(compareTotals(b(5000), b(0))).toEqual({ kind: "no_previous" });
    expect(compareTotals(b(0), b(0))).toEqual({ kind: "no_previous" });
    expect(compareTotals(b(4000), b(4000))).toEqual({ kind: "same" });
    expect(compareTotals(b(4500), b(4000))).toEqual({
      kind: "more",
      differenceMinor: b(500),
      permille: b(125),
    });
    expect(compareTotals(b(0), b(4000))).toEqual({
      kind: "less",
      differenceMinor: b(4000),
      permille: b(1000),
    });
  });
});

describe("sharePermille and barWidth", () => {
  it("are exact and safe with nothing to divide by", () => {
    expect(sharePermille(b(1), b(3))).toBe(b(333));
    expect(sharePermille(b(0), b(0))).toBeNull();
    expect(barWidth(b(50), b(200))).toBe(25);
    expect(barWidth(b(200), b(200))).toBe(100);
    expect(barWidth(b(0), b(0))).toBe(0);
  });
});
