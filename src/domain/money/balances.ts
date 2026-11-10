// Balances (ADR-005): derived from the expense records every time, never
// stored.
//
// This is the TypeScript reference implementation. The app shows what
// Postgres calculates (public.household_balances); the database tests
// cross-check the two on generated data, and checkBalances / checkEntries
// verify the invariants of whatever is about to be shown, wherever it came
// from.
//
// Sign convention, used everywhere:
//   net = paid − shares
//   positive → the person should get money back (others owe them)
//   negative → the person owes money
//   zero     → settled up
//
// Pairs: each participant owes the payer their share, and between two people
// the two directions offset. Nothing moves between pairs: that would be debt
// simplification (Phase 21). Settlements join in Phase 10.
//
// Money is integer minor units (BigInt) in the household's one currency (D1).
// A calculation covers one household, so amounts in different currencies
// never meet. See docs/money.md.

export type BalanceExpense = {
  id: string;
  householdId: string;
  amountMinor: bigint;
  paidBy: string;
  /** Soft-deleted (D7): kept for the record, but it doesn't count. */
  deleted: boolean;
  shares: { userId: string; shareMinor: bigint }[];
};

export type BalanceInput = {
  householdId: string;
  /** Active members, listed even with nothing to their name (join order). */
  memberIds: string[];
  expenses: BalanceExpense[];
};

export type PersonBalance = {
  userId: string;
  /** The whole amount of every counted expense this person paid for. */
  paidMinor: bigint;
  /** This person's shares of counted expenses. */
  shareMinor: bigint;
  /** paid − shares: positive means owed money, negative means owes money. */
  netMinor: bigint;
  /** Counted expenses this person paid for. */
  paidCount: number;
  /** Counted expenses this person has a share in (a ₹0 share included). */
  shareCount: number;
};

export type PairBalance = {
  /** Owes the creditor. */
  debtorId: string;
  creditorId: string;
  /** Always above zero: what's left after the two directions offset. */
  amountMinor: bigint;
};

export type Balances = {
  /** Counted (not deleted) expenses. */
  expenseCount: number;
  /** What the counted expenses add up to. */
  totalMinor: bigint;
  people: PersonBalance[];
  pairs: PairBalance[];
};

/** Another person's part in one expense, seen from the focus person. */
export type Counterpart = {
  userId: string;
  /** Positive: they owe the focus person. Negative: the focus person owes them. */
  minor: bigint;
};

/** How one counted expense moves one person's balance. */
export type BalanceEntry = {
  expenseId: string;
  paidMinor: bigint;
  shareMinor: bigint;
  /** paid − share; equal to the sum of the counterparts. */
  netMinor: bigint;
  counterparts: Counterpart[];
};

/** Machine-readable reasons; messages are for people. */
export type BalanceErrorCode =
  // Input to computeBalances / entriesFor
  | "foreign_expense"
  | "duplicate_expense"
  | "invalid_expense"
  | "no_participants"
  | "duplicate_participant"
  | "not_reconciled"
  // Invariants checked by checkBalances / checkEntries
  | "duplicate_person"
  | "net_mismatch"
  | "totals_mismatch"
  | "not_zero_sum"
  | "invalid_pair"
  | "pairs_mismatch"
  | "entries_mismatch";

export type BalanceError = {
  ok: false;
  code: BalanceErrorCode;
  /** Plain-language message, safe to show. */
  error: string;
  /** The expense the problem is in, when there is one. */
  expenseId?: string;
  /** The person the problem is about, when there is one. */
  userId?: string;
};

export type BalanceResult = ({ ok: true } & Balances) | BalanceError;
export type BalanceCheck = { ok: true } | BalanceError;

export type BalanceDirection = "owed" | "owes" | "settled";

const ZERO = BigInt(0);

function fail(
  code: BalanceErrorCode,
  error: string,
  about: { expenseId?: string; userId?: string } = {},
): BalanceError {
  return { ok: false, code, error, ...about };
}

/** Code-point order, the same order Postgres gives lowercase uuids. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The sign convention, in one place. */
export function balanceDirection(netMinor: bigint): BalanceDirection {
  return netMinor > ZERO ? "owed" : netMinor < ZERO ? "owes" : "settled";
}

