// Balances (ADR-005) as real signed-in users against the local stack: the SQL
// function against the TypeScript reference, how balances follow expense
// changes, people who have left (D24), the rule for leaving (D13, O8),
// currencies (D1), access, and the reconciliation guard (HJ013).
// Needs `npm run db:start`, then `npm run test:db`. Everything is created for
// this run and removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_AMOUNT_MINOR } from "@/domain/money/amount";
import {
  checkBalances,
  checkEntries,
  computeBalances,
  entriesFor,
  type BalanceInput,
} from "@/domain/money/balances";
import { computeSplit, type SplitInput } from "@/domain/money/split";
import { parseBalancesPayload } from "@/lib/balances/parse";
import { sharesJson } from "@/lib/expenses/form";
import {
  adminClient,
  anonClient,
  psqlAsSuperuser,
  signedInClient,
  type TypedClient,
} from "./support/local-supabase";

const PERMISSION_DENIED = "42501";
const BALANCE_NOT_ZERO = "HJ006";
const NOT_ACTIVE_MEMBER = "HJ007";
const INVALID_SPLIT = "HJ008";
const CURRENCY_LOCKED = "HJ012";

const runId = randomUUID().slice(0, 8);
const password = `bal-${randomUUID()}`;
const admin = adminClient();

type User = { id: string; name: string; client: TypedClient };
const users: User[] = [];
let olive: User, pat: User, quin: User, rae: User, xena: User;

function expectError(error: PostgrestError | null, code: string) {
  expect(error, `expected Postgres error ${code}`).not.toBeNull();
  expect(error?.code).toBe(code);
}

