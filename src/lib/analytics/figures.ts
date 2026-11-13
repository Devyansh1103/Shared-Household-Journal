// Figures worked out from the analytics totals (roadmap Phase 16). Exact:
// BigInt only; a percentage is rounded only for showing.

const ZERO = BigInt(0);

/** The mean, rounded to the nearest minor unit (halves up); null for no expenses. */
export function averageMinor(totalMinor: bigint, count: number): bigint | null {
  if (count <= 0) return null;
  const n = BigInt(count);
  return (totalMinor * BigInt(2) + n) / (n * BigInt(2));
}

export type Comparison =
  /** Nothing was spent in the period compared with: no percentage. */
  | { kind: "no_previous" }
  | { kind: "same" }
  /** In tenths of a percent, rounded down. */
  | { kind: "more" | "less"; differenceMinor: bigint; permille: bigint };

/**
 * This period against the one compared with. A percentage only when the
 * earlier period had spending: from nothing, any change would be "infinite".
 */
export function compareTotals(current: bigint, previous: bigint): Comparison {
  if (previous === ZERO) return { kind: "no_previous" };
  if (current === previous) return { kind: "same" };
  const more = current > previous;
  const differenceMinor = more ? current - previous : previous - current;
  return {
    kind: more ? "more" : "less",
    differenceMinor,
    permille: (differenceMinor * BigInt(1000)) / previous,
  };
}

/** A part of a whole in tenths of a percent, rounded down; null for an empty whole. */
export function sharePermille(part: bigint, whole: bigint): bigint | null {
  return whole > ZERO ? (part * BigInt(1000)) / whole : null;
}

/** How wide a bar is, 0–100, against the largest value shown. */
export function barWidth(value: bigint, largest: bigint): number {
  if (largest <= ZERO || value <= ZERO) return 0;
  return Number((value * BigInt(1000)) / largest) / 10;
}