// ---------------------------------------------------------------------------
// Input checks
// ---------------------------------------------------------------------------

/** One expense's own rules (ADR-004): it must add up exactly. */
function checkExpense(expense: BalanceExpense): BalanceError | null {
  const expenseId = expense.id;
  if (typeof expense.amountMinor !== "bigint" || expense.amountMinor <= ZERO) {
    return fail(
      "invalid_expense",
      "An expense amount must be a whole number of minor units above zero.",
      { expenseId },
    );
  }
  if (typeof expense.paidBy !== "string" || expense.paidBy.trim() === "") {
    return fail("invalid_expense", "Every expense needs a payer.", {
      expenseId,
    });
  }
  if (!Array.isArray(expense.shares) || expense.shares.length === 0) {
    return fail("no_participants", "Every expense needs a participant.", {
      expenseId,
    });
  }

  const people = new Set<string>();
  let sum = ZERO;
  for (const { userId, shareMinor } of expense.shares) {
    if (typeof userId !== "string" || userId.trim() === "") {
      return fail("invalid_expense", "Every share needs a person.", {
        expenseId,
      });
    }
    if (typeof shareMinor !== "bigint" || shareMinor < ZERO) {
      return fail(
        "invalid_expense",
        "A share must be a whole number of minor units, zero or more.",
        { expenseId, userId },
      );
    }
    if (people.has(userId)) {
      return fail(
        "duplicate_participant",
        "Someone has two shares in one expense.",
        { expenseId, userId },
      );
    }
    people.add(userId);
    sum += shareMinor;
  }
  if (sum !== expense.amountMinor) {
    return fail(
      "not_reconciled",
      "An expense's shares don't add up to its amount.",
      { expenseId },
    );
  }
  return null;
}

/** The household's counted expenses, each checked; or the first problem. */
function countedExpenses(input: BalanceInput): BalanceExpense[] | BalanceError {
  const seen = new Set<string>();
  const counted: BalanceExpense[] = [];
  for (const expense of input.expenses) {
    if (expense.householdId !== input.householdId) {
      return fail(
        "foreign_expense",
        "An expense from another household can't be part of these balances.",
        { expenseId: expense.id },
      );
    }
    if (seen.has(expense.id)) {
      return fail("duplicate_expense", "An expense is included twice.", {
        expenseId: expense.id,
      });
    }
    seen.add(expense.id);
    if (expense.deleted) continue; // D7
    const problem = checkExpense(expense);
    if (problem) return problem;
    counted.push(expense);
  }
  return counted;
}

// ---------------------------------------------------------------------------
// The calculation
// ---------------------------------------------------------------------------

/**
 * Everyone's balance and who owes whom, from the household's records.
 * Active members come first in the order given; anyone else who paid for or
 * shares a counted expense (someone who has left) follows, by id. Pairs are
 * largest first, then by ids, like the database.
 */
