// The split engine (ADR-004). Pure and deterministic: the same input always
// gives the same shares, and the shares always add up exactly to the total.
// Used for the form preview and by the server before it calls create_expense /
// update_expense, which check again that the shares reconcile.
//
// Money is integer minor units (BigInt) throughout; no step converts an
// amount to a JavaScript number. The engine doesn't know the currency: the
// household has exactly one (D1), and its decimal places only matter when
// parsing input and formatting output (amount.ts, currency.ts, lib/format.ts).
//
// Participants are passed in the order they joined the household; that order
// decides who receives leftover minor units. Who may take part (active members
// of the household) is checked by the caller against trusted server data and
// again by the database; this module only checks the shape of its input.
//
// See docs/money.md for the full rules.

import { MAX_AMOUNT_MINOR } from "./amount";

export type SplitMethod = "equal" | "percentage" | "custom";

export const SPLIT_METHODS: readonly SplitMethod[] = [
  "equal",
  "percentage",
  "custom",
];

export type Share = {
  userId: string;
  shareMinor: bigint;
  /** Only for percentage splits. */
  percentageBp: number | null;
};

/** Machine-readable reasons a split is refused. Messages are for people. */
export type SplitErrorCode =
  | "invalid_total"
  | "no_participants"
  | "invalid_participant"
  | "duplicate_participant"
  | "invalid_percentage"
  | "percentages_not_100"
  | "invalid_share"
  | "negative_share"
  | "shares_not_equal_total";

export type SplitError = {
  ok: false;
  code: SplitErrorCode;
  /** Plain-language message, safe to show. */
  error: string;
  /** The participant the error is about, when there is one. */
  userId?: string;
};

export type SplitResult =
  | { ok: true; method: SplitMethod; total: bigint; shares: Share[] }
  | SplitError;

export type SplitInput =
  | { method: "equal"; total: bigint; participants: string[] }
  | {
      method: "percentage";
      total: bigint;
      participants: { userId: string; basisPoints: number }[];
    }
  | {
      method: "custom";
      total: bigint;
      participants: { userId: string; shareMinor: bigint }[];
    };

const ZERO = BigInt(0);
const ONE = BigInt(1);
/** 100% in basis points (1% = 100 bp). */
export const FULL_BASIS_POINTS = 10000;

function fail(
  code: SplitErrorCode,
  error: string,
  userId?: string,
): SplitError {
  return userId === undefined
    ? { ok: false, code, error }
    : { ok: false, code, error, userId };
}

export function computeSplit(input: SplitInput): SplitResult {
  const totalError = checkTotal(input.total);
  if (totalError) return totalError;

  if (input.participants.length === 0) {
    return fail("no_participants", "Choose at least one person to split with.");
  }
  const ids = input.participants.map((p) =>
    typeof p === "string" ? p : p.userId,
  );
  if (ids.some((id) => typeof id !== "string" || id.trim() === "")) {
    return fail("invalid_participant", "Every person needs a valid id.");
  }
  if (new Set(ids).size !== ids.length) {
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
    return fail(
      "duplicate_participant",
      "Each person can appear only once.",
      duplicate,
    );
  }

  switch (input.method) {
    case "equal":
      return {
        ok: true,
        method: "equal",
        total: input.total,
        shares: splitEqual(input.total, input.participants),
      };
    case "percentage":
      return splitPercentage(input.total, input.participants);
    case "custom":
      return splitCustom(input.total, input.participants);
  }
}

function checkTotal(total: bigint): SplitError | null {
  if (typeof total !== "bigint" || total <= ZERO) {
    return fail("invalid_total", "The amount must be greater than zero.");
  }
  if (total > MAX_AMOUNT_MINOR) {
    return fail("invalid_total", "That amount is too large.");
  }
  return null;
}

/**
 * floor(total / n) each; the leftover units (total mod n, always fewer than n)
 * go one each to the earliest joiners. ₹100.00 three ways → 33.34, 33.33, 33.33.
 * Expects a non-empty list; computeSplit checks that first.
 */
export function splitEqual(total: bigint, participants: string[]): Share[] {
  const n = BigInt(participants.length);
  const base = total / n;
  const leftover = total % n;
  return participants.map((userId, index) => ({
    userId,
    shareMinor: BigInt(index) < leftover ? base + ONE : base,
    percentageBp: null,
  }));
}

/**
 * Basis points must be whole numbers from 0 to 10000 and total exactly 10000
 * (nothing is normalised). Each share is floor(total × bp / 10000); the
 * leftover units go one each to the largest remainders, ties to the earliest
 * joiner (largest-remainder method). A share is therefore always its exact
 * percentage or one unit more, and a 0% participant always gets nothing.
 */
export function splitPercentage(
  total: bigint,
  participants: { userId: string; basisPoints: number }[],
): SplitResult {
  const totalError = checkTotal(total);
  if (totalError) return totalError;

  let sum = 0;
  for (const { userId, basisPoints } of participants) {
    if (
      !Number.isInteger(basisPoints) ||
      basisPoints < 0 ||
      basisPoints > FULL_BASIS_POINTS
    ) {
      return fail(
        "invalid_percentage",
        "Each percentage must be between 0 and 100.",
        userId,
      );
    }
    sum += basisPoints;
  }
  if (sum !== FULL_BASIS_POINTS) {
    return fail(
      "percentages_not_100",
      "The percentages must add up to exactly 100%.",
    );
  }

  const full = BigInt(FULL_BASIS_POINTS);
  const rows = participants.map(({ userId, basisPoints }, index) => {
    const scaled = total * BigInt(basisPoints);
    return {
      userId,
      basisPoints,
      index,
      base: scaled / full,
      rest: scaled % full,
    };
  });
  const allocated = rows.reduce((acc, row) => acc + row.base, ZERO);
  let leftover = total - allocated;

  const order = [...rows].sort((a, b) =>
    a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1,
  );
  const extra = new Set<number>();
  for (const row of order) {
    if (leftover === ZERO) break;
    extra.add(row.index);
    leftover -= ONE;
  }

  return {
    ok: true,
    method: "percentage",
    total,
    shares: rows.map((row) => ({
      userId: row.userId,
      shareMinor: extra.has(row.index) ? row.base + ONE : row.base,
      percentageBp: row.basisPoints,
    })),
  };
}

/**
 * Custom amounts must be whole minor units, ≥ 0, and add up exactly to the
 * total. Nothing is redistributed: a shortfall or excess is an error.
 */
export function splitCustom(
  total: bigint,
  participants: { userId: string; shareMinor: bigint }[],
): SplitResult {
  const totalError = checkTotal(total);
  if (totalError) return totalError;

  let sum = ZERO;
  for (const { userId, shareMinor } of participants) {
    if (typeof shareMinor !== "bigint") {
      return fail(
        "invalid_share",
        "Each share must be a whole number of minor units.",
        userId,
      );
    }
    if (shareMinor < ZERO) {
      return fail("negative_share", "Shares can't be negative.", userId);
    }
    sum += shareMinor;
  }
  if (sum !== total) {
    return fail(
      "shares_not_equal_total",
      "The shares must add up exactly to the amount.",
    );
  }
  return {
    ok: true,
    method: "custom",
    total,
    shares: participants.map(({ userId, shareMinor }) => ({
      userId,
      shareMinor,
      percentageBp: null,
    })),
  };
}