async function createUser(name: string): Promise<User> {
  const email = `bal-${runId}-${name.toLowerCase()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  const user = {
    id: data.user.id,
    name,
    client: await signedInClient(email, password),
  };
  users.push(user);
  return user;
}

async function household(owner: User, name: string, currency = "INR") {
  const { data, error } = await owner.client.rpc("create_household", {
    household_name: `${name} ${runId}`,
    currency,
    time_zone: "Asia/Kolkata",
  });
  if (error) throw error;
  return data;
}

async function join(owner: User, householdId: string, ...members: User[]) {
  const bytes = randomBytes(32);
  const insert = await owner.client.from("invitations").insert({
    household_id: householdId,
    token_hash: createHash("sha256").update(bytes).digest("hex"),
  });
  if (insert.error) throw insert.error;
  for (const member of members) {
    const { error } = await member.client.rpc("accept_invite", {
      token: bytes.toString("base64url"),
    });
    if (error) throw error;
  }
}

/** Active members as Postgres orders them (joined_at, user_id). */
async function joinOrder(householdId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("household_members")
    .select("user_id")
    .eq("household_id", householdId)
    .is("left_at", null)
    .order("joined_at")
    .order("user_id");
  if (error) throw error;
  return data.map((row) => row.user_id);
}

function splitArgs(input: SplitInput) {
  const split = computeSplit(input);
  if (!split.ok) throw new Error(split.error);
  return {
    amount: Number(input.total),
    method: input.method,
    shares: sharesJson(split.shares),
  };
}

async function addExpense(
  creator: User,
  householdId: string,
  payer: string,
  input: SplitInput,
  title = "Shared cost",
): Promise<string> {
  const { data, error } = await creator.client.rpc("create_expense", {
    target_household_id: householdId,
    title,
    expense_category: "other",
    spent_on: "2026-11-10",
    payer_id: payer,
    ...splitArgs(input),
  });
  if (error) throw error;
  return data;
}

async function editExpense(
  editor: User,
  expenseId: string,
  payer: string,
  input: SplitInput,
) {
  const { error } = await editor.client.rpc("update_expense", {
    target_expense_id: expenseId,
    title: "Edited cost",
    expense_category: "other",
    spent_on: "2026-11-10",
    payer_id: payer,
    ...splitArgs(input),
  });
  return error;
}

const equal = (total: number, ...people: User[]): SplitInput => ({
  method: "equal",
  total: BigInt(total),
  participants: people.map((p) => p.id),
});

async function balances(user: User, householdId: string, focus?: string) {
  const { data, error } = await user.client.rpc("household_balances", {
    target_household_id: householdId,
    ...(focus ? { focus_user_id: focus } : {}),
  });
  if (error) throw error;
  const parsed = parseBalancesPayload(data);
  if (!parsed)
    throw new Error("household_balances returned an unexpected shape");
  expect(checkBalances(parsed)).toEqual({ ok: true });
  return parsed;
}

/** Each person's balance by name, e.g. { Olive: "60000", Pat: "-30000" }. */
async function netsOf(user: User, householdId: string) {
  const { people } = await balances(user, householdId);
  return Object.fromEntries(
    people.map((p) => [p.displayName, p.netMinor.toString()]),
  );
}

/** Every expense and split of the household, read past RLS, for the reference. */
async function referenceInput(householdId: string): Promise<BalanceInput> {
  const [expenses, memberIds] = await Promise.all([
    admin
      .from("expenses")
      .select(
        "id, household_id, amount_minor, paid_by, deleted_at, expense_splits(user_id, share_minor)",
      )
      .eq("household_id", householdId),
    joinOrder(householdId),
  ]);
  if (expenses.error) throw expenses.error;
  return {
    householdId,
    memberIds,
    expenses: expenses.data.map((e) => ({
      id: e.id,
      householdId: e.household_id,
      amountMinor: BigInt(e.amount_minor),
      paidBy: e.paid_by,
      deleted: e.deleted_at !== null,
      shares: e.expense_splits.map((s) => ({
        userId: s.user_id,
        shareMinor: BigInt(s.share_minor),
      })),
    })),
  };
}

/** Same seeded generator as the unit property tests (mulberry32). */
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

/** A random split between a random non-empty subset, in join order. */
function generatedSplit(
  rng: () => number,
  order: string[],
  c: number,
): SplitInput {
  const total =
    c % 11 === 0 ? MAX_AMOUNT_MINOR : BigInt(1 + Math.floor(rng() * 5_000_000));
  let chosen = order.filter(() => rng() < 0.6);
  if (chosen.length === 0) chosen = [order[Math.floor(rng() * order.length)]];
  const method = (["equal", "percentage", "custom"] as const)[c % 3];
  if (method === "equal") return { method, total, participants: chosen };
  if (method === "percentage") {
    let left = 10000;
    return {
      method,
      total,
      participants: chosen.map((userId, i) => {
        const bp =
          i === chosen.length - 1 ? left : Math.floor(rng() * (left + 1));
        left -= bp;
        return { userId, basisPoints: bp };
      }),
    };
  }
  let left = total;
  return {
    method,
    total,
    participants: chosen.map((userId, i) => {
      const share =
        i === chosen.length - 1
          ? left
          : BigInt(Math.floor(rng() * Number(left + BigInt(1))));
      left -= share;
      return { userId, shareMinor: share };
    }),
  };
}

beforeAll(async () => {
  [olive, pat, quin, rae, xena] = await Promise.all(
    ["Olive", "Pat", "Quin", "Rae", "Xena"].map(createUser),
  );
}, 60_000);

afterAll(async () => {
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await admin.from("households").delete().in("created_by", ids);
    await admin.from("profiles").delete().in("id", ids);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  }
});

describe("household_balances", () => {
  it("works out the brief's example: ₹900 paid by Olive, split three ways", async () => {
    const home = await household(olive, "Example home");
    await join(olive, home, pat, quin);
    const id = await addExpense(
      pat,
      home,
      olive.id,
      equal(90000, olive, pat, quin),
    );

    const { data, error } = await pat.client.rpc("household_balances", {
      target_household_id: home,
    });
    expect(error).toBeNull();
    // Money is text, never a JSON number.
    expect(data).toMatchObject({
      expense_count: 1,
      total_minor: "90000",
      people: [
        {
          user_id: olive.id,
          display_name: "Olive",
          is_active: true,
          paid_minor: "90000",
          share_minor: "30000",
          net_minor: "60000",
          paid_count: 1,
          share_count: 1,
        },
        { user_id: pat.id, net_minor: "-30000" },
        { user_id: quin.id, net_minor: "-30000" },
      ],
      entry_count: 0,
      entries: [],
    });
    const parsed = await balances(pat, home);
    expect(parsed.pairs).toEqual(
      expect.arrayContaining([
        { debtorId: pat.id, creditorId: olive.id, amountMinor: BigInt(30000) },
        { debtorId: quin.id, creditorId: olive.id, amountMinor: BigInt(30000) },
      ]),
    );
    expect(parsed.pairs).toHaveLength(2);

    // The expenses behind Olive's balance, and who each part is with.
    const focused = await balances(pat, home, olive.id);
    expect(focused.entryCount).toBe(1);
    expect(focused.entries).toEqual([
      {
        expenseId: id,
        description: "Shared cost",
        expenseDate: "2026-11-10",
        amountMinor: BigInt(90000),
        paidBy: olive.id,
        paidMinor: BigInt(90000),
        shareMinor: BigInt(30000),
        netMinor: BigInt(60000),
        counterparts: [pat.id, quin.id].sort().map((userId) => ({
          userId,
          minor: BigInt(30000),
        })),
      },
    ]);
  });

  it("matches the TypeScript reference on generated expenses, edits, deletes and restores", async () => {
    const home = await household(olive, "Reference home");
    await join(olive, home, pat, quin, rae);
    const order = await joinOrder(home);
    const byId = new Map([olive, pat, quin, rae].map((u) => [u.id, u]));
    const rng = seeded(20261110);
    const pick = () => order[Math.floor(rng() * order.length)];

    const ids: string[] = [];
    for (let c = 0; c < 30; c++) {
      const payer = pick();
      ids.push(
        await addExpense(
          byId.get(payer)!,
          home,
          payer,
          generatedSplit(rng, order, c),
          `Case ${c}`,
        ),
      );
    }
    // The owner edits some, deletes some and restores a few (D6, D7).
    for (const [i, id] of ids.slice(0, 8).entries()) {
      expect(
        await editExpense(olive, id, pick(), generatedSplit(rng, order, i + 1)),
      ).toBeNull();
    }
    for (const id of ids.slice(8, 14)) {
      const { error } = await olive.client.rpc("delete_expense", {
        target_expense_id: id,
      });
      expect(error).toBeNull();
    }
    for (const id of ids.slice(8, 10)) {
      const { error } = await olive.client.rpc("restore_expense", {
        target_expense_id: id,
      });
      expect(error).toBeNull();
    }

    const input = await referenceInput(home);
    const reference = computeBalances(input);
    expect(reference.ok).toBe(true);
    if (!reference.ok) return;

    const sql = await balances(pat, home);
    expect(sql.expenseCount).toBe(26);
    expect(sql.expenseCount).toBe(reference.expenseCount);
    expect(sql.totalMinor).toBe(reference.totalMinor);
    // Same people in the same order, with the same figures.
    expect(
      sql.people.map((p) => ({
        userId: p.userId,
        paidMinor: p.paidMinor,
        shareMinor: p.shareMinor,
        netMinor: p.netMinor,
        paidCount: p.paidCount,
        shareCount: p.shareCount,
      })),
    ).toEqual(reference.people);
    // Same pairs in the same order (largest first, then by ids).
    expect(sql.pairs).toEqual(reference.pairs);

    // The expenses behind each person's balance.
    for (const userId of order) {
      const focused = await balances(pat, home, userId);
      const expected = entriesFor(input, userId);
      if (!Array.isArray(expected)) throw new Error(expected.error);
      const byExpense = (
        entries: {
          expenseId: string;
          paidMinor: bigint;
          shareMinor: bigint;
          netMinor: bigint;
          counterparts: { userId: string; minor: bigint }[];
        }[],
      ) =>
        new Map(
          entries.map((e) => [
            e.expenseId,
            {
              paidMinor: e.paidMinor,
              shareMinor: e.shareMinor,
              netMinor: e.netMinor,
              counterparts: e.counterparts,
            },
          ]),
        );
      expect(focused.entryCount).toBe(expected.length);
      expect(byExpense(focused.entries)).toEqual(byExpense(expected));
      const person = focused.people.find((p) => p.userId === userId)!;
      expect(
        checkEntries(person, focused.pairs, focused.entries, {
          complete: true,
        }),
      ).toEqual({ ok: true });
    }
  }, 120_000);

  it("lists every active member, settled when they have no expenses", async () => {
    const home = await household(olive, "Quiet home");
    await join(olive, home, pat);
    const empty = await balances(pat, home);
    expect(empty).toMatchObject({
      expenseCount: 0,
      totalMinor: BigInt(0),
      pairs: [],
    });
    expect(empty.people.map((p) => [p.displayName, p.netMinor])).toEqual([
      ["Olive", BigInt(0)],
      ["Pat", BigInt(0)],
    ]);
  });
});

describe("balances follow expense changes", () => {
  it("for new, edited, re-paid, re-split, deleted and restored expenses", async () => {
    const home = await household(olive, "Changing home");
    await join(olive, home, pat, quin);
    expect(await netsOf(pat, home)).toEqual({
      Olive: "0",
      Pat: "0",
      Quin: "0",
    });

    const id = await addExpense(
      olive,
      home,
      olive.id,
      equal(90000, olive, pat, quin),
    );
    expect(await netsOf(pat, home)).toEqual({
      Olive: "60000",
      Pat: "-30000",
      Quin: "-30000",
    });

    // A new amount.
    expect(
      await editExpense(olive, id, olive.id, equal(120000, olive, pat, quin)),
    ).toBeNull();
    expect(await netsOf(pat, home)).toEqual({
      Olive: "80000",
      Pat: "-40000",
      Quin: "-40000",
    });

    // A different payer.
    expect(
      await editExpense(olive, id, pat.id, equal(120000, olive, pat, quin)),
    ).toBeNull();
    expect(await netsOf(pat, home)).toEqual({
      Olive: "-40000",
      Pat: "80000",
      Quin: "-40000",
    });

    // A different split: Olive drops out, Quin takes most of it.
    expect(
      await editExpense(olive, id, pat.id, {
        method: "custom",
        total: BigInt(120000),
        participants: [
          { userId: pat.id, shareMinor: BigInt(20000) },
          { userId: quin.id, shareMinor: BigInt(100000) },
        ],
      }),
    ).toBeNull();
    expect(await netsOf(pat, home)).toEqual({
      Olive: "0",
      Pat: "100000",
      Quin: "-100000",
    });

    // A failed edit changes nothing (one transaction).
    const { error } = await olive.client.rpc("update_expense", {
      target_expense_id: id,
      title: "Broken",
      amount: 120000,
      expense_category: "other",
      spent_on: "2026-11-10",
      payer_id: olive.id,
      method: "custom",
      shares: [{ user_id: olive.id, share_minor: 119999, percentage_bp: null }],
    });
    expectError(error, INVALID_SPLIT);
    expect(await netsOf(pat, home)).toEqual({
      Olive: "0",
      Pat: "100000",
      Quin: "-100000",
    });

    // Deleted: it stops counting (D7). Restored: it counts again.
    await olive.client.rpc("delete_expense", { target_expense_id: id });
    const deleted = await balances(pat, home);
    expect(deleted.expenseCount).toBe(0);
    expect(await netsOf(pat, home)).toEqual({
      Olive: "0",
      Pat: "0",
      Quin: "0",
    });
    await olive.client.rpc("restore_expense", { target_expense_id: id });
    expect(await netsOf(pat, home)).toEqual({
      Olive: "0",
      Pat: "100000",
      Quin: "-100000",
    });
  });
});

describe("people who have left (D13, D24)", () => {
  it("keep their history; deleting can change their balance, editing can't", async () => {
    const home = await household(olive, "Leaving home");
    await join(olive, home, pat, quin);
    // Quin pays ₹600 for Olive and Quin, then Olive pays ₹600 for both: even.
    const quinPaid = await addExpense(
      quin,
      home,
      quin.id,
      equal(60000, olive, quin),
    );
    const olivePaid = await addExpense(
      olive,
      home,
      olive.id,
      equal(60000, olive, quin),
    );
    expect(await netsOf(pat, home)).toEqual({
      Olive: "0",
      Pat: "0",
      Quin: "0",
    });

    // Quin's balance is zero, so Quin can leave (D13), and still appears.
    expect(
      (await quin.client.rpc("leave_household", { target_household_id: home }))
        .error,
    ).toBeNull();
    const after = await balances(pat, home);
    expect(after.people.find((p) => p.userId === quin.id)).toMatchObject({
      isActive: false,
      netMinor: BigInt(0),
      paidCount: 1,
      shareCount: 2,
    });

    // Quin can't see the household's balances any more.
    const outside = await quin.client.rpc("household_balances", {
      target_household_id: home,
    });
    expectError(outside.error, PERMISSION_DENIED);

    // Editing an expense Quin is in is refused in the database too (D24).
    expectError(
      await editExpense(olive, quinPaid, olive.id, equal(60000, olive, pat)),
      NOT_ACTIVE_MEMBER,
    );
    expectError(
      await editExpense(olive, olivePaid, olive.id, equal(60000, olive, pat)),
      NOT_ACTIVE_MEMBER,
    );
    expect(await netsOf(pat, home)).toEqual({
      Olive: "0",
      Pat: "0",
      Quin: "0",
    });

    // Deleting one is allowed (D24): Quin, who has left, is now owed ₹300,
    // shown as theirs, and everything still adds up to zero.
    expect(
      (
        await olive.client.rpc("delete_expense", {
          target_expense_id: olivePaid,
        })
      ).error,
    ).toBeNull();
    const changed = await balances(pat, home);
    expect(await netsOf(pat, home)).toEqual({
      Olive: "-30000",
      Pat: "0",
      Quin: "30000",
    });
    expect(changed.pairs).toEqual([
      { debtorId: olive.id, creditorId: quin.id, amountMinor: BigInt(30000) },
    ]);
    // Restoring it is refused while Quin is away (Phase 8).
    const restore = await olive.client.rpc("restore_expense", {
      target_expense_id: olivePaid,
    });
    expectError(restore.error, NOT_ACTIVE_MEMBER);

    // If Quin rejoins, the history carries on.
    await join(olive, home, quin);
    const rejoined = await balances(pat, home);
    expect(rejoined.people.find((p) => p.userId === quin.id)).toMatchObject({
      isActive: true,
      netMinor: BigInt(30000),
    });
  });
});

describe("leaving and removal use the same balance (D13, O8)", () => {
  it("refuses while the shown balance isn't zero, and allows it at zero", async () => {
    const home = await household(olive, "Rule home");
    await join(olive, home, pat, rae);
    await addExpense(olive, home, olive.id, equal(1000, olive, pat));

    const shown = await balances(olive, home);
    const net = (user: User) =>
      shown.people.find((p) => p.userId === user.id)!.netMinor;
    expect(net(pat)).toBe(BigInt(-500));
    expectError(
      (await pat.client.rpc("leave_household", { target_household_id: home }))
        .error,
      BALANCE_NOT_ZERO,
    );
    expect(net(rae)).toBe(BigInt(0));
    const removed = await olive.client.rpc("remove_member", {
      target_household_id: home,
      member_user_id: rae.id,
    });
    expect(removed.error).toBeNull();
    // Rae had no expenses, so after leaving Rae isn't listed at all.
    const after = await balances(olive, home);
    expect(after.people.map((p) => p.userId)).not.toContain(rae.id);
  });
});

describe("currencies (D1)", () => {
  it("calculates each household in its own currency and never mixes them", async () => {
    const yen = await household(xena, "Yen home", "JPY");
    const inr = await household(olive, "Rupee home");
    await addExpense(xena, yen, xena.id, equal(1500, xena));
    await addExpense(olive, inr, olive.id, equal(90000, olive));

    // JPY has no decimals: ¥1,500 is 1500 minor units.
    expect((await balances(xena, yen)).totalMinor).toBe(BigInt(1500));
    expect((await balances(olive, inr)).totalMinor).toBe(BigInt(90000));

    // The currency can't change once there are expenses, so a household's
    // balances are always in one currency.
    const change = await xena.client
      .from("households")
      .update({ currency_code: "INR" })
      .eq("id", yen);
    expectError(change.error, CURRENCY_LOCKED);
  });
});

describe("access", () => {
  let home: string;
  let other: string;

  beforeAll(async () => {
    home = await household(olive, "Private home");
    await join(olive, home, pat);
    await addExpense(olive, home, olive.id, equal(4000, olive, pat));
    other = await household(xena, "Other home");
  });

  it("is refused for non-members, other households and anonymous callers", async () => {
    expectError(
      (
        await xena.client.rpc("household_balances", {
          target_household_id: home,
        })
      ).error,
      PERMISSION_DENIED,
    );
    expectError(
      (
        await pat.client.rpc("household_balances", {
          target_household_id: other,
        })
      ).error,
      PERMISSION_DENIED,
    );
    expectError(
      (
        await xena.client.rpc("household_balances", {
          target_household_id: home,
          focus_user_id: olive.id,
        })
      ).error,
      PERMISSION_DENIED,
    );
    const anon = await anonClient().rpc("household_balances", {
      target_household_id: home,
    });
    expect(anon.error).not.toBeNull();
    expect(anon.data).toBeNull();
  });

  it("doesn't reveal anything about people outside the household", async () => {
    const focused = await balances(pat, home, xena.id);
    expect(focused.people.map((p) => p.userId)).not.toContain(xena.id);
    expect(focused.entryCount).toBe(0);
    expect(focused.entries).toEqual([]);
  });

  it("keeps the private helpers off the Data API", async () => {
    const { error } = await pat.client
      .schema("private" as never)
      .rpc("balance_people" as never, { target_household_id: home } as never);
    // PostgREST: the schema isn't one it exposes.
    expect(error?.code).toBe("PGRST106");
  });
});

describe("the reconciliation guard (HJ013)", () => {
  // Inside one transaction that is never committed, an expense whose shares
  // don't add up can exist: the deferred constraint triggers only run at
  // commit. Balances must refuse it, naming the expense, rather than use it.
  let home: string;
  beforeAll(async () => {
    home = await household(olive, "Guarded home");
    await join(olive, home, pat);
  });

  function asPat(statement: string, shares: string) {
    const broken = randomUUID();
    const result = psqlAsSuperuser(`
\\set VERBOSITY verbose
begin;
insert into public.expenses
  (id, household_id, description, amount_minor, category, expense_date, paid_by, split_method, created_by)
values
  ('${broken}', '${home}', 'Broken', 1000, 'other', '2026-11-10', '${olive.id}', 'custom', '${olive.id}');
${shares.replaceAll("$EXPENSE", broken)}
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${pat.id}","role":"authenticated"}', true);
${statement};
rollback;
`);
    return { broken, ...result };
  }

  /** One split of ₹9.99 for a ₹10.00 expense. */
  const oneUnitShort = () => `insert into public.expense_splits
  (expense_id, household_id, user_id, share_minor)
values ('$EXPENSE', '${home}', '${olive.id}', 999);`;

  it("refuses to calculate from an expense whose shares don't add up", () => {
    const { broken, status, stderr } = asPat(
      `select public.household_balances('${home}')`,
      oneUnitShort(),
    );
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/ERROR:\s+HJ013/);
    expect(stderr).toMatch(new RegExp(`DETAIL:\\s+${broken}`));
  });

  it("refuses an expense with no participants", () => {
    const { broken, stderr } = asPat(
      `select public.household_balances('${home}')`,
      "",
    );
    expect(stderr).toMatch(/ERROR:\s+HJ013/);
    expect(stderr).toMatch(new RegExp(`DETAIL:\\s+${broken}`));
  });

  it("applies to the rule for leaving too, and commits nothing", async () => {
    const { broken, stderr } = asPat(
      `select public.leave_household('${home}')`,
      oneUnitShort(),
    );
    expect(stderr).toMatch(/ERROR:\s+HJ013/);

    const { data } = await admin.from("expenses").select("id").eq("id", broken);
    expect(data).toEqual([]);
    const members = await joinOrder(home);
    expect(members).toContain(pat.id);
    // And with nothing broken, the same call path works.
    expect((await balances(pat, home)).expenseCount).toBe(0);
  });
});
