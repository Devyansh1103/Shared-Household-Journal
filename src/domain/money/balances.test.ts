import { describe, expect, it } from "vitest";
import { MAX_AMOUNT_MINOR } from "./amount";
import {
  balanceDirection,
  checkBalances,
  checkEntries,
  computeBalances,
  entriesFor,
  pairsFor,
  type BalanceExpense,
  type Balances,
} from "./balances";
import { computeSplit, type SplitInput } from "./split";

const H = "household-h";
const b = (value: number | string) => BigInt(value);

let sequence = 0;
/** An expense of household H; shares as { userId: minor units }. */
function expense(
  paidBy: string,
  amount: number | bigint,
  shares: Record<string, number | bigint>,
  extra: Partial<BalanceExpense> = {},
): BalanceExpense {
  sequence += 1;
  return {
    id: `e${sequence}`,
    householdId: H,
    amountMinor: BigInt(amount),
    paidBy,
    deleted: false,
    shares: Object.entries(shares).map(([userId, share]) => ({
      userId,
      shareMinor: BigInt(share),
    })),
    ...extra,
  };
}

/** An expense whose shares come from the split engine. */
function engineExpense(paidBy: string, input: SplitInput): BalanceExpense {
  const split = computeSplit(input);
  if (!split.ok) throw new Error(split.error);
  return expense(
    paidBy,
    input.total,
    Object.fromEntries(split.shares.map((s) => [s.userId, s.shareMinor])),
  );
}

function balancesOf(expenses: BalanceExpense[], memberIds = ["a", "b", "c"]) {
  const result = computeBalances({ householdId: H, memberIds, expenses });
  if (!result.ok) throw new Error(`${result.code}: ${result.error}`);
  return result;
}

const nets = (balances: Balances) =>
  Object.fromEntries(
    balances.people.map((p) => [p.userId, Number(p.netMinor)]),
  );
const pairList = (balances: Balances) =>
  balances.pairs.map(
    (p) => `${p.debtorId} owes ${p.creditorId} ${p.amountMinor}`,
  );

