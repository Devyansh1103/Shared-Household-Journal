// Balances (ADR-005): derived from the expense and settlement records every
// time, never stored.
//
// This is the TypeScript reference implementation. The app shows what
// Postgres calculates (public.household_balances); the database tests
// cross-check the two on generated data, and checkBalances / checkEntries
// verify the invariants of whatever is about to be shown, wherever it came
// from.
//
// Sign convention, used everywhere:
//   net = paid − shares + settlements paid − settlements received
//   positive → the person should get money back (others owe them)
//   negative → the person owes money
//   zero     → settled up
//
// Pairs: each participant owes the payer their share, and a settlement from A
// to B that isn't voided reduces what A owes B (roadmap Phase 10, D9).
// Between two people the directions offset. Nothing moves between pairs:
// that would be debt simplification (Phase 21).
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

/** A payment recorded between two people, outside the app (D9). */
export type BalanceSettlement = {
  id: string;
  householdId: string;
  /** Paid the money. */
  fromUserId: string;
  /** Received it. */
  toUserId: string;
  amountMinor: bigint;
  /** Voided (D9): kept for the record, but it doesn't count. */
  voided: boolean;
};

export type BalanceInput = {
  householdId: string;
  /** Active members, listed even with nothing to their name (join order). */
  memberIds: string[];
  expenses: BalanceExpense[];
  /** Recorded settlements, voided ones included. None if left out. */
  settlements?: BalanceSettlement[];
};

export type PersonBalance = {
  userId: string;
  /** The whole amount of every counted expense this person paid for. */
  paidMinor: bigint;
  /** This person's shares of counted expenses. */
  shareMinor: bigint;
  /** Counted settlements this person paid. */
  settlementsPaidMinor: bigint;
  /** Counted settlements this person received. */
  settlementsReceivedMinor: bigint;
  /**
   * paid − shares + settlements paid − settlements received: positive means
   * owed money, negative means owes money.
   */
  netMinor: bigint;
  /** Counted expenses this person paid for. */
  paidCount: number;
  /** Counted expenses this person has a share in (a ₹0 share included). */
  shareCount: number;
  /** Counted settlements this person paid. */
  settlementsPaidCount: number;
  /** Counted settlements this person received. */
  settlementsReceivedCount: number;
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
  /** Counted (not voided) settlements. */
  settlementCount: number;
  /** What the counted settlements add up to. */
  settlementTotalMinor: bigint;
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

/** How one counted settlement moves one person's balance. */
export type SettlementEntry = {
  settlementId: string;
  fromUserId: string;
  toUserId: string;
  amountMinor: bigint;
  /**
   * + the amount when this person paid it (their balance goes up), − the
   * amount when they received it. Seen from the other person, the same
   * figure is what they owe this person: a counterpart.
   */
  netMinor: bigint;
};

/** Machine-readable reasons; messages are for people. */
export type BalanceErrorCode =
  // Input to computeBalances / entriesFor / settlementEntriesFor
  | "foreign_expense"
  | "duplicate_expense"
  | "invalid_expense"
  | "no_participants"
  | "duplicate_participant"
  | "not_reconciled"
  | "foreign_settlement"
  | "duplicate_settlement"
  | "invalid_settlement"
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
  /** The settlement the problem is in, when there is one. */
  settlementId?: string;
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
  about: { expenseId?: string; settlementId?: string; userId?: string } = {},
): BalanceError {
  return { ok: false, code, error, ...about };
}

/** Code-point order, the same order Postgres gives lowercase uuids. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
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
  if (!isId(expense.paidBy)) {
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
    if (!isId(userId)) {
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

/** One settlement's own rules: two different people, an amount above zero. */
function checkSettlement(settlement: BalanceSettlement): BalanceError | null {
  const settlementId = settlement.id;
  if (
    typeof settlement.amountMinor !== "bigint" ||
    settlement.amountMinor <= ZERO
  ) {
    return fail(
      "invalid_settlement",
      "A settlement amount must be a whole number of minor units above zero.",
      { settlementId },
    );
  }
  if (!isId(settlement.fromUserId) || !isId(settlement.toUserId)) {
    return fail(
      "invalid_settlement",
      "Every settlement needs the person who paid and the person who received it.",
      { settlementId },
    );
  }
  if (settlement.fromUserId === settlement.toUserId) {
    return fail(
      "invalid_settlement",
      "A settlement is between two different people.",
      { settlementId, userId: settlement.fromUserId },
    );
  }
  return null;
}

