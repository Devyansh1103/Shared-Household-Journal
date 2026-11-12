// Settlements (roadmap Phase 10, D9, ADR-005, ADR-007) as real signed-in
// users against the local stack: recording and voiding and who may do each,
// validation, forged and cross-household ids, idempotency, concurrent
// recordings and voids, D9's over-payment warning, immutability, the journal,
// balances against the TypeScript reference, leaving (D13, O8), people who
// have left (O9), the currency lock (D1), household deletion (D14) and access.
// Needs `npm run db:start`, then `npm run test:db`. Everything is created for
// this run and removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkBalances,
  checkEntries,
  computeBalances,
  entriesFor,
  settlementEntriesFor,
  type BalanceInput,
} from "@/domain/money/balances";
import { computeSplit, type SplitInput } from "@/domain/money/split";
import { parseBalancesPayload } from "@/lib/balances/parse";
import { sharesJson } from "@/lib/expenses/form";
import {
  adminClient,
  anonClient,
  signedInClient,
  type TypedClient,
} from "./support/local-supabase";

const PERMISSION_DENIED = "42501";
const CHECK_VIOLATION = "23514";
const INVALID_DATE = "22008";
const BALANCE_NOT_ZERO = "HJ006";
const CURRENCY_LOCKED = "HJ012";
const NO_SUCH_SETTLEMENT = "HJ014";
const ALREADY_VOIDED = "HJ015";
const NOT_TWO_MEMBERS = "HJ016";
const MORE_THAN_OWED = "HJ017";

const runId = randomUUID().slice(0, 8);
const password = `set-${randomUUID()}`;
const admin = adminClient();

type User = { id: string; name: string; client: TypedClient };
const users: User[] = [];
let olive: User, pat: User, quin: User, rae: User, xena: User;

function expectError(error: PostgrestError | null, code: string) {
  expect(error, `expected Postgres error ${code}`).not.toBeNull();
  expect(error?.code).toBe(code);
}