describe("computeBalances: worked examples", () => {
  it("matches the brief: ₹900 paid by A, split equally between three", () => {
    const result = balancesOf([
      expense("a", 90000, { a: 30000, b: 30000, c: 30000 }),
    ]);
    expect(result.people).toEqual([
      {
        userId: "a",
        paidMinor: b(90000),
        shareMinor: b(30000),
        netMinor: b(60000),
        paidCount: 1,
        shareCount: 1,
      },
      {
        userId: "b",
        paidMinor: b(0),
        shareMinor: b(30000),
        netMinor: b(-30000),
        paidCount: 0,
        shareCount: 1,
      },
      {
        userId: "c",
        paidMinor: b(0),
        shareMinor: b(30000),
        netMinor: b(-30000),
        paidCount: 0,
        shareCount: 1,
      },
    ]);
    expect(pairList(result)).toEqual(["b owes a 30000", "c owes a 30000"]);
    expect(result.totalMinor).toBe(b(90000));
    expect(result.expenseCount).toBe(1);
    expect(checkBalances(result)).toEqual({ ok: true });
  });

  it("one participant, the payer: their own share isn't owed to anyone", () => {
    const result = balancesOf([expense("a", 5000, { a: 5000 })]);
    expect(nets(result)).toEqual({ a: 0, b: 0, c: 0 });
    expect(result.people[0]).toMatchObject({
      paidMinor: b(5000),
      shareMinor: b(5000),
    });
    expect(result.pairs).toEqual([]);
  });

  it("one participant who isn't the payer owes them the whole amount", () => {
    const result = balancesOf([expense("a", 5000, { b: 5000 })]);
    expect(nets(result)).toEqual({ a: 5000, b: -5000, c: 0 });
    expect(pairList(result)).toEqual(["b owes a 5000"]);
  });

  it("an equal three-way split with a leftover unit (ADR-004)", () => {
    // ₹100.00 three ways is 33.34 / 33.33 / 33.33; b paid.
    const result = balancesOf([
      engineExpense("b", {
        method: "equal",
        total: b(10000),
        participants: ["a", "b", "c"],
      }),
    ]);
    expect(nets(result)).toEqual({ a: -3334, b: 6667, c: -3333 });
    expect(pairList(result)).toEqual(["a owes b 3334", "c owes b 3333"]);
  });

  it("an unequal percentage split", () => {
    // ₹1,000.00 at 50 / 30 / 20%, paid by c.
    const result = balancesOf([
      engineExpense("c", {
        method: "percentage",
        total: b(100000),
        participants: [
          { userId: "a", basisPoints: 5000 },
          { userId: "b", basisPoints: 3000 },
          { userId: "c", basisPoints: 2000 },
        ],
      }),
    ]);
    expect(nets(result)).toEqual({ a: -50000, b: -30000, c: 80000 });
    expect(pairList(result)).toEqual(["a owes c 50000", "b owes c 30000"]);
  });

  it("a custom split, with the payer left out and someone at ₹0", () => {
    const result = balancesOf([expense("a", 1000, { b: 0, c: 1000 })]);
    expect(nets(result)).toEqual({ a: 1000, b: 0, c: -1000 });
    expect(result.people[1]).toMatchObject({ shareCount: 1 });
    expect(pairList(result)).toEqual(["c owes a 1000"]);
  });

  it("several payers: what two people owe each other offsets, and nothing moves between pairs", () => {
    const result = balancesOf([
      // b and c each owe a 300
      expense("a", 900, { a: 300, b: 300, c: 300 }),
      // a owes b 150
      expense("b", 300, { a: 150, b: 150 }),
      // b owes c 300
      expense("c", 600, { b: 300, c: 300 }),
    ]);
    expect(nets(result)).toEqual({ a: 450, b: -450, c: 0 });
    // c is settled overall but still in two pairs: that's pairwise, not
    // simplified (debt simplification is Phase 21).
    expect(pairList(result)).toEqual([
      "c owes a 300",
      "b owes c 300",
      "b owes a 150",
    ]);
    expect(checkBalances(result)).toEqual({ ok: true });
  });

  it("lists members with nothing to their name as settled", () => {
    const result = balancesOf(
      [expense("a", 1000, { a: 500, b: 500 })],
      ["a", "b", "c", "d"],
    );
    expect(nets(result)).toEqual({ a: 500, b: -500, c: 0, d: 0 });
    expect(result.people.at(-1)).toEqual({
      userId: "d",
      paidMinor: b(0),
      shareMinor: b(0),
      netMinor: b(0),
      paidCount: 0,
      shareCount: 0,
    });
  });

  it("a fully settled household has no balances and no pairs", () => {
    const result = balancesOf([
      expense("a", 600, { a: 300, b: 300 }),
      expense("b", 600, { a: 300, b: 300 }),
    ]);
    expect(nets(result)).toEqual({ a: 0, b: 0, c: 0 });
    expect(result.pairs).toEqual([]);
    expect(result.totalMinor).toBe(b(1200));
    expect(result.people.map((p) => balanceDirection(p.netMinor))).toEqual([
      "settled",
      "settled",
      "settled",
    ]);
  });

  it("someone who has left still counts while they're in counted expenses (D13)", () => {
    // x isn't an active member any more.
    const result = balancesOf(
      [expense("x", 1000, { a: 500, x: 500 })],
      ["a", "b"],
    );
    expect(result.people.map((p) => p.userId)).toEqual(["a", "b", "x"]);
    expect(nets(result)).toEqual({ a: -500, b: 0, x: 500 });
    expect(checkBalances(result)).toEqual({ ok: true });
  });

  it("orders members as given, then anyone else by id; pairs largest first", () => {
    const result = balancesOf(
      [
        expense("z", 100, { c: 100 }),
        expense("y", 300, { b: 300 }),
        expense("y", 100, { a: 100 }),
      ],
      ["c", "b", "a"],
    );
    expect(result.people.map((p) => p.userId)).toEqual([
      "c",
      "b",
      "a",
      "y",
      "z",
    ]);
    expect(pairList(result)).toEqual([
      "b owes y 300",
      "a owes y 100",
      "c owes z 100",
    ]);
  });
});