export function computeBalances(input: BalanceInput): BalanceResult {
  const counted = countedExpenses(input);
  if (!Array.isArray(counted)) return counted;

  const people = new Map<string, PersonBalance>();
  const person = (userId: string) => {
    let entry = people.get(userId);
    if (!entry) {
      entry = {
        userId,
        paidMinor: ZERO,
        shareMinor: ZERO,
        netMinor: ZERO,
        paidCount: 0,
        shareCount: 0,
      };
      people.set(userId, entry);
    }
    return entry;
  };
  for (const userId of input.memberIds) person(userId);
  const memberCount = people.size;

  // Keyed by the two ids in order; lowOwes > 0 means the lower id owes.
  const pairs = new Map<
    string,
    { low: string; high: string; lowOwes: bigint }
  >();
  let totalMinor = ZERO;

  for (const expense of counted) {
    totalMinor += expense.amountMinor;
    const payer = person(expense.paidBy);
    payer.paidMinor += expense.amountMinor;
    payer.paidCount += 1;

    for (const { userId, shareMinor } of expense.shares) {
      const participant = person(userId);
      participant.shareMinor += shareMinor;
      participant.shareCount += 1;
      // The payer's own share isn't owed to anyone.
      if (userId === expense.paidBy || shareMinor === ZERO) continue;
      const [low, high] =
        compareIds(userId, expense.paidBy) < 0
          ? [userId, expense.paidBy]
          : [expense.paidBy, userId];
      const key = JSON.stringify([low, high]);
      const pair = pairs.get(key) ?? { low, high, lowOwes: ZERO };
      pair.lowOwes += userId === low ? shareMinor : -shareMinor;
      pairs.set(key, pair);
    }
  }

  for (const entry of people.values()) {
    entry.netMinor = entry.paidMinor - entry.shareMinor;
  }
  const all = [...people.values()];
  const others = all
    .slice(memberCount)
    .sort((a, b) => compareIds(a.userId, b.userId));

  return {
    ok: true,
    expenseCount: counted.length,
    totalMinor,
    people: [...all.slice(0, memberCount), ...others],
    pairs: [...pairs.values()]
      .filter((pair) => pair.lowOwes !== ZERO)
      .sort((a, b) => {
        const left = a.lowOwes < ZERO ? -a.lowOwes : a.lowOwes;
        const right = b.lowOwes < ZERO ? -b.lowOwes : b.lowOwes;
        if (left !== right) return left > right ? -1 : 1;
        return compareIds(a.low, b.low) || compareIds(a.high, b.high);
      })
      .map(({ low, high, lowOwes }) =>
        lowOwes > ZERO
          ? { debtorId: low, creditorId: high, amountMinor: lowOwes }
          : { debtorId: high, creditorId: low, amountMinor: -lowOwes },
      ),
  };
}

/**
 * The counted expenses behind one person's balance, in input order: the ones
 * they paid for or have a share in, each with what it does to their balance
 * and who that's with.
 */
export function entriesFor(
  input: BalanceInput,
  userId: string,
): BalanceEntry[] | BalanceError {
  const counted = countedExpenses(input);
  if (!Array.isArray(counted)) return counted;

  const entries: BalanceEntry[] = [];
  for (const expense of counted) {
    const mine = expense.shares.find((share) => share.userId === userId);
    const paid = expense.paidBy === userId;
    if (!paid && !mine) continue;

    const paidMinor = paid ? expense.amountMinor : ZERO;
    const shareMinor = mine ? mine.shareMinor : ZERO;
    let counterparts: Counterpart[] = [];
    if (paid) {
      counterparts = expense.shares
        .filter((share) => share.userId !== userId && share.shareMinor > ZERO)
        .map((share) => ({ userId: share.userId, minor: share.shareMinor }))
        .sort((a, b) => compareIds(a.userId, b.userId));
    } else if (shareMinor > ZERO) {
      counterparts = [{ userId: expense.paidBy, minor: -shareMinor }];
    }
    entries.push({
      expenseId: expense.id,
      paidMinor,
      shareMinor,
      netMinor: paidMinor - shareMinor,
      counterparts,
    });
  }
  return entries;
}

/**
 * One person's pairs, from their side: `minor` is positive when the other
 * person owes them, negative when they owe the other person.
 */
