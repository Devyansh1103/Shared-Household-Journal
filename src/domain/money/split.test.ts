import { describe, expect, it } from "vitest";
import {
  computeSplit,
  splitCustom,
  splitEqual,
  splitPercentage,
  type Share,
} from "./split";

const b = (value: number | string) => BigInt(value);
const amounts = (shares: Share[]) => shares.map((s) => Number(s.shareMinor));
const total = (shares: Share[]) =>
  shares.reduce((sum, s) => sum + s.shareMinor, b(0));

describe("splitEqual", () => {
  it("matches ADR-004's example: ₹100.00 three ways", () => {
    expect(amounts(splitEqual(b(10000), ["a", "b", "c"]))).toEqual([
      3334, 3333, 3333,
    ]);
  });

  it("gives leftover units to the earliest joiners, in order", () => {
    expect(amounts(splitEqual(b(10), ["a", "b", "c", "d"]))).toEqual([
      3, 3, 2, 2,
    ]);
  });

  it("gives one participant everything", () => {
    expect(amounts(splitEqual(b(12345), ["a"]))).toEqual([12345]);
  });

  it("allows zero shares when the total is smaller than the group", () => {
    expect(amounts(splitEqual(b(2), ["a", "b", "c"]))).toEqual([1, 1, 0]);
  });

  it("always reconciles exactly, including near the maximum amount", () => {
    for (const [t, n] of [
      [1, 7],
      [999999999999, 7],
      [100, 3],
      [101, 2],
    ]) {
      const people = Array.from({ length: n }, (_, i) => `p${i}`);
      expect(total(splitEqual(b(t), people))).toBe(b(t));
    }
  });
});

describe("splitPercentage", () => {
  it("splits by basis points", () => {
    const result = splitPercentage(b(10000), [
      { userId: "a", basisPoints: 5000 },
      { userId: "b", basisPoints: 3000 },
      { userId: "c", basisPoints: 2000 },
    ]);
    expect(result.ok && amounts(result.shares)).toEqual([5000, 3000, 2000]);
    expect(result.ok && result.shares.map((s) => s.percentageBp)).toEqual([
      5000, 3000, 2000,
    ]);
  });

  it("uses the largest remainder, ties to the earliest joiner", () => {
    // ₹1.00 at 33.33 / 33.33 / 33.34 → raw 33.33, 33.33, 33.34
    const thirds = splitPercentage(b(100), [
      { userId: "a", basisPoints: 3333 },
      { userId: "b", basisPoints: 3333 },
      { userId: "c", basisPoints: 3334 },
    ]);
    expect(thirds.ok && amounts(thirds.shares)).toEqual([33, 33, 34]);

    // ₹0.10 at 50 / 50 of 3 units: 1.5 each → tie, first joiner gets the extra.
    const tie = splitPercentage(b(3), [
      { userId: "a", basisPoints: 5000 },
      { userId: "b", basisPoints: 5000 },
    ]);
    expect(tie.ok && amounts(tie.shares)).toEqual([2, 1]);

    // Largest remainder wins over join order.
    const largest = splitPercentage(b(10), [
      { userId: "a", basisPoints: 1500 }, // 1.5
      { userId: "b", basisPoints: 1700 }, // 1.7
      { userId: "c", basisPoints: 6800 }, // 6.8
    ]);
    expect(largest.ok && amounts(largest.shares)).toEqual([1, 2, 7]);
  });

  it("rejects percentages that don't total exactly 100%", () => {
    for (const bps of [
      [5000, 4999],
      [5000, 5001],
      [10001],
      [-100, 10100],
      [3333.5, 6666.5],
    ]) {
      const result = splitPercentage(
        b(1000),
        bps.map((basisPoints, i) => ({ userId: `p${i}`, basisPoints })),
      );
      expect(result.ok).toBe(false);
    }
  });

  it("always reconciles exactly", () => {
    const result = splitPercentage(b(999999999999), [
      { userId: "a", basisPoints: 1 },
      { userId: "b", basisPoints: 3333 },
      { userId: "c", basisPoints: 6666 },
    ]);
    expect(result.ok && total(result.shares)).toBe(b(999999999999));
  });
});

describe("splitCustom", () => {
  it("accepts shares that add up exactly", () => {
    const result = splitCustom(b(1000), [
      { userId: "a", shareMinor: b(700) },
      { userId: "b", shareMinor: b(300) },
    ]);
    expect(result.ok && amounts(result.shares)).toEqual([700, 300]);
  });

  it("rejects shares that are one unit off, or negative", () => {
    expect(
      splitCustom(b(1000), [
        { userId: "a", shareMinor: b(700) },
        { userId: "b", shareMinor: b(299) },
      ]).ok,
    ).toBe(false);
    expect(
      splitCustom(b(1000), [
        { userId: "a", shareMinor: b(1100) },
        { userId: "b", shareMinor: b(-100) },
      ]).ok,
    ).toBe(false);
  });
});

describe("computeSplit", () => {
  it("rejects no participants, duplicates and non-positive totals", () => {
    expect(
      computeSplit({ method: "equal", total: b(100), participants: [] }).ok,
    ).toBe(false);
    expect(
      computeSplit({ method: "equal", total: b(100), participants: ["a", "a"] })
        .ok,
    ).toBe(false);
    expect(
      computeSplit({ method: "equal", total: b(0), participants: ["a"] }).ok,
    ).toBe(false);
  });

  it("includes or excludes the payer only as the caller decides", () => {
    // The engine doesn't know who paid: a payer left out simply has no share.
    const result = computeSplit({
      method: "equal",
      total: b(900),
      participants: ["b", "c"],
    });
    expect(result.ok && result.shares.map((s) => s.userId)).toEqual(["b", "c"]);
  });

  it("is deterministic", () => {
    const input = {
      method: "equal" as const,
      total: b(1001),
      participants: ["a", "b", "c"],
    };
    expect(computeSplit(input)).toEqual(computeSplit(input));
  });
});