describe("computeBalances: deleted expenses (D7)", () => {
  it("leaves deleted expenses out, and counts them again once restored", () => {
    const rent = expense("a", 3000, { a: 1000, b: 1000, c: 1000 });
    const deleted = balancesOf([{ ...rent, deleted: true }]);
    expect(nets(deleted)).toEqual({ a: 0, b: 0, c: 0 });
    expect(deleted.expenseCount).toBe(0);
    expect(deleted.totalMinor).toBe(b(0));

    const restored = balancesOf([{ ...rent, deleted: false }]);
    expect(nets(restored)).toEqual({ a: 2000, b: -1000, c: -1000 });
  });

  it("doesn't check deleted expenses, as they don't count", () => {
    const broken = expense("a", 1000, { a: 1 }, { deleted: true });
    expect(
      computeBalances({ householdId: H, memberIds: ["a"], expenses: [broken] })
        .ok,
    ).toBe(true);
  });
});

describe("financial invariants", () => {
  /** Same seeded generator as the split property tests (mulberry32). */
  function seeded(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generatedHousehold(rng: () => number) {
    const members = Array.from(
      { length: 2 + Math.floor(rng() * 5) },
      (_, i) => `m${i}`,
    );
    // Sometimes someone who has left is still in old expenses.
    const everyone = rng() < 0.3 ? [...members, "left1"] : members;
    const pick = () => everyone[Math.floor(rng() * everyone.length)];
    const expenses: BalanceExpense[] = [];
    const count = 1 + Math.floor(rng() * 40);
    for (let i = 0; i < count; i++) {
      const total =
        rng() < 0.05
          ? MAX_AMOUNT_MINOR
          : BigInt(1 + Math.floor(rng() * 10_000_000));
      let chosen = everyone.filter(() => rng() < 0.6);
      if (chosen.length === 0) chosen = [pick()];
      const method = (["equal", "percentage", "custom"] as const)[i % 3];
      let input: SplitInput;
      if (method === "equal") {
        input = { method, total, participants: chosen };
      } else if (method === "percentage") {
        let left = 10000;
        input = {
          method,
          total,
          participants: chosen.map((userId, j) => {
            const bp =
              j === chosen.length - 1 ? left : Math.floor(rng() * (left + 1));
            left -= bp;
            return { userId, basisPoints: bp };
          }),
        };
      } else {
        let left = total;
        input = {
          method,
          total,
          participants: chosen.map((userId, j) => {
            const share =
              j === chosen.length - 1
                ? left
                : BigInt(Math.floor(rng() * Number(left + BigInt(1))));
            left -= share;
            return { userId, shareMinor: share };
          }),
        };
      }
      expenses.push({
        ...engineExpense(pick(), input),
        deleted: rng() < 0.15,
      });
    }
    return { members, expenses };
  }

  it("hold for 1,000 generated households: zero sum, totals, pairs, entries", () => {
    const rng = seeded(20261110);
    for (let c = 0; c < 1000; c++) {
      const { members, expenses } = generatedHousehold(rng);
      const input = { householdId: H, memberIds: members, expenses };
      const result = computeBalances(input);
      expect(result.ok, `case ${c}`).toBe(true);
      if (!result.ok) return;
      expect(checkBalances(result), `case ${c}`).toEqual({ ok: true });

      // Independent tallies, straight from the records.
      const counted = expenses.filter((e) => !e.deleted);
      const total = counted.reduce((s, e) => s + e.amountMinor, b(0));
      expect(result.totalMinor).toBe(total);
      expect(result.expenseCount).toBe(counted.length);
      for (const person of result.people) {
        const paid = counted
          .filter((e) => e.paidBy === person.userId)
          .reduce((s, e) => s + e.amountMinor, b(0));
        const share = counted
          .flatMap((e) => e.shares)
          .filter((s) => s.userId === person.userId)
          .reduce((s, x) => s + x.shareMinor, b(0));
        expect(person.paidMinor).toBe(paid);
        expect(person.shareMinor).toBe(share);
        expect(person.netMinor).toBe(paid - share);

        const entries = entriesFor(input, person.userId);
        expect(Array.isArray(entries)).toBe(true);
        if (!Array.isArray(entries)) return;
        expect(
          checkEntries(person, result.pairs, entries, { complete: true }),
        ).toEqual({ ok: true });
      }
      expect(result.people.reduce((s, p) => s + p.netMinor, b(0))).toBe(b(0));

      // The same records in another order give the same balances.
      const shuffled = [...expenses].sort(() => rng() - 0.5);
      const again = computeBalances({ ...input, expenses: shuffled });
      expect(again).toEqual(result);
    }
  });

  it("stays exact beyond JavaScript's safe-integer range", () => {
    // 9,100 expenses at the maximum: the total is above 2^53.
    const expenses = Array.from({ length: 9100 }, () =>
      engineExpense("a", {
        method: "equal",
        total: MAX_AMOUNT_MINOR,
        participants: ["a", "b"],
      }),
    );
    const result = balancesOf(expenses, ["a", "b"]);
    const total = BigInt(9100) * MAX_AMOUNT_MINOR;
    expect(total > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(result.totalMinor).toBe(total);
    // 999,999,999,999 two ways: a's share is 500,000,000,000, b's one less.
    expect(result.people[0].netMinor).toBe(BigInt(9100) * b("499999999999"));
    expect(result.people[1].netMinor).toBe(-(BigInt(9100) * b("499999999999")));
    expect(checkBalances(result)).toEqual({ ok: true });
  });

  it("refuses an expense whose shares are one unit off either way, naming it", () => {
    for (const share of [999, 1001]) {
      const broken = expense("a", 1000, { a: share });
      expect(
        computeBalances({
          householdId: H,
          memberIds: ["a"],
          expenses: [broken],
        }),
      ).toMatchObject({
        ok: false,
        code: "not_reconciled",
        expenseId: broken.id,
      });
    }
  });

  it("refuses an expense included twice", () => {
    const rent = expense("a", 1000, { a: 1000 });
    expect(
      computeBalances({
        householdId: H,
        memberIds: ["a"],
        expenses: [rent, rent],
      }),
    ).toMatchObject({
      ok: false,
      code: "duplicate_expense",
      expenseId: rent.id,
    });
  });

  it("never combines households, and so never currencies (D1)", () => {
    // Each household has exactly one currency, so an expense from another
    // household could be in another currency: it's refused, not added.
    const inr = expense("a", 1000, { a: 1000 });
    const jpy = expense("a", 1000, { a: 1000 }, { householdId: "household-x" });
    expect(
      computeBalances({
        householdId: H,
        memberIds: ["a"],
        expenses: [inr, jpy],
      }),
    ).toMatchObject({ ok: false, code: "foreign_expense", expenseId: jpy.id });

    // Calculated per household, each stays in its own minor units.
    const x = computeBalances({
      householdId: "household-x",
      memberIds: ["a"],
      expenses: [jpy],
    });
    expect(x.ok && x.totalMinor).toBe(b(1000));
  });

  it("refuses allocations that aren't valid", () => {
    const cases: [BalanceExpense, string][] = [
      [expense("a", 1000, {}), "no_participants"],
      [expense("a", 1000, { a: 1100, b: -100 }), "invalid_expense"],
      [expense("a", 0, { a: 0 }), "invalid_expense"],
      [expense("", 1000, { a: 1000 }), "invalid_expense"],
      [
        {
          ...expense("a", 1000, {}),
          shares: [{ userId: "a", shareMinor: 1000 as unknown as bigint }],
        },
        "invalid_expense",
      ],
      [
        {
          ...expense("a", 1000, {}),
          shares: [
            { userId: "a", shareMinor: b(500) },
            { userId: "a", shareMinor: b(500) },
          ],
        },
        "duplicate_participant",
      ],
    ];
    for (const [broken, code] of cases) {
      expect(
        computeBalances({
          householdId: H,
          memberIds: ["a"],
          expenses: [broken],
        }),
        code,
      ).toMatchObject({ ok: false, code, expenseId: broken.id });
    }
  });
});

describe("checkBalances catches figures that don't add up", () => {
  const valid = () =>
    balancesOf([
      expense("a", 900, { a: 300, b: 300, c: 300 }),
      expense("b", 300, { a: 150, b: 150 }),
    ]);
  const code = (balances: Balances) => {
    const check = checkBalances(balances);
    return check.ok ? "ok" : check.code;
  };

  it("accepts real balances", () => {
    expect(code(valid())).toBe("ok");
  });

  it("refuses a balance that isn't paid − share", () => {
    const tampered = valid();
    tampered.people[0].netMinor += b(1);
    expect(code(tampered)).toBe("net_mismatch");
  });

  it("refuses balances that don't add up to zero", () => {
    const tampered = valid();
    tampered.people[0].paidMinor += b(1);
    tampered.people[0].netMinor += b(1);
    expect(code(tampered)).toBe("not_zero_sum");
  });

  it("refuses totals that don't match what people paid and their shares", () => {
    const tampered = valid();
    tampered.totalMinor += b(1);
    expect(code(tampered)).toBe("totals_mismatch");

    const both = valid();
    both.people[0].paidMinor += b(5);
    both.people[0].shareMinor += b(5);
    expect(code(both)).toBe("totals_mismatch");

    const counted = valid();
    counted.expenseCount = 0;
    expect(code(counted)).toBe("totals_mismatch");
  });

  it("refuses pairs that don't add up to the balances", () => {
    const tampered = valid();
    tampered.pairs[0].amountMinor += b(1);
    expect(code(tampered)).toBe("pairs_mismatch");

    const missing = valid();
    missing.pairs.pop();
    expect(code(missing)).toBe("pairs_mismatch");
  });

  it("refuses pairs that aren't listed correctly", () => {
    const twice = valid();
    twice.pairs.push({ ...twice.pairs[0] });
    expect(code(twice)).toBe("invalid_pair");

    const reversed = valid();
    const [first] = reversed.pairs;
    reversed.pairs.push({
      debtorId: first.creditorId,
      creditorId: first.debtorId,
      amountMinor: first.amountMinor,
    });
    expect(code(reversed)).toBe("invalid_pair");

    for (const pair of [
      { debtorId: "a", creditorId: "a", amountMinor: b(1) },
      { debtorId: "a", creditorId: "nobody", amountMinor: b(1) },
      { debtorId: "c", creditorId: "a", amountMinor: b(0) },
    ]) {
      const tampered = valid();
      tampered.pairs.push(pair);
      expect(code(tampered)).toBe("invalid_pair");
    }
  });

  it("refuses someone listed twice", () => {
    const tampered = valid();
    tampered.people.push({ ...tampered.people[2] });
    expect(code(tampered)).toBe("duplicate_person");
  });
});

describe("entriesFor and checkEntries: the expenses behind a balance", () => {
  const records = [
    expense("a", 900, { a: 300, b: 300, c: 300 }),
    expense("b", 300, { a: 150, b: 150 }),
    expense("c", 600, { b: 300, c: 300 }),
    expense("c", 100, { c: 100 }),
  ];
  const input = {
    householdId: H,
    memberIds: ["a", "b", "c"],
    expenses: records,
  };
  const balances = balancesOf(records);
  const person = (id: string) => balances.people.find((p) => p.userId === id)!;
  const entries = (id: string) => {
    const result = entriesFor(input, id);
    if (!Array.isArray(result)) throw new Error(result.error);
    return result;
  };

  it("lists each expense someone paid for or shares, with who it's with", () => {
    expect(entries("a")).toEqual([
      {
        expenseId: records[0].id,
        paidMinor: b(900),
        shareMinor: b(300),
        netMinor: b(600),
        counterparts: [
          { userId: "b", minor: b(300) },
          { userId: "c", minor: b(300) },
        ],
      },
      {
        expenseId: records[1].id,
        paidMinor: b(0),
        shareMinor: b(150),
        netMinor: b(-150),
        counterparts: [{ userId: "b", minor: b(-150) }],
      },
    ]);
    // c paid for and is the only person in the last expense: no effect.
    expect(entries("c").at(-1)).toMatchObject({
      netMinor: b(0),
      counterparts: [],
    });
  });

  it("add up to the person's balance and to each of their pairs", () => {
    for (const id of ["a", "b", "c"]) {
      expect(
        checkEntries(person(id), balances.pairs, entries(id), {
          complete: true,
        }),
      ).toEqual({ ok: true });
    }
    expect(pairsFor(balances.pairs, "a")).toEqual([
      { otherId: "c", minor: b(300) },
      { otherId: "b", minor: b(150) },
    ]);
  });

  it("catch an entry that doesn't add up, or a list that doesn't match", () => {
    const check = (list: ReturnType<typeof entries>, complete = true) => {
      const result = checkEntries(person("a"), balances.pairs, list, {
        complete,
      });
      return result.ok ? "ok" : result.code;
    };
    const tamperedNet = entries("a");
    tamperedNet[0].netMinor += b(1);
    expect(check(tamperedNet)).toBe("entries_mismatch");

    const tamperedCounterpart = entries("a");
    tamperedCounterpart[0].counterparts[0].minor += b(1);
    expect(check(tamperedCounterpart)).toBe("entries_mismatch");

    const self = entries("a");
    self[1].counterparts = [{ userId: "a", minor: b(-150) }];
    expect(check(self)).toBe("entries_mismatch");

    const twice = entries("a");
    twice.push(twice[0]);
    expect(check(twice)).toBe("entries_mismatch");

    // A missing expense breaks the totals, unless the list is known to be
    // only the newest ones.
    const partial = entries("a").slice(0, 1);
    expect(check(partial)).toBe("entries_mismatch");
    expect(check(partial, false)).toBe("ok");

    // Pairs that don't match the expenses behind them.
    const pairs = balances.pairs.map((p) => ({ ...p }));
    const moved = entries("a");
    moved[0].counterparts = [
      { userId: "b", minor: b(500) },
      { userId: "c", minor: b(100) },
    ];
    const result = checkEntries(person("a"), pairs, moved, { complete: true });
    expect(result).toMatchObject({ ok: false, code: "entries_mismatch" });
  });
});

describe("balances follow the expenses as they change", () => {
  const base = expense("a", 900, { a: 300, b: 300, c: 300 });

  it("a new expense changes the balances", () => {
    const before = balancesOf([base]);
    const after = balancesOf([base, expense("b", 600, { b: 300, c: 300 })]);
    expect(nets(before)).toEqual({ a: 600, b: -300, c: -300 });
    expect(nets(after)).toEqual({ a: 600, b: 0, c: -600 });
  });

  it("an edited amount changes them", () => {
    const edited = {
      ...base,
      amountMinor: b(1200),
      shares: base.shares.map((s) => ({ ...s, shareMinor: b(400) })),
    };
    expect(nets(balancesOf([edited]))).toEqual({ a: 800, b: -400, c: -400 });
  });

  it("a different payer changes them", () => {
    expect(nets(balancesOf([{ ...base, paidBy: "c" }]))).toEqual({
      a: -300,
      b: -300,
      c: 600,
    });
  });

  it("a different split changes them", () => {
    const resplit = {
      ...base,
      shares: [
        { userId: "a", shareMinor: b(0) },
        { userId: "b", shareMinor: b(900) },
      ],
    };
    const result = balancesOf([resplit]);
    expect(nets(result)).toEqual({ a: 900, b: -900, c: 0 });
    expect(pairList(result)).toEqual(["b owes a 900"]);
  });

  it("a deleted expense stops counting", () => {
    expect(nets(balancesOf([{ ...base, deleted: true }]))).toEqual({
      a: 0,
      b: 0,
      c: 0,
    });
  });
});

describe("balanceDirection: the sign convention", () => {
  it("positive is owed, negative owes, zero is settled", () => {
    expect(balanceDirection(b(1))).toBe("owed");
    expect(balanceDirection(b(-1))).toBe("owes");
    expect(balanceDirection(b(0))).toBe("settled");
  });
});
