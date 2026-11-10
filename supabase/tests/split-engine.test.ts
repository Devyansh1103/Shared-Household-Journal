// Cross-checks the TypeScript split engine against the database (ADR-004):
// every split the engine produces is accepted by create_expense and stored
// exactly; splits that break the money invariants are refused. Also checks the
// ISO 4217 minor-unit rule for household currencies (D2).
// Needs the local stack: `npm run db:start`, then `npm run test:db`.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_AMOUNT_MINOR } from "@/domain/money/amount";
import { computeSplit, type SplitInput } from "@/domain/money/split";
import { sharesJson } from "@/lib/expenses/form";
import {
  adminClient,
  signedInClient,
  type TypedClient,
} from "./support/local-supabase";

const INVALID_SPLIT = "HJ008";
const CHECK_VIOLATION = "23514";

const runId = randomUUID().slice(0, 8);
const password = `split-${randomUUID()}`;
const admin = adminClient();

type User = { id: string; client: TypedClient };
const users: User[] = [];
let owner: User;
let householdId: string;
/** Active members as the database orders them (joined_at, user_id). */
let joinOrder: string[];

function expectError(error: PostgrestError | null, code: string) {
  expect(error, `expected Postgres error ${code}`).not.toBeNull();
  expect(error?.code).toBe(code);
}