async function createUser(name: string): Promise<User> {
  const email = `set-${runId}-${name.toLowerCase()}@example.com`;
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

async function addExpense(
  creator: User,
  householdId: string,
  payer: string,
  input: SplitInput,
): Promise<string> {
  const split = computeSplit(input);
  if (!split.ok) throw new Error(split.error);
  const { data, error } = await creator.client.rpc("create_expense", {
    target_household_id: householdId,
    title: "Shared cost",
    amount: Number(input.total),
    expense_category: "other",
    spent_on: "2026-11-10",
    payer_id: payer,
    method: input.method,
    shares: sharesJson(split.shares),
  });
  if (error) throw error;
  return data;
}

const equal = (total: number, ...people: User[]): SplitInput => ({
  method: "equal",
  total: BigInt(total),
  participants: people.map((p) => p.id),
});

type RecordArgs = {
  household: string;
  payer: User | { id: string };
  recipient: User | { id: string };
  amount: number;
  date?: string;
  note?: string;
  key?: string;
  acknowledged?: number;
};

function recordArgs(args: RecordArgs) {
  return {
    target_household_id: args.household,
    payer_id: args.payer.id,
    recipient_id: args.recipient.id,
    amount: args.amount,
    paid_on: args.date ?? "2026-11-12",
    ...(args.note !== undefined ? { memo: args.note } : {}),
    ...(args.key ? { request_key: args.key } : {}),
    ...(args.acknowledged !== undefined
      ? { acknowledged_owed: args.acknowledged }
      : {}),
  };
}

function record(user: User, args: RecordArgs) {
  return user.client.rpc("record_settlement", recordArgs(args));
}

async function recordOk(user: User, args: RecordArgs): Promise<string> {
  const { data, error } = await record(user, args);
  if (error) throw error;
  return data;
}

/**
 * Records it, acknowledging D9's warning with the figure the database gives
 * when the amount is more than what's owed: what the app does when someone
 * presses "Record anyway".
 */
async function recordAnyway(user: User, args: RecordArgs): Promise<string> {
  const first = await record(user, args);
  if (!first.error) return first.data;
  expectError(first.error, MORE_THAN_OWED);
  return recordOk(user, { ...args, acknowledged: Number(first.error.details) });
}

function voidIt(user: User, settlementId: string) {
  return user.client.rpc("void_settlement", {
    target_settlement_id: settlementId,
  });
}

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

/** Each person's balance by name, e.g. { Olive: "30000", Pat: "0" }. */
async function netsOf(user: User, householdId: string) {
  const { people } = await balances(user, householdId);
  return Object.fromEntries(
    people.map((p) => [p.displayName, p.netMinor.toString()]),
  );
}

async function settlementRow(id: string) {
  const { data, error } = await admin
    .from("settlements")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

async function settlementCount(householdId: string) {
  const { count, error } = await admin
    .from("settlements")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId);
  if (error) throw error;
  return count ?? 0;
}

async function events(entityId: string) {
  const { data, error } = await admin
    .from("activity_events")
    .select("type, actor_id, entity_type, summary")
    .eq("entity_id", entityId)
    .order("created_at");
  if (error) throw error;
  return data;
}

/** Every expense, split and settlement of the household, past RLS. */
async function referenceInput(householdId: string): Promise<BalanceInput> {
  const [expenses, settlements, memberIds] = await Promise.all([
    admin
      .from("expenses")
      .select(
        "id, household_id, amount_minor, paid_by, deleted_at, expense_splits(user_id, share_minor)",
      )
      .eq("household_id", householdId),
    admin
      .from("settlements")
      .select("id, household_id, from_user, to_user, amount_minor, voided_at")
      .eq("household_id", householdId),
    joinOrder(householdId),
  ]);
  if (expenses.error) throw expenses.error;
  if (settlements.error) throw settlements.error;
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
    settlements: settlements.data.map((s) => ({
      id: s.id,
      householdId: s.household_id,
      fromUserId: s.from_user,
      toUserId: s.to_user,
      amountMinor: BigInt(s.amount_minor),
      voided: s.voided_at !== null,
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

/** The brief's example: ₹900 paid by Olive, split between Olive, Pat and Quin. */
async function exampleHome(name: string) {
  const home = await household(olive, name);
  await join(olive, home, pat, quin);
  await addExpense(olive, home, olive.id, equal(90000, olive, pat, quin));
  return home;
}

beforeAll(async () => {
  [olive, pat, quin, rae, xena] = await Promise.all(
    ["Olive", "Pat", "Quin", "Rae", "Xena"].map(createUser),
  );
}, 60_000);

afterAll(async () => {
  const ids = users.map((u) => u.id);
  if (ids.length) {
    // Deleting a household cascades to its settlements (D14); nothing else
    // can delete one.
    await admin.from("households").delete().in("created_by", ids);
    await admin.from("profiles").delete().in("id", ids);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  }
});

describe("record_settlement (D9)", () => {
  it("records a payment by the payer, from the session, and journals it", async () => {
    const home = await exampleHome("Record home");
    expect(await netsOf(pat, home)).toEqual({
      Olive: "60000",
      Pat: "-30000",
      Quin: "-30000",
    });

    const id = await recordOk(pat, {
      household: home,
      payer: pat,
      recipient: olive,
      amount: 30000,
      note: "Rent share",
    });
    expect(await settlementRow(id)).toMatchObject({
      household_id: home,
      from_user: pat.id,
      to_user: olive.id,
      amount_minor: 30000,
      settled_on: "2026-11-12",
      note: "Rent share",
      recorded_by: pat.id,
      voided_at: null,
      voided_by: null,
    });

    // The brief: A +₹300, B ₹0, C −₹300. It counts straight away (D9 has
    // no pending state).
    expect(await netsOf(quin, home)).toEqual({
      Olive: "30000",
      Pat: "0",
      Quin: "-30000",
    });
    const after = await balances(quin, home);
    expect(after.pairs).toEqual([
      { debtorId: quin.id, creditorId: olive.id, amountMinor: BigInt(30000) },
    ]);
    expect(after).toMatchObject({
      settlementCount: 1,
      settlementTotalMinor: BigInt(30000),
      expenseCount: 1,
      totalMinor: BigInt(90000),
    });

    const [event] = await events(id);
    expect(event).toMatchObject({
      type: "settlement_recorded",
      entity_type: "settlement",
      actor_id: pat.id,
    });
    expect(event.summary).toMatchObject({
      after: {
        from_user: pat.id,
        to_user: olive.id,
        amount_minor: 30000,
        settled_on: "2026-11-12",
        note: "Rent share",
        recorded_by: pat.id,
      },
    });
  });

  it("lets the recipient record it too", async () => {
    const home = await exampleHome("Recipient home");
    const id = await recordOk(olive, {
      household: home,
      payer: quin,
      recipient: olive,
      amount: 10000,
    });
    expect(await settlementRow(id)).toMatchObject({
      from_user: quin.id,
      to_user: olive.id,
      recorded_by: olive.id,
    });
    expect((await netsOf(pat, home)).Quin).toBe("-20000");
  });

  it("refuses anyone who isn't the payer or the recipient, even the owner", async () => {
    const home = await exampleHome("Third party home");
    const before = await settlementCount(home);
    // Olive owns the household but didn't pay or receive this one.
    expectError(
      (
        await record(olive, {
          household: home,
          payer: pat,
          recipient: quin,
          amount: 100,
          acknowledged: 0,
        })
      ).error,
      PERMISSION_DENIED,
    );
    expectError(
      (
        await record(quin, {
          household: home,
          payer: pat,
          recipient: olive,
          amount: 100,
        })
      ).error,
      PERMISSION_DENIED,
    );
    // Someone from another household, and nobody signed in.
    expectError(
      (
        await record(xena, {
          household: home,
          payer: xena,
          recipient: olive,
          amount: 100,
        })
      ).error,
      PERMISSION_DENIED,
    );
    const anon = await anonClient().rpc(
      "record_settlement",
      recordArgs({
        household: home,
        payer: pat,
        recipient: olive,
        amount: 100,
      }),
    );
    expect(anon.error).not.toBeNull();
    expect(await settlementCount(home)).toBe(before);
  });
});

describe("validation", () => {
  let home: string;
  let otherHome: string;
  beforeAll(async () => {
    home = await exampleHome("Validation home");
    otherHome = await household(xena, "Elsewhere");
  });

  it("refuses amounts that are zero, negative or too large, and bad notes or dates", async () => {
    const before = await settlementCount(home);
    const attempt = (extra: Partial<RecordArgs>) =>
      record(pat, {
        household: home,
        payer: pat,
        recipient: olive,
        amount: 100,
        ...extra,
      });
    for (const amount of [0, -100, 1000000000000]) {
      expectError((await attempt({ amount })).error, CHECK_VIOLATION);
    }
    for (const note of ["", " padded ", "x".repeat(201)]) {
      expectError((await attempt({ note })).error, CHECK_VIOLATION);
    }
    expectError((await attempt({ date: "2026-02-30" })).error, INVALID_DATE);
    expect(await settlementCount(home)).toBe(before);
  });

  it("needs two different people who are both active members", async () => {
    const before = await settlementCount(home);
    // The same person on both sides.
    expectError(
      (
        await record(pat, {
          household: home,
          payer: pat,
          recipient: pat,
          amount: 100,
        })
      ).error,
      NOT_TWO_MEMBERS,
    );
    // A forged participant from another household.
    expectError(
      (
        await record(pat, {
          household: home,
          payer: pat,
          recipient: xena,
          amount: 100,
        })
      ).error,
      NOT_TWO_MEMBERS,
    );
    // An id that isn't anyone.
    expectError(
      (
        await record(pat, {
          household: home,
          payer: pat,
          recipient: { id: randomUUID() },
          amount: 100,
        })
      ).error,
      NOT_TWO_MEMBERS,
    );
    expect(await settlementCount(home)).toBe(before);
  });

  it("can't be pointed at a household the caller isn't in", async () => {
    // A forged household id: Pat isn't in Xena's household.
    expectError(
      (
        await record(pat, {
          household: otherHome,
          payer: pat,
          recipient: xena,
          amount: 100,
        })
      ).error,
      PERMISSION_DENIED,
    );
    expect(await settlementCount(otherHome)).toBe(0);
  });
});

describe("D9's warning: more than what's owed", () => {
  it("refuses until the caller has seen the figure, then allows it (D8)", async () => {
    const home = await exampleHome("Warning home");
    // Pat owes Olive ₹300; ₹500 is more than that.
    const first = await record(pat, {
      household: home,
      payer: pat,
      recipient: olive,
      amount: 50000,
    });
    expectError(first.error, MORE_THAN_OWED);
    expect(first.error?.details).toBe("30000");

    // Acknowledging a different figure doesn't count.
    expectError(
      (
        await record(pat, {
          household: home,
          payer: pat,
          recipient: olive,
          amount: 50000,
          acknowledged: 0,
        })
      ).error,
      MORE_THAN_OWED,
    );
    expect(await settlementCount(home)).toBe(0);

    await recordOk(pat, {
      household: home,
      payer: pat,
      recipient: olive,
      amount: 50000,
      acknowledged: 30000,
    });
    // Olive now owes Pat ₹200 (D8: "money owed back").
    expect(await netsOf(pat, home)).toEqual({
      Olive: "10000",
      Pat: "20000",
      Quin: "-30000",
    });

    // The other way round, the figure is negative: Olive owes Pat now.
    const reverse = await record(pat, {
      household: home,
      payer: pat,
      recipient: olive,
      amount: 100,
    });
    expectError(reverse.error, MORE_THAN_OWED);
    expect(reverse.error?.details).toBe("-20000");
  });

  it("needs no acknowledgement for a partial or exact payment", async () => {
    const home = await exampleHome("Partial home");
    await recordOk(quin, {
      household: home,
      payer: quin,
      recipient: olive,
      amount: 12345,
    });
    await recordOk(quin, {
      household: home,
      payer: quin,
      recipient: olive,
      amount: 30000 - 12345,
    });
    expect((await netsOf(olive, home)).Quin).toBe("0");
  });
});

describe("retries and concurrent requests", () => {
  it("returns the same settlement for a repeated request key, even at once", async () => {
    const home = await exampleHome("Retry home");
    const key = randomUUID();
    const args = {
      household: home,
      payer: pat,
      recipient: olive,
      amount: 30000,
      key,
    };
    const [a, b] = await Promise.all([
      recordOk(pat, args),
      recordOk(pat, args),
    ]);
    expect(b).toBe(a);
    expect(await recordOk(pat, args)).toBe(a);
    expect(await settlementCount(home)).toBe(1);
    // Counted once.
    expect((await netsOf(olive, home)).Pat).toBe("0");
  });

  it("lets only one of two people record the same payment at the same time", async () => {
    // Pat and Olive both record "Pat paid Olive ₹300" at once, with different
    // keys. Settlements in a household are recorded one at a time, so the
    // second sees the first and gets D9's warning instead of counting twice.
    const home = await exampleHome("Race home");
    const results = await Promise.all([
      record(pat, {
        household: home,
        payer: pat,
        recipient: olive,
        amount: 30000,
      }),
      record(olive, {
        household: home,
        payer: pat,
        recipient: olive,
        amount: 30000,
      }),
    ]);
    const ok = results.filter((r) => !r.error);
    const refused = results.filter((r) => r.error);
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expectError(refused[0].error, MORE_THAN_OWED);
    expect(refused[0].error?.details).toBe("0");
    expect(await settlementCount(home)).toBe(1);
    expect((await netsOf(quin, home)).Pat).toBe("0");
  });

  it("lets only one of two voids succeed", async () => {
    const home = await exampleHome("Void race home");
    const id = await recordOk(pat, {
      household: home,
      payer: pat,
      recipient: olive,
      amount: 30000,
    });
    const results = await Promise.all([voidIt(pat, id), voidIt(olive, id)]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expectError(results.find((r) => r.error)!.error, ALREADY_VOIDED);
    expect(
      (await events(id)).filter((e) => e.type === "settlement_voided"),
    ).toHaveLength(1);
  });

  it("leaves nothing behind when recording fails", async () => {
    const home = await exampleHome("Rollback home");
    const before = await admin
      .from("activity_events")
      .select("id", { count: "exact", head: true })
      .eq("household_id", home);
    expectError(
      (
        await record(pat, {
          household: home,
          payer: pat,
          recipient: olive,
          amount: 0,
        })
      ).error,
      CHECK_VIOLATION,
    );
    const after = await admin
      .from("activity_events")
      .select("id", { count: "exact", head: true })
      .eq("household_id", home);
    expect(after.count).toBe(before.count);
    expect(await settlementCount(home)).toBe(0);
  });
});

describe("void_settlement (D9, ADR-007)", () => {
  it("lets the payer, the recipient or the owner void, and nobody else", async () => {
    const home = await exampleHome("Void home");
    await join(olive, home, rae);
    // Paid by Pat to Quin: Pat, Quin and Olive (owner) may void; Rae may not.
    const make = () =>
      recordAnyway(pat, {
        household: home,
        payer: pat,
        recipient: quin,
        amount: 500,
      });

    const forRae = await make();
    expectError((await voidIt(rae, forRae)).error, PERMISSION_DENIED);
    expectError((await voidIt(xena, forRae)).error, NO_SUCH_SETTLEMENT);
    expect((await settlementRow(forRae)).voided_at).toBeNull();

    for (const voider of [pat, quin, olive]) {
      const id = await make();
      expect((await voidIt(voider, id)).error).toBeNull();
      expect(await settlementRow(id)).toMatchObject({ voided_by: voider.id });
    }
    expectError((await voidIt(olive, randomUUID())).error, NO_SUCH_SETTLEMENT);
  });

  it("keeps the record, journals it, and restores the balances exactly", async () => {
    const home = await exampleHome("Restore home");
    const before = await netsOf(pat, home);
    const id = await recordOk(pat, {
      household: home,
      payer: pat,
      recipient: olive,
      amount: 30000,
    });
    expect(await netsOf(pat, home)).not.toEqual(before);

    expect((await voidIt(olive, id)).error).toBeNull();
    expect(await netsOf(pat, home)).toEqual(before);
    const after = await balances(pat, home);
    expect(after.settlementCount).toBe(0);

    // Still there, readable by members, with who voided it and when.
    const visible = await quin.client
      .from("settlements")
      .select("amount_minor, voided_at, voided_by")
      .eq("id", id)
      .single();
    expect(visible.data).toMatchObject({
      amount_minor: 30000,
      voided_by: olive.id,
    });
    expect(visible.data?.voided_at).not.toBeNull();

    // Voided can't be voided again, and isn't counted again.
    expectError((await voidIt(pat, id)).error, ALREADY_VOIDED);
    expect((await events(id)).map((e) => [e.type, e.actor_id])).toEqual([
      ["settlement_recorded", pat.id],
      ["settlement_voided", olive.id],
    ]);
  });
});

describe("a settlement can't be changed or deleted", () => {
  let home: string;
  let id: string;
  beforeAll(async () => {
    home = await exampleHome("Locked home");
    id = await recordOk(pat, {
      household: home,
      payer: pat,
      recipient: olive,
      amount: 30000,
    });
  });

  it("not by signed-in users directly", async () => {
    const insert = await pat.client.from("settlements").insert({
      household_id: home,
      from_user: pat.id,
      to_user: olive.id,
      amount_minor: 100,
      settled_on: "2026-11-12",
      recorded_by: pat.id,
    });
    expectError(insert.error, PERMISSION_DENIED);
    const update = await pat.client
      .from("settlements")
      .update({ amount_minor: 1 })
      .eq("id", id);
    expectError(update.error, PERMISSION_DENIED);
    const unvoid = await olive.client
      .from("settlements")
      .update({ voided_at: new Date().toISOString(), voided_by: olive.id })
      .eq("id", id);
    expectError(unvoid.error, PERMISSION_DENIED);
    const del = await olive.client.from("settlements").delete().eq("id", id);
    expectError(del.error, PERMISSION_DENIED);
  });

  it("not even with the service role: only voiding, once", async () => {
    const amount = await admin
      .from("settlements")
      .update({ amount_minor: 1 })
      .eq("id", id);
    expectError(amount.error, PERMISSION_DENIED);
    const del = await admin.from("settlements").delete().eq("id", id);
    expectError(del.error, PERMISSION_DENIED);
    const half = await admin
      .from("settlements")
      .update({ voided_at: new Date().toISOString() })
      .eq("id", id);
    expect(half.error).not.toBeNull();
    expect((await settlementRow(id)).voided_at).toBeNull();

    expect((await voidIt(pat, id)).error).toBeNull();
    const unvoid = await admin
      .from("settlements")
      .update({ voided_at: null, voided_by: null })
      .eq("id", id);
    expectError(unvoid.error, PERMISSION_DENIED);
    expect((await settlementRow(id)).voided_at).not.toBeNull();
  });

  it("and the journal stays append-only", async () => {
    const tamper = await admin
      .from("activity_events")
      .delete()
      .eq("entity_id", id);
    expectError(tamper.error, PERMISSION_DENIED);
  });
});

describe("balances with settlements", () => {
  it("match the TypeScript reference with expenses, settlements, voids and deletes", async () => {
    const home = await household(olive, "Reference home");
    await join(olive, home, pat, quin, rae);
    const order = await joinOrder(home);
    const byId = new Map([olive, pat, quin, rae].map((u) => [u.id, u]));
    const rng = seeded(20261112);
    const pick = () => order[Math.floor(rng() * order.length)];

    const expenseIds: string[] = [];
    for (let c = 0; c < 16; c++) {
      const payer = pick();
      let chosen = order.filter(() => rng() < 0.6);
      if (chosen.length === 0) chosen = [payer];
      expenseIds.push(
        await addExpense(byId.get(payer)!, home, payer, {
          method: "equal",
          total: BigInt(1 + Math.floor(rng() * 500_000)),
          participants: chosen,
        }),
      );
    }
    const settlementIds: string[] = [];
    for (let c = 0; c < 14; c++) {
      const from = pick();
      let to = pick();
      while (to === from) to = pick();
      const recorder = byId.get(rng() < 0.5 ? from : to)!;
      settlementIds.push(
        await recordAnyway(recorder, {
          household: home,
          payer: { id: from },
          recipient: { id: to },
          amount: 1 + Math.floor(rng() * 300_000),
          key: randomUUID(),
        }),
      );
    }
    for (const id of settlementIds.slice(0, 4)) {
      expect((await voidIt(olive, id)).error).toBeNull();
    }
    // Deleting expenses after settlements is fine (D8).
    for (const id of expenseIds.slice(0, 3)) {
      const { error } = await olive.client.rpc("delete_expense", {
        target_expense_id: id,
      });
      expect(error).toBeNull();
    }

    const input = await referenceInput(home);
    const reference = computeBalances(input);
    expect(reference.ok).toBe(true);
    if (!reference.ok) return;

    const sql = await balances(pat, home);
    expect(sql).toMatchObject({
      expenseCount: reference.expenseCount,
      totalMinor: reference.totalMinor,
      settlementCount: 10,
      settlementTotalMinor: reference.settlementTotalMinor,
    });
    expect(reference.settlementCount).toBe(10);
    expect(
      sql.people.map((p) => ({
        userId: p.userId,
        paidMinor: p.paidMinor,
        shareMinor: p.shareMinor,
        settlementsPaidMinor: p.settlementsPaidMinor,
        settlementsReceivedMinor: p.settlementsReceivedMinor,
        netMinor: p.netMinor,
        paidCount: p.paidCount,
        shareCount: p.shareCount,
        settlementsPaidCount: p.settlementsPaidCount,
        settlementsReceivedCount: p.settlementsReceivedCount,
      })),
    ).toEqual(reference.people);
    expect(sql.pairs).toEqual(reference.pairs);

    for (const userId of order) {
      const focused = await balances(pat, home, userId);
      const expenses = entriesFor(input, userId);
      const payments = settlementEntriesFor(input, userId);
      if (!Array.isArray(expenses) || !Array.isArray(payments)) {
        throw new Error("reference entries failed");
      }
      expect(focused.settlementEntryCount).toBe(payments.length);
      const byPayment = (
        list: { settlementId: string; netMinor: bigint; amountMinor: bigint }[],
      ) =>
        new Map(list.map((p) => [p.settlementId, [p.amountMinor, p.netMinor]]));
      expect(byPayment(focused.settlementEntries)).toEqual(byPayment(payments));
      expect(focused.entryCount).toBe(expenses.length);
      const person = focused.people.find((p) => p.userId === userId)!;
      expect(
        checkEntries(person, focused.pairs, focused.entries, {
          complete: true,
          settlements: focused.settlementEntries,
        }),
      ).toEqual({ ok: true });
    }
  }, 120_000);

  it("never change an expense or its splits", async () => {
    const home = await exampleHome("Untouched home");
    const snapshot = async () =>
      (
        await admin
          .from("expenses")
          .select("*, expense_splits(*)")
          .eq("household_id", home)
      ).data;
    const before = await snapshot();
    const id = await recordOk(pat, {
      household: home,
      payer: pat,
      recipient: olive,
      amount: 30000,
    });
    expect(await snapshot()).toEqual(before);
    await voidIt(olive, id);
    expect(await snapshot()).toEqual(before);
  });

  it("show settlements even with no expenses left (D8)", async () => {
    const home = await household(olive, "Deleted home");
    await join(olive, home, pat);
    const expense = await addExpense(
      olive,
      home,
      olive.id,
      equal(2000, olive, pat),
    );
    await recordOk(pat, {
      household: home,
      payer: pat,
      recipient: olive,
      amount: 1000,
    });
    await olive.client.rpc("delete_expense", { target_expense_id: expense });
    const after = await balances(pat, home);
    expect(after).toMatchObject({ expenseCount: 0, settlementCount: 1 });
    expect(await netsOf(pat, home)).toEqual({ Olive: "-1000", Pat: "1000" });
  });
});

describe("leaving, and people who have left (D13, O8, O9)", () => {
  it("needs a zero balance including settlements; former members can't be in new ones", async () => {
    const home = await exampleHome("Leaving home");
    expectError(
      (await pat.client.rpc("leave_household", { target_household_id: home }))
        .error,
      BALANCE_NOT_ZERO,
    );
    const id = await recordOk(pat, {
      household: home,
      payer: pat,
      recipient: olive,
      amount: 30000,
    });
    // Settled up, so Pat can leave (D13).
    expect(
      (await pat.client.rpc("leave_household", { target_household_id: home }))
        .error,
    ).toBeNull();

    // O9 is open: a new settlement with Pat isn't possible.
    expectError(
      (
        await record(olive, {
          household: home,
          payer: { id: pat.id },
          recipient: olive,
          amount: 100,
          acknowledged: 0,
        })
      ).error,
      NOT_TWO_MEMBERS,
    );
    // Pat can't see the household's settlements any more.
    const outside = await pat.client
      .from("settlements")
      .select("id")
      .eq("household_id", home);
    expect(outside.data).toEqual([]);

    // D9 lets the recipient void it, which gives Pat, who has left, a
    // balance again (like deleting an expense, D24): shown as theirs, and
    // everything still adds up to zero.
    expect((await voidIt(olive, id)).error).toBeNull();
    const after = await balances(quin, home);
    expect(after.people.find((p) => p.userId === pat.id)).toMatchObject({
      isActive: false,
      netMinor: BigInt(-30000),
    });
  });

  it("lets the owner delete a household that has settlements once alone (D14)", async () => {
    const home = await household(olive, "Closing home");
    await join(olive, home, pat);
    await recordAnyway(pat, {
      household: home,
      payer: pat,
      recipient: olive,
      amount: 100,
    });
    await recordOk(olive, {
      household: home,
      payer: olive,
      recipient: pat,
      amount: 100,
    });
    expect(
      (await pat.client.rpc("leave_household", { target_household_id: home }))
        .error,
    ).toBeNull();
    expect(
      (
        await olive.client.rpc("delete_household", {
          target_household_id: home,
        })
      ).error,
    ).toBeNull();
    expect(await settlementCount(home)).toBe(0);
  });
});

describe("currency lock (D1)", () => {
  it("locks the currency once there's a settlement, even with no expenses", async () => {
    const home = await household(xena, "Currency home");
    await join(xena, home, rae);
    await recordAnyway(rae, {
      household: home,
      payer: rae,
      recipient: xena,
      amount: 500,
    });
    const change = await xena.client
      .from("households")
      .update({ currency_code: "JPY" })
      .eq("id", home);
    expectError(change.error, CURRENCY_LOCKED);
  });
});

describe("access", () => {
  let home: string;
  let id: string;
  beforeAll(async () => {
    home = await exampleHome("Private home");
    id = await recordOk(pat, {
      household: home,
      payer: pat,
      recipient: olive,
      amount: 30000,
    });
  });

  it("is limited to active members of the household", async () => {
    const mine = await quin.client
      .from("settlements")
      .select("id, household_id")
      .eq("id", id);
    expect(mine.data).toEqual([{ id, household_id: home }]);

    const theirs = await xena.client
      .from("settlements")
      .select("id")
      .eq("id", id);
    expect(theirs.data).toEqual([]);

    const anon = await anonClient().from("settlements").select("id").limit(1);
    expectError(anon.error, PERMISSION_DENIED);
  });

  it("can't void another household's settlement by changing the id", async () => {
    expectError((await voidIt(xena, id)).error, NO_SUCH_SETTLEMENT);
    expect((await settlementRow(id)).voided_at).toBeNull();
    const anon = await anonClient().rpc("void_settlement", {
      target_settlement_id: id,
    });
    expect(anon.error).not.toBeNull();
  });

  it("keeps the private helpers off the Data API", async () => {
    for (const fn of [
      "person_balances",
      "balance_pairs",
      "settlement_people",
    ]) {
      const { error } = await pat.client
        .schema("private" as never)
        .rpc(fn as never, { target_household_id: home } as never);
      expect(error?.code, fn).toBe("PGRST106");
    }
  });
});
