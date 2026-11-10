// Property tests for the split engine and amount parsing. Inputs come from a
// seeded generator, so every run checks the same thousands of cases and a
// failure is reproducible from its case number. No test dependency needed.

import { describe, expect, it } from "vitest";
import { minorToDecimalString } from "@/lib/format";
import { MAX_AMOUNT_MINOR, parseAmount } from "./amount";
import { computeSplit, FULL_BASIS_POINTS, type Share } from "./split";

const ZERO = BigInt(0);
const ONE = BigInt(1);
const FULL = BigInt(FULL_BASIS_POINTS);
const CASES = 2000;

type Rng = () => number;

/** mulberry32: a small, well-known seeded PRNG. */
function seeded(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (rng: Rng, lo: number, hi: number) =>
  lo + Math.floor(rng() * (hi - lo + 1));

/** A BigInt in [lo, hi]; 53 random bits is plenty for these ranges. */
function bigint(rng: Rng, lo: bigint, hi: bigint): bigint {
  const draw =
    BigInt(Math.floor(rng() * 2 ** 26)) * BigInt(2 ** 27) +
    BigInt(Math.floor(rng() * 2 ** 27));
  return lo + (draw % (hi - lo + ONE));
}

/** Totals from tiny to the maximum, so leftovers and big numbers both appear. */
function total(rng: Rng): bigint {
  const bucket = rng();
  if (bucket < 0.3) return bigint(rng, ONE, BigInt(20));
  if (bucket < 0.7) return bigint(rng, ONE, BigInt(1000000));
  if (bucket < 0.95) return bigint(rng, ONE, MAX_AMOUNT_MINOR);
  return MAX_AMOUNT_MINOR;
}

const people = (n: number) => Array.from({ length: n }, (_, i) => `user-${i}`);

/** n parts that add up to `sum`, some possibly zero (random cut points). */
function partition(rng: Rng, sum: bigint, n: number): bigint[] {
  const cuts = Array.from({ length: n - 1 }, () => bigint(rng, ZERO, sum)).sort(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const edges = [ZERO, ...cuts, sum];
  return edges.slice(1).map((edge, i) => edge - edges[i]);
}

/** The invariants every valid split must meet, whatever the method. */
function expectInvariants(shares: Share[], totalMinor: bigint, ids: string[]) {
  // Exactly one allocation per participant, in the order given.
  expect(shares.map((s) => s.userId)).toEqual(ids);
  let sum = ZERO;
  for (const share of shares) {
    // Whole minor units, never negative, never more than the total.
    expect(typeof share.shareMinor).toBe("bigint");
    expect(share.shareMinor >= ZERO).toBe(true);
    expect(share.shareMinor <= totalMinor).toBe(true);
    sum += share.shareMinor;
  }
  // The non-negotiable one: the shares add up exactly to the total.
  expect(sum).toBe(totalMinor);
}

describe("equal split, generated cases", () => {
  it("always reconciles and matches ADR-004 exactly", () => {
    const rng = seeded(1);
    for (let c = 0; c < CASES; c++) {
      const t = total(rng);
      const ids = people(int(rng, 1, 12));
      const result = computeSplit({
        method: "equal",
        total: t,
        participants: ids,
      });
      expect(result.ok, `case ${c}`).toBe(true);
      if (!result.ok) return;
      expectInvariants(result.shares, t, ids);

      // floor(total / n) each, the leftover units to the earliest joiners.
      const n = BigInt(ids.length);
      const base = t / n;
      const leftover = t % n;
      result.shares.forEach((share, i) => {
        expect(share.shareMinor).toBe(BigInt(i) < leftover ? base + ONE : base);
        expect(share.percentageBp).toBeNull();
      });

      expect(
        computeSplit({ method: "equal", total: t, participants: [...ids] }),
      ).toEqual(result);
    }
  });
});

describe("percentage split, generated cases", () => {
  it("always reconciles and follows the largest-remainder rule", () => {
    const rng = seeded(2);
    for (let c = 0; c < CASES; c++) {
      const t = total(rng);
      const ids = people(int(rng, 1, 12));
      const bps = partition(rng, FULL, ids.length).map(Number);
      const participants = ids.map((userId, i) => ({
        userId,
        basisPoints: bps[i],
      }));
      const result = computeSplit({
        method: "percentage",
        total: t,
        participants,
      });
      expect(result.ok, `case ${c}`).toBe(true);
      if (!result.ok) return;
      expectInvariants(result.shares, t, ids);

      const exact = bps.map((bp) => (t * BigInt(bp)) / FULL);
      const rest = bps.map((bp) => (t * BigInt(bp)) % FULL);
      const extra = result.shares.map((s, i) => s.shareMinor - exact[i]);

      // Each share is its exact percentage, floored, or one unit more.
      extra.forEach((e, i) => {
        expect(e === ZERO || e === ONE, `case ${c} share ${i}`).toBe(true);
        if (bps[i] === 0) expect(result.shares[i].shareMinor).toBe(ZERO);
        expect(result.shares[i].percentageBp).toBe(bps[i]);
      });
      // Exactly the leftover units are handed out...
      const handedOut = extra.reduce((sum, e) => sum + e, ZERO);
      expect(handedOut).toBe(t - exact.reduce((sum, e) => sum + e, ZERO));
      // ...to the largest remainders, ties to the earliest joiner.
      for (let i = 0; i < ids.length; i++) {
        for (let j = 0; j < ids.length; j++) {
          if (extra[i] === ONE && extra[j] === ZERO) {
            const before = rest[i] > rest[j] || (rest[i] === rest[j] && i < j);
            expect(before, `case ${c}: ${i} got a unit before ${j}`).toBe(true);
          }
        }
      }

      expect(
        computeSplit({ method: "percentage", total: t, participants }),
      ).toEqual(result);
    }
  });

  it("refuses totals that are off by even one basis point, without normalising", () => {
    const rng = seeded(3);
    for (let c = 0; c < 500; c++) {
      const ids = people(int(rng, 1, 8));
      const bps = partition(rng, FULL, ids.length).map(Number);
      const off = rng() < 0.5 ? 1 : -1;
      const i = int(rng, 0, ids.length - 1);
      // Out of range for one person is a different error (invalid_percentage).
      if (bps[i] + off < 0 || bps[i] + off > FULL_BASIS_POINTS) continue;
      bps[i] += off;
      const result = computeSplit({
        method: "percentage",
        total: total(rng),
        participants: ids.map((userId, k) => ({ userId, basisPoints: bps[k] })),
      });
      expect(result.ok ? "ok" : result.code, `case ${c}`).toBe(
        "percentages_not_100",
      );
    }
  });
});

describe("custom split, generated cases", () => {
  it("accepts every exact partition unchanged and refuses anything else", () => {
    const rng = seeded(4);
    for (let c = 0; c < CASES; c++) {
      const t = total(rng);
      const ids = people(int(rng, 1, 12));
      const parts = partition(rng, t, ids.length);
      const participants = ids.map((userId, i) => ({
        userId,
        shareMinor: parts[i],
      }));
      const result = computeSplit({ method: "custom", total: t, participants });
      expect(result.ok, `case ${c}`).toBe(true);
      if (!result.ok) return;
      expectInvariants(result.shares, t, ids);
      expect(result.shares.map((s) => s.shareMinor)).toEqual(parts);

      // One unit more or less anywhere is refused; nothing is redistributed.
      const i = int(rng, 0, ids.length - 1);
      for (const delta of [ONE, -ONE]) {
        const tampered = participants.map((p, k) =>
          k === i ? { ...p, shareMinor: p.shareMinor + delta } : p,
        );
        const refused = computeSplit({
          method: "custom",
          total: t,
          participants: tampered,
        });
        expect(refused.ok, `case ${c} delta ${delta}`).toBe(false);
        if (!refused.ok) {
          expect(["shares_not_equal_total", "negative_share"]).toContain(
            refused.code,
          );
        }
      }
    }
  });
});

describe("amounts round-trip exactly between storage, display and input", () => {
  it("parses back to the same minor units at 0, 2, 3 and 4 decimal places", () => {
    const rng = seeded(5);
    for (const exponent of [0, 2, 3, 4]) {
      const indian = new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: exponent,
        maximumFractionDigits: exponent,
      });
      const international = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: exponent,
        maximumFractionDigits: exponent,
      });
      for (let c = 0; c < 500; c++) {
        const minor = c === 0 ? MAX_AMOUNT_MINOR : c === 1 ? ONE : total(rng);
        const decimal = minorToDecimalString(minor, exponent);
        const expected = { ok: true, minor };
        expect(parseAmount(decimal, exponent), decimal).toEqual(expected);
        // As people might type it, with Indian or international grouping.
        const grouped = decimal as `${number}`;
        expect(parseAmount(indian.format(grouped), exponent)).toEqual(expected);
        expect(parseAmount(international.format(grouped), exponent)).toEqual(
          expected,
        );
        // One more decimal place than the currency has is refused, not rounded.
        const tooPrecise = exponent > 0 ? `${decimal}5` : `${decimal}.5`;
        expect(parseAmount(tooPrecise, exponent)).toMatchObject({
          ok: false,
          code: "too_many_decimals",
        });
      }
    }
  });
});
