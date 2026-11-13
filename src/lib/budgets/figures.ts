// A budget's figures (roadmap Phase 16, D29): what's left, how much is used,
// and its status. Exact: integer minor units as BigInt, never floating
// point; a percentage is worked out in tenths of a percent, rounded down, and
// is only ever for showing.

export type BudgetStatus =
  "not_started" | "on_track" | "near_limit" | "exceeded";

/** D29 (decided 2026-11-13): "Near limit" from 80% of the limit. */
export const NEAR_LIMIT_PERCENT = 80;

export const STATUS_LABELS: Record<BudgetStatus, string> = {
  not_started: "Nothing spent yet",
  on_track: "On track",
  near_limit: "Near limit",
  exceeded: "Over budget",
};

export type BudgetFigures = {
  limitMinor: bigint;
  spentMinor: bigint;
  /** What's left, never below zero. */
  remainingMinor: bigint;
  /** How far over the limit, or zero. Shown separately, never as a negative remainder. */
  overMinor: bigint;
  /**
   * Spent as a share of the limit, in tenths of a percent, rounded down:
   * 625 is 62.5%. Null when there's no limit to compare with.
   */
  usedPermille: bigint | null;
  status: BudgetStatus;
};

const ZERO = BigInt(0);

export function budgetFigures(
  limitMinor: bigint,
  spentMinor: bigint,
): BudgetFigures {
  if (spentMinor < ZERO) throw new RangeError("Spending can't be negative");
  const remainingMinor =
    limitMinor > spentMinor ? limitMinor - spentMinor : ZERO;
  const overMinor = spentMinor > limitMinor ? spentMinor - limitMinor : ZERO;
  // A limit is always above zero (the database checks it); a zero or
  // negative one is still handled without dividing by it.
  const usedPermille =
    limitMinor > ZERO ? (spentMinor * BigInt(1000)) / limitMinor : null;

  let status: BudgetStatus;
  if (spentMinor === ZERO) status = "not_started";
  else if (limitMinor <= ZERO || spentMinor > limitMinor) status = "exceeded";
  else if (
    spentMinor * BigInt(100) >=
    limitMinor * BigInt(NEAR_LIMIT_PERCENT)
  ) {
    status = "near_limit";
  } else status = "on_track";

  return {
    limitMinor,
    spentMinor,
    remainingMinor,
    overMinor,
    usedPermille,
    status,
  };
}

/** "62.5%", "100%", "250%". */
export function formatPermille(permille: bigint): string {
  const whole = permille / BigInt(10);
  const tenth = permille % BigInt(10);
  return tenth === ZERO ? `${whole}%` : `${whole}.${tenth}%`;
}

/** How wide a progress bar is, 0–100: full once the limit is reached. */
export function barPercent(figures: BudgetFigures): number {
  if (figures.usedPermille === null) return figures.spentMinor > ZERO ? 100 : 0;
  const capped =
    figures.usedPermille > BigInt(1000) ? BigInt(1000) : figures.usedPermille;
  return Number(capped) / 10;
}
