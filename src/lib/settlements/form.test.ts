import { describe, expect, it } from "vitest";
import {
  NOTE_MAX_LENGTH,
  readSettlementForm,
  validateSettlementForm,
  type RawSettlementForm,
} from "./form";

const ME = "11111111-1111-4111-8111-111111111111";
const OLIVE = "22222222-2222-4222-8222-222222222222";
const QUIN = "33333333-3333-4333-8333-333333333333";
/** Someone in another household: never in this household's member list. */
const OUTSIDER = "99999999-9999-4999-8999-999999999999";

const context = { viewerId: ME, memberIds: [OLIVE, ME, QUIN], exponent: 2 };

function form(overrides: Partial<RawSettlementForm> = {}): RawSettlementForm {
  return {
    otherUserId: OLIVE,
    direction: "paid",
    amount: "300",
    settledOn: "2026-11-12",
    note: "",
    ...overrides,
  };
}

function errorsFor(overrides: Partial<RawSettlementForm>, ctx = context) {
  const result = validateSettlementForm(form(overrides), ctx);
  return result.ok ? {} : result.fieldErrors;
}

describe("validateSettlementForm", () => {
  it("turns a payment the viewer made into payer and recipient", () => {
    expect(validateSettlementForm(form(), context)).toEqual({
      ok: true,
      settlement: {
        fromUserId: ME,
        toUserId: OLIVE,
        amountMinor: BigInt(30000),
        settledOn: "2026-11-12",
        note: null,
      },
    });
  });

  it("and one the viewer received the other way round", () => {
    const result = validateSettlementForm(
      form({ direction: "received", amount: "1,250.50", note: "  Rent  " }),
      context,
    );
    expect(result).toEqual({
      ok: true,
      settlement: {
        fromUserId: OLIVE,
        toUserId: ME,
        amountMinor: BigInt(125050),
        settledOn: "2026-11-12",
        note: "Rent",
      },
    });
  });

  it("refuses zero, negative and malformed amounts", () => {
    expect(errorsFor({ amount: "0" }).amount).toBe(
      "Enter an amount greater than zero.",
    );
    expect(errorsFor({ amount: "0.00" }).amount).toBe(
      "Enter an amount greater than zero.",
    );
    expect(errorsFor({ amount: "-300" }).amount).toMatch(
      /Enter an amount like/,
    );
    expect(errorsFor({ amount: "" }).amount).toBe("Enter an amount.");
    expect(errorsFor({ amount: "12,50" }).amount).toMatch(/dot for decimals/);
    expect(errorsFor({ amount: "1e3" }).amount).toMatch(/Enter an amount like/);
    expect(errorsFor({ amount: "9999999999999" }).amount).toBe(
      "That amount is too large.",
    );
  });

  it("refuses more decimal places than the currency has, never rounding", () => {
    expect(errorsFor({ amount: "300.001" }).amount).toBe(
      "Use at most 2 decimal places.",
    );
    expect(
      errorsFor({ amount: "300.5" }, { ...context, exponent: 0 }).amount,
    ).toBe("This currency has no decimal places. Enter a whole amount.");
    const kwd = validateSettlementForm(form({ amount: "1.005" }), {
      ...context,
      exponent: 3,
    });
    expect(kwd.ok && kwd.settlement.amountMinor).toBe(BigInt(1005));
  });

  it("refuses the viewer as the other person (payer and recipient must differ)", () => {
    expect(errorsFor({ otherUserId: ME }).otherUserId).toBe(
      "Choose someone other than yourself.",
    );
  });

  it("refuses ids that aren't active members, like another household's", () => {
    // The member list is read on the server, so a forged id is refused here
    // and again by record_settlement.
    expect(errorsFor({ otherUserId: OUTSIDER }).otherUserId).toBe(
      "Choose someone who's a member of this household.",
    );
    expect(errorsFor({ otherUserId: "not-a-uuid" }).otherUserId).toBe(
      "Choose someone who's a member of this household.",
    );
    // Someone who has left isn't in the list either (O9 is open).
    expect(
      errorsFor({ otherUserId: QUIN }, { ...context, memberIds: [OLIVE, ME] })
        .otherUserId,
    ).toBe("Choose someone who's a member of this household.");
  });

  it("requires every field except the note", () => {
    const result = validateSettlementForm(
      { otherUserId: "", direction: "", amount: "", settledOn: "", note: "" },
      context,
    );
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        otherUserId: "Choose who the payment was with.",
        direction: "Choose who paid whom.",
        amount: "Enter an amount.",
        settledOn: "Choose the date the money was paid.",
      },
    });
  });

  it("refuses an unknown direction and impossible dates", () => {
    expect(errorsFor({ direction: "lent" }).direction).toBe(
      "Choose who paid whom.",
    );
    for (const settledOn of ["2026-02-30", "12/11/2026", "1899-12-31"]) {
      expect(errorsFor({ settledOn }).settledOn, settledOn).toBe(
        "Choose the date the money was paid.",
      );
    }
  });

  it("keeps notes short and trimmed", () => {
    expect(errorsFor({ note: "x".repeat(NOTE_MAX_LENGTH + 1) }).note).toBe(
      "Use 200 characters or fewer.",
    );
    const padded = validateSettlementForm(
      form({ note: `  ${"x".repeat(NOTE_MAX_LENGTH)}  ` }),
      context,
    );
    expect(padded.ok && padded.settlement.note).toBe("x".repeat(200));
    const blank = validateSettlementForm(form({ note: "   " }), context);
    expect(blank.ok && blank.settlement.note).toBeNull();
  });
});

describe("readSettlementForm", () => {
  it("reads text fields and ignores anything else", () => {
    const data = new FormData();
    data.set("otherUserId", OLIVE);
    data.set("direction", "received");
    data.set("amount", "12");
    data.set("settledOn", "2026-11-12");
    data.set("note", "Cash");
    data.set("fromUserId", QUIN); // not a field: ids for the viewer come from the session
    data.set("householdId", "x");
    expect(readSettlementForm(data)).toEqual({
      otherUserId: OLIVE,
      direction: "received",
      amount: "12",
      settledOn: "2026-11-12",
      note: "Cash",
    });
    expect(readSettlementForm(new FormData())).toEqual({
      otherUserId: "",
      direction: "",
      amount: "",
      settledOn: "",
      note: "",
    });
  });
});