/** The household's counted settlements, each checked; or the first problem. */
function countedSettlements(
  input: BalanceInput,
): BalanceSettlement[] | BalanceError {
  const seen = new Set<string>();
  const counted: BalanceSettlement[] = [];
  for (const settlement of input.settlements ?? []) {
    if (settlement.householdId !== input.householdId) {
      return fail(
        "foreign_settlement",
        "A settlement from another household can't be part of these balances.",
        { settlementId: settlement.id },
      );
    }
    if (seen.has(settlement.id)) {
      return fail("duplicate_settlement", "A settlement is included twice.", {
        settlementId: settlement.id,
      });
    }
    seen.add(settlement.id);
    if (settlement.voided) continue; // D9
    const problem = checkSettlement(settlement);
    if (problem) return problem;
    counted.push(settlement);
  }
  return counted;
}

// ---------------------------------------------------------------------------
// The calculation
// ---------------------------------------------------------------------------

/**
 * Everyone's balance and who owes whom, from the household's records.
 * Active members come first in the order given; anyone else in a counted
 * expense or settlement (someone who has left) follows, by id. Pairs are
 * largest first, then by ids, like the database.
 */
export function computeBalances(input: BalanceInput): BalanceResult {
  const counted = countedExpenses(input);
  if (!Array.isArray(counted)) return counted;
  const settled = countedSettlements(input);
  if (!Array.isArray(settled)) return settled;

  const people = new Map<string, PersonBalance>();
  const person = (userId: string) => {
    let entry = people.get(userId);
    if (!entry) {
      entry = {
        userId,
        paidMinor: ZERO,
        shareMinor: ZERO,
        settlementsPaidMinor: ZERO,
        settlementsReceivedMinor: ZERO,
        netMinor: ZERO,
        paidCount: 0,
        shareCount: 0,
        settlementsPaidCount: 0,
        settlementsReceivedCount: 0,
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
  const owe = (debtor: string, creditor: string, minor: bigint) => {
    const [low, high] =
      compareIds(debtor, creditor) < 0
        ? [debtor, creditor]
        : [creditor, debtor];
    const key = JSON.stringify([low, high]);
    const pair = pairs.get(key) ?? { low, high, lowOwes: ZERO };
    pair.lowOwes += debtor === low ? minor : -minor;
    pairs.set(key, pair);
  };

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
      owe(userId, expense.paidBy, shareMinor);
    }
  }

  let settlementTotalMinor = ZERO;
  for (const settlement of settled) {
    settlementTotalMinor += settlement.amountMinor;
    const payer = person(settlement.fromUserId);
    payer.settlementsPaidMinor += settlement.amountMinor;
    payer.settlementsPaidCount += 1;
    const recipient = person(settlement.toUserId);
    recipient.settlementsReceivedMinor += settlement.amountMinor;
    recipient.settlementsReceivedCount += 1;
    // A settlement from A to B reduces what A owes B: the same as B owing A.
    owe(settlement.toUserId, settlement.fromUserId, settlement.amountMinor);
  }

  for (const entry of people.values()) {
    entry.netMinor =
      entry.paidMinor -
      entry.shareMinor +
      entry.settlementsPaidMinor -
      entry.settlementsReceivedMinor;
  }
  const all = [...people.values()];
  const others = all
    .slice(memberCount)
    .sort((a, b) => compareIds(a.userId, b.userId));

  return {
    ok: true,
    expenseCount: counted.length,
    totalMinor,
    settlementCount: settled.length,
    settlementTotalMinor,
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
 * The counted settlements behind one person's balance, in input order: the
 * ones they paid or received, each with what it does to their balance.
 */
export function settlementEntriesFor(
  input: BalanceInput,
  userId: string,
): SettlementEntry[] | BalanceError {
  const settled = countedSettlements(input);
  if (!Array.isArray(settled)) return settled;

  return settled
    .filter((s) => s.fromUserId === userId || s.toUserId === userId)
    .map((s) => ({
      settlementId: s.id,
      fromUserId: s.fromUserId,
      toUserId: s.toUserId,
      amountMinor: s.amountMinor,
      netMinor: s.fromUserId === userId ? s.amountMinor : -s.amountMinor,
    }));
}

/** The other person in a settlement, seen from `userId`. */
export function settlementOther(
  entry: Pick<SettlementEntry, "fromUserId" | "toUserId">,
  userId: string,
): string {
  return entry.fromUserId === userId ? entry.toUserId : entry.fromUserId;
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

/**
 * What `debtorId` owes `creditorId` right now, from the pairs: positive when
 * they owe, negative when it's the other way round, zero when they're even.
 */
export function owedMinor(
  pairs: PairBalance[],
  debtorId: string,
  creditorId: string,
): bigint {
  for (const pair of pairs) {
    if (pair.debtorId === debtorId && pair.creditorId === creditorId) {
      return pair.amountMinor;
    }
    if (pair.debtorId === creditorId && pair.creditorId === debtorId) {
      return -pair.amountMinor;
    }
  }
  return ZERO;
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * Checks everything that must hold before balances are shown: each balance is
 * paid − shares + settlements paid − settlements received; the balances add
 * up to exactly zero; payments and shares each add up to the total spent;
 * settlements paid and received each add up to the settlements recorded; and
 * who owes whom adds up to each balance.
 */
export function checkBalances(balances: Balances): BalanceCheck {
  const ids = new Set<string>();
  let paid = ZERO;
  let share = ZERO;
  let settlementsPaid = ZERO;
  let settlementsReceived = ZERO;
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
      entry.settlementsPaidMinor < ZERO ||
      entry.settlementsReceivedMinor < ZERO ||
      entry.netMinor !==
        entry.paidMinor -
          entry.shareMinor +
          entry.settlementsPaidMinor -
          entry.settlementsReceivedMinor
    ) {
      return fail(
        "net_mismatch",
        "A balance isn't what that person paid minus their share, plus what they paid back, minus what they were paid back.",
        { userId: entry.userId },
      );
    }
    paid += entry.paidMinor;
    share += entry.shareMinor;
    settlementsPaid += entry.settlementsPaidMinor;
    settlementsReceived += entry.settlementsReceivedMinor;
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
  if (
    balances.settlementTotalMinor < ZERO ||
    settlementsPaid !== balances.settlementTotalMinor ||
    settlementsReceived !== balances.settlementTotalMinor ||
    (balances.settlementCount === 0) !==
      (balances.settlementTotalMinor === ZERO)
  ) {
    return fail(
      "totals_mismatch",
      "What people paid back and were paid back don't both add up to the settlements recorded.",
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
 * Checks the expenses and settlements listed behind one person's balance.
 * Each expense entry must be paid − share and add up across its
 * counterparts; each settlement entry must be + its amount if they paid it,
 * − its amount if they received it. When both lists are complete, they must
 * also add up to the person's paid, share, settlements and balance, and to
 * every pair they're in.
 */
export function checkEntries(
  person: PersonBalance,
  pairs: PairBalance[],
  entries: BalanceEntry[],
  {
    complete,
    settlements = [],
  }: { complete: boolean; settlements?: SettlementEntry[] },
): BalanceCheck {
  const seen = new Set<string>();
  const withOthers = new Map<string, bigint>();
  const add = (otherId: string, minor: bigint) =>
    withOthers.set(otherId, (withOthers.get(otherId) ?? ZERO) + minor);
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
    for (const c of entry.counterparts) add(c.userId, c.minor);
  }

  const seenSettlements = new Set<string>();
  let settlementsPaid = ZERO;
  let settlementsReceived = ZERO;
  for (const entry of settlements) {
    const settlementId = entry.settlementId;
    if (seenSettlements.has(settlementId)) {
      return fail("entries_mismatch", "A settlement is listed twice.", {
        settlementId,
      });
    }
    seenSettlements.add(settlementId);
    const paidIt = entry.fromUserId === person.userId;
    const receivedIt = entry.toUserId === person.userId;
    if (
      entry.amountMinor <= ZERO ||
      paidIt === receivedIt ||
      entry.netMinor !== (paidIt ? entry.amountMinor : -entry.amountMinor)
    ) {
      return fail(
        "entries_mismatch",
        "What a settlement does to this balance doesn't add up.",
        { settlementId },
      );
    }
    if (paidIt) settlementsPaid += entry.amountMinor;
    else settlementsReceived += entry.amountMinor;
    net += entry.netMinor;
    add(settlementOther(entry, person.userId), entry.netMinor);
  }

  if (!complete) return { ok: true };

  if (
    paid !== person.paidMinor ||
    share !== person.shareMinor ||
    settlementsPaid !== person.settlementsPaidMinor ||
    settlementsReceived !== person.settlementsReceivedMinor ||
    net !== person.netMinor
  ) {
    return fail(
      "entries_mismatch",
      "The expenses and settlements listed don't add up to this balance.",
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
        "What's owed between two people doesn't match the records behind it.",
        { userId: otherId },
      );
    }
  }
  return { ok: true };
}