async function createUser(name: string): Promise<User> {
  const email = `split-${runId}-${name}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  const user = {
    id: data.user.id,
    client: await signedInClient(email, password),
  };
  users.push(user);
  return user;
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

function saveExpense(
  title: string,
  method: "equal" | "percentage" | "custom",
  amount: bigint,
  shares: {
    user_id: string;
    share_minor: number;
    percentage_bp: number | null;
  }[],
) {
  return owner.client.rpc("create_expense", {
    target_household_id: householdId,
    title,
    amount: Number(amount),
    expense_category: "other",
    spent_on: "2026-11-10",
    payer_id: owner.id,
    method,
    shares,
  });
}

beforeAll(async () => {
  owner = await createUser("owner");
  const created = await owner.client.rpc("create_household", {
    household_name: `Split engine ${runId}`,
    currency: "INR",
    time_zone: "Asia/Kolkata",
  });
  if (created.error) throw created.error;
  householdId = created.data;

  const bytes = randomBytes(32);
  const invite = await owner.client.from("invitations").insert({
    household_id: householdId,
    token_hash: createHash("sha256").update(bytes).digest("hex"),
  });
  if (invite.error) throw invite.error;
  for (const name of ["b", "c", "d"]) {
    const member = await createUser(name);
    const joined = await member.client.rpc("accept_invite", {
      token: bytes.toString("base64url"),
    });
    if (joined.error) throw joined.error;
  }

  const { data, error } = await admin
    .from("household_members")
    .select("user_id")
    .eq("household_id", householdId)
    .is("left_at", null)
    .order("joined_at")
    .order("user_id");
  if (error) throw error;
  joinOrder = data.map((row) => row.user_id);
}, 60_000);

afterAll(async () => {
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await admin.from("households").delete().in("created_by", ids);
    await admin.from("profiles").delete().in("id", ids);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  }
});

describe("the database accepts exactly what the engine produces", () => {
  it("for generated equal, percentage and custom splits", async () => {
    const rng = seeded(42);
    const pick = <T>(items: T[]) => items[Math.floor(rng() * items.length)];
    const totals = [
      BigInt(1),
      BigInt(2),
      BigInt(3),
      BigInt(10),
      BigInt(100),
      BigInt(100000),
      BigInt(999999),
      MAX_AMOUNT_MINOR,
    ];

    for (let c = 0; c < 36; c++) {
      const method = (["equal", "percentage", "custom"] as const)[c % 3];
      const total =
        c < totals.length * 3
          ? totals[Math.floor(c / 3)]
          : BigInt(1 + Math.floor(rng() * 5_000_000));
      // A random non-empty subset of members, in join order.
      let chosen = joinOrder.filter(() => rng() < 0.6);
      if (chosen.length === 0) chosen = [pick(joinOrder)];

      let input: SplitInput;
      if (method === "equal") {
        input = { method, total, participants: chosen };
      } else if (method === "percentage") {
        let left = 10000;
        const participants = chosen.map((userId, i) => {
          const bp =
            i === chosen.length - 1 ? left : Math.floor(rng() * (left + 1));
          left -= bp;
          return { userId, basisPoints: bp };
        });
        input = { method, total, participants };
      } else {
        let left = total;
        const participants = chosen.map((userId, i) => {
          const share =
            i === chosen.length - 1
              ? left
              : BigInt(Math.floor(rng() * Number(left + BigInt(1))));
          left -= share;
          return { userId, shareMinor: share };
        });
        input = { method, total, participants };
      }

      const result = computeSplit(input);
      expect(result.ok, `case ${c}`).toBe(true);
      if (!result.ok) return;

      const { data: expenseId, error } = await saveExpense(
        `Case ${c}`,
        method,
        total,
        sharesJson(result.shares),
      );
      expect(error, `case ${c} (${method}, ${total})`).toBeNull();

      const { data: stored } = await admin
        .from("expense_splits")
        .select("user_id, share_minor, percentage_bp")
        .eq("expense_id", expenseId!);
      const byUser = new Map(stored?.map((s) => [s.user_id, s]));
      expect(byUser.size).toBe(result.shares.length);
      for (const share of result.shares) {
        expect(byUser.get(share.userId)).toEqual({
          user_id: share.userId,
          share_minor: Number(share.shareMinor),
          percentage_bp: share.percentageBp,
        });
      }
    }
  });
});

describe("the database refuses splits that break the invariants", () => {
  const [a, b, c] = [0, 1, 2];

  it("for equal splits more than one unit apart", async () => {
    // ₹0.10 three ways is 4, 3, 3; 5, 3, 2 reconciles but isn't equal.
    const { error } = await saveExpense("Unequal", "equal", BigInt(10), [
      { user_id: joinOrder[a], share_minor: 5, percentage_bp: null },
      { user_id: joinOrder[b], share_minor: 3, percentage_bp: null },
      { user_id: joinOrder[c], share_minor: 2, percentage_bp: null },
    ]);
    expectError(error, INVALID_SPLIT);
  });

  it("for percentage shares outside their exact percentage plus one unit", async () => {
    // ₹1.00 at 33.33 / 33.33 / 33.34% is 33, 33, 34.
    const { error } = await saveExpense(
      "Off percentage",
      "percentage",
      BigInt(100),
      [
        { user_id: joinOrder[a], share_minor: 35, percentage_bp: 3333 },
        { user_id: joinOrder[b], share_minor: 32, percentage_bp: 3333 },
        { user_id: joinOrder[c], share_minor: 33, percentage_bp: 3334 },
      ],
    );
    expectError(error, INVALID_SPLIT);
  });

  it("but tolerates a different placement of leftover units (the engine's job)", async () => {
    // Documented in docs/money.md: the database checks that shares reconcile
    // and stay within one unit of their exact value; *which* participants get
    // the leftover units is decided by the engine on the app's path.
    const canonical = computeSplit({
      method: "equal",
      total: BigInt(10),
      participants: [joinOrder[a], joinOrder[b], joinOrder[c]],
    });
    expect(
      canonical.ok && canonical.shares.map((s) => Number(s.shareMinor)),
    ).toEqual([4, 3, 3]);
    const { error } = await saveExpense(
      "Leftover elsewhere",
      "equal",
      BigInt(10),
      [
        { user_id: joinOrder[a], share_minor: 3, percentage_bp: null },
        { user_id: joinOrder[b], share_minor: 4, percentage_bp: null },
        { user_id: joinOrder[c], share_minor: 3, percentage_bp: null },
      ],
    );
    expect(error).toBeNull();
  });
});

describe("household currencies need an ISO 4217 minor unit (D2)", () => {
  it("refuses codes without one on create and on update", async () => {
    for (const currency of ["XDR", "XSU", "XAU", "XXX"]) {
      const { error } = await owner.client.rpc("create_household", {
        household_name: `No minor unit ${runId}`,
        currency,
        time_zone: "Asia/Kolkata",
      });
      expectError(error, CHECK_VIOLATION);
    }

    const fresh = await owner.client.rpc("create_household", {
      household_name: `Currency change ${runId}`,
      currency: "KWD",
      time_zone: "Asia/Kuwait",
    });
    expect(fresh.error).toBeNull();
    const update = await owner.client
      .from("households")
      .update({ currency_code: "XDR" })
      .eq("id", fresh.data!);
    expectError(update.error, CHECK_VIOLATION);
  });
});
