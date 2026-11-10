// The split engine (ADR-004). Pure and deterministic: the same input always
// gives the same shares, and the shares always add up exactly to the total.
// Used for the form preview and by the server before it calls create_expense /
// update_expense, which check again that the shares reconcile.
//
// Participants are passed in the order they joined the household; that order
// decides who receives leftover minor units.

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

export type SplitResult =
  { ok: true; shares: Share[] } | { ok: false; error: string };

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
export const FULL_BASIS_POINTS = 10000;

export function computeSplit(input: SplitInput): SplitResult {
  if (input.total <= ZERO) {
    return { ok: false, error: "The amount must be greater than zero." };
  }
  if (input.participants.length === 0) {
    return { ok: false, error: "Choose at least one person to split with." };
  }
  const ids = input.participants.map((p) =>
    typeof p === "string" ? p : p.userId,
  );
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: "Each person can appear only once." };
  }

  switch (input.method) {
    case "equal":
      return { ok: true, shares: splitEqual(input.total, input.participants) };
    case "percentage":
      return splitPercentage(input.total, input.participants);
    case "custom":
      return splitCustom(input.total, input.participants);
  }
}

/**
 * floor(total / n) each; the leftover units go one each to the earliest joiners.
 * ₹100.00 three ways → 33.34, 33.33, 33.33.
 */
export function splitEqual(total: bigint, participants: string[]): Share[] {
  const n = BigInt(participants.length);
  const base = total / n;
  const leftover = Number(total % n);
  return participants.map((userId, index) => ({
    userId,
    shareMinor: index < leftover ? base + ONE : base,
    percentageBp: null,
  }));
}

/**
 * Basis points must total 10000. Each share is floor(total × bp / 10000); the
 * leftover units go to the largest remainders, ties to the earliest joiner.
 */
export function splitPercentage(
  total: bigint,
  participants: { userId: string; basisPoints: number }[],
): SplitResult {
  let sum = 0;
  for (const { basisPoints } of participants) {
    if (
      !Number.isInteger(basisPoints) ||
      basisPoints < 0 ||
      basisPoints > FULL_BASIS_POINTS
    ) {
      return { ok: false, error: "Each percentage must be between 0 and 100." };
    }
    sum += basisPoints;
  }
  if (sum !== FULL_BASIS_POINTS) {
    return { ok: false, error: "The percentages must add up to exactly 100%." };
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
  let leftover = Number(total - allocated);

  const order = [...rows].sort((a, b) =>
    a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1,
  );
  const extra = new Set<number>();
  for (const row of order) {
    if (leftover === 0) break;
    extra.add(row.index);
    leftover -= 1;
  }

  return {
    ok: true,
    shares: rows.map((row) => ({
      userId: row.userId,
      shareMinor: extra.has(row.index) ? row.base + ONE : row.base,
      percentageBp: row.basisPoints,
    })),
  };
}

/** Custom amounts must be ≥ 0 and add up exactly to the total. */
export function splitCustom(
  total: bigint,
  participants: { userId: string; shareMinor: bigint }[],
): SplitResult {
  let sum = ZERO;
  for (const { shareMinor } of participants) {
    if (shareMinor < ZERO) {
      return { ok: false, error: "Shares can't be negative." };
    }
    sum += shareMinor;
  }
  if (sum !== total) {
    return {
      ok: false,
      error: "The shares must add up exactly to the amount.",
    };
  }
  return {
    ok: true,
    shares: participants.map(({ userId, shareMinor }) => ({
      userId,
      shareMinor,
      percentageBp: null,
    })),
  };
}
