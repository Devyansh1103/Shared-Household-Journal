import { describe, expect, it } from "vitest";
import { parseBalancesPayload } from "./parse";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const E = "33333333-3333-4333-8333-333333333333";

/** What household_balances returns for ₹900 paid by A, split between A and B. */
function payload() {
  return {
    expense_count: 1,
    total_minor: "90000",
    people: [
      {
        user_id: A,
        display_name: "Olive",
        is_active: true,
        paid_minor: "90000",
        share_minor: "45000",
        net_minor: "45000",
        paid_count: 1,
        share_count: 1,
      },
      {
        user_id: B,
        display_name: null,
        is_active: false,
        paid_minor: "0",
        share_minor: "45000",
        net_minor: "-45000",
        paid_count: 0,
        share_count: 1,
      },
    ],
    pairs: [{ debtor_id: B, creditor_id: A, amount_minor: "45000" }],
    entry_count: 1,
    entries: [
      {
        expense_id: E,
        description: "Rent",
        expense_date: "2026-11-10",
        amount_minor: "90000",
        paid_by: A,
        paid_minor: "90000",
        share_minor: "45000",
        net_minor: "45000",
        counterparts: [{ user_id: B, minor: "45000" }],
      },
    ],
  };
}

describe("parseBalancesPayload", () => {
  it("reads money as exact BigInt values", () => {
    const parsed = parseBalancesPayload(payload());
    expect(parsed).toMatchObject({
      expenseCount: 1,
      totalMinor: BigInt(90000),
      pairs: [{ debtorId: B, creditorId: A, amountMinor: BigInt(45000) }],
      entryCount: 1,
    });
    expect(parsed?.people[1]).toEqual({
      userId: B,
      displayName: "Former member",
      isActive: false,
      paidMinor: BigInt(0),
      shareMinor: BigInt(45000),
      netMinor: BigInt(-45000),
      paidCount: 0,
      shareCount: 1,
    });
    expect(parsed?.entries[0]).toMatchObject({
      expenseId: E,
      expenseDate: "2026-11-10",
      counterparts: [{ userId: B, minor: BigInt(45000) }],
    });
  });

  it("stays exact far beyond JavaScript's safe-integer range", () => {
    const big = payload();
    big.total_minor = "9100000000000000001";
    expect(parseBalancesPayload(big)?.totalMinor).toBe(
      BigInt("9100000000000000001"),
    );
  });

  it("refuses money sent as a JSON number, a decimal or anything odd", () => {
    for (const bad of [90000, "900.00", "1e5", "+5", "01", "", " 5", null]) {
      const tampered = payload() as Record<string, unknown>;
      tampered.total_minor = bad;
      expect(parseBalancesPayload(tampered), String(bad)).toBeNull();
    }
  });

  it("refuses a payload with the wrong shape", () => {
    const badId = payload();
    badId.people[0].user_id = "not-a-uuid";
    expect(parseBalancesPayload(badId)).toBeNull();

    const badCount = payload();
    badCount.expense_count = -1;
    expect(parseBalancesPayload(badCount)).toBeNull();

    const badDate = payload();
    badDate.entries[0].expense_date = "10/11/2026";
    expect(parseBalancesPayload(badDate)).toBeNull();

    const missing = payload() as Record<string, unknown>;
    delete missing.pairs;
    expect(parseBalancesPayload(missing)).toBeNull();

    expect(parseBalancesPayload(null)).toBeNull();
    expect(parseBalancesPayload("{}")).toBeNull();
  });
});