export function pairsFor(
  pairs: PairBalance[],
  userId: string,
): { otherId: string; minor: bigint }[] {
  return pairs.flatMap((pair) =>
    pair.creditorId === userId
      ? [{ otherId: pair.debtorId, minor: pair.amountMinor }]
      : pair.debtorId === userId
        ? [{ otherId: pair.creditorId, minor: -pair.amountMinor }]
        : [],
  );
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * Checks everything that must hold before balances are shown: each balance is
 * paid − shares; the balances add up to exactly zero; payments and shares each
 * add up to the total spent; and who owes whom adds up to each balance.
 */
export function checkBalances(balances: Balances): BalanceCheck {
  const ids = new Set<string>();
  let paid = ZERO;
  let share = ZERO;
  let net = ZERO;

  for (const entry of balances.people) {
    if (ids.has(entry.userId)) {
      return fail("duplicate_person", "Someone is listed twice.", {
        userId: entry.userId,
      });
    }
    ids.add(entry.userId);
    if (
      entry.paidMinor < ZERO ||
      entry.shareMinor < ZERO ||
      entry.netMinor !== entry.paidMinor - entry.shareMinor
    ) {
      return fail(
        "net_mismatch",
        "A balance isn't what that person paid minus their share.",
        { userId: entry.userId },
      );
    }
    paid += entry.paidMinor;
    share += entry.shareMinor;
    net += entry.netMinor;
  }

  if (net !== ZERO) {
    return fail("not_zero_sum", "The balances don't add up to zero.");
  }
  if (
    balances.totalMinor < ZERO ||
    paid !== balances.totalMinor ||
    share !== balances.totalMinor ||
    (balances.expenseCount === 0) !== (balances.totalMinor === ZERO)
  ) {
    return fail(
      "totals_mismatch",
      "What people paid and their shares don't both add up to the total spent.",
    );
  }

  const seen = new Set<string>();
  const fromPairs = new Map<string, bigint>();
  for (const pair of balances.pairs) {
    const key = JSON.stringify(
      [pair.debtorId, pair.creditorId].sort(compareIds),
    );
    if (
      pair.debtorId === pair.creditorId ||
      pair.amountMinor <= ZERO ||
      !ids.has(pair.debtorId) ||
      !ids.has(pair.creditorId) ||
      seen.has(key)
    ) {
      return fail("invalid_pair", "Who owes whom isn't listed correctly.", {
        userId: pair.debtorId,
      });
    }
    seen.add(key);
    fromPairs.set(
      pair.creditorId,
      (fromPairs.get(pair.creditorId) ?? ZERO) + pair.amountMinor,
    );
    fromPairs.set(
      pair.debtorId,
      (fromPairs.get(pair.debtorId) ?? ZERO) - pair.amountMinor,
    );
  }
  for (const entry of balances.people) {
    if ((fromPairs.get(entry.userId) ?? ZERO) !== entry.netMinor) {
      return fail(
        "pairs_mismatch",
        "Who owes whom doesn't add up to someone's balance.",
        { userId: entry.userId },
      );
    }
  }
  return { ok: true };
}

/**
 * Checks the expenses listed behind one person's balance. Each entry must be
 * paid − share and add up across its counterparts. When the list is complete,
 * the entries must also add up to the person's paid, share and balance, and to
 * every pair they're in.
 */
export function checkEntries(
  person: PersonBalance,
  pairs: PairBalance[],
  entries: BalanceEntry[],
  { complete }: { complete: boolean },
): BalanceCheck {
  const seen = new Set<string>();
  const withOthers = new Map<string, bigint>();
  let paid = ZERO;
  let share = ZERO;
  let net = ZERO;

  for (const entry of entries) {
    const expenseId = entry.expenseId;
    if (seen.has(expenseId)) {
      return fail("entries_mismatch", "An expense is listed twice.", {
        expenseId,
      });
    }
    seen.add(expenseId);
    const counterpartTotal = entry.counterparts.reduce(
      (sum, c) => sum + c.minor,
      ZERO,
    );
    if (
      entry.paidMinor < ZERO ||
      entry.shareMinor < ZERO ||
      entry.netMinor !== entry.paidMinor - entry.shareMinor ||
      counterpartTotal !== entry.netMinor ||
      entry.counterparts.some((c) => c.userId === person.userId)
    ) {
      return fail(
        "entries_mismatch",
        "What an expense does to this balance doesn't add up.",
        { expenseId },
      );
    }
    paid += entry.paidMinor;
    share += entry.shareMinor;
    net += entry.netMinor;
    for (const c of entry.counterparts) {
      withOthers.set(c.userId, (withOthers.get(c.userId) ?? ZERO) + c.minor);
    }
  }

  if (!complete) return { ok: true };

  if (
    paid !== person.paidMinor ||
    share !== person.shareMinor ||
    net !== person.netMinor
  ) {
    return fail(
      "entries_mismatch",
      "The expenses listed don't add up to this balance.",
      { userId: person.userId },
    );
  }
  const fromPairs = new Map(
    pairsFor(pairs, person.userId).map((p) => [p.otherId, p.minor]),
  );
  for (const otherId of new Set([...fromPairs.keys(), ...withOthers.keys()])) {
    if (
      (fromPairs.get(otherId) ?? ZERO) !== (withOthers.get(otherId) ?? ZERO)
    ) {
      return fail(
        "entries_mismatch",
        "What's owed between two people doesn't match the expenses behind it.",
        { userId: otherId },
      );
    }
  }
  return { ok: true };
}
