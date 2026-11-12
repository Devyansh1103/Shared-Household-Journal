import { describe, expect, it } from "vitest";
import {
  outcomeSentence,
  overpaymentWarning,
  paymentSentence,
  paymentTitle,
  personSubject,
  recordedSentence,
  SETTLEMENT_NOTICE,
  settlementOutcome,
  standingSentence,
} from "./wording";

const b = (value: number) => BigInt(value);
const you = { you: true, name: "Pat" };
const olive = { you: false, name: "Olive" };
const quin = { you: false, name: "Quin" };

describe("the notice (D9)", () => {
  it("is exactly D9's wording", () => {
    expect(SETTLEMENT_NOTICE).toBe("Recorded in the app — no money is moved.");
  });
});

describe("describing a settlement", () => {
  it("uses D9's wording, from whoever recorded it", () => {
    expect(
      recordedSentence({ ...quin, isPayer: true }, olive, b(50000), "INR"),
    ).toBe("Quin recorded a payment of ₹500.00 to Olive.");
    expect(
      recordedSentence({ ...olive, isPayer: false }, quin, b(50000), "INR"),
    ).toBe("Olive recorded a payment of ₹500.00 from Quin.");
    expect(
      recordedSentence({ ...you, isPayer: true }, olive, b(30000), "INR"),
    ).toBe("You recorded a payment of ₹300.00 to Olive.");
    expect(
      recordedSentence({ ...olive, isPayer: false }, you, b(30000), "INR"),
    ).toBe("Olive recorded a payment of ₹300.00 from you.");
  });

  it("names both sides, never claiming the app moved the money", () => {
    expect(paymentTitle(quin, olive)).toBe("Payment from Quin to Olive");
    expect(paymentTitle(you, olive)).toBe("Payment from you to Olive");
    expect(paymentTitle(olive, you)).toBe("Payment from Olive to you");
    expect(paymentSentence(you, olive, b(30000), "INR")).toBe(
      "You paid Olive ₹300.00.",
    );
    expect(paymentSentence(olive, you, b(1500), "JPY")).toBe(
      "Olive paid you JP¥1,500.",
    );
    for (const text of [
      SETTLEMENT_NOTICE,
      recordedSentence({ ...you, isPayer: true }, olive, b(1), "INR"),
    ]) {
      expect(text).not.toMatch(/transferred|sent through|bank|UPI/i);
    }
  });

  it("marks the viewer and people who have left (D13)", () => {
    const base = { displayName: "Quin", isActive: true };
    expect(personSubject({ ...base, userId: "me" }, "me")).toEqual({
      you: true,
      name: "Quin",
    });
    expect(personSubject({ ...base, userId: "q" }, "me")).toEqual({
      you: false,
      name: "Quin",
    });
    expect(
      personSubject({ ...base, userId: "q", isActive: false }, "me").name,
    ).toBe("Quin (left)");
    expect(
      paymentTitle(
        personSubject({ ...base, userId: "q", isActive: false }, "me"),
        personSubject({ ...base, userId: "me" }, "me"),
      ),
    ).toBe("Payment from Quin (left) to you");
  });

  it("never changes how a name is written", () => {
    const dee = { you: false, name: "dee" };
    expect(paymentSentence(dee, you, b(1), "INR")).toBe("dee paid you ₹0.01.");
    expect(overpaymentWarning(you, dee, b(-100), "INR")).toBe(
      "dee owes you ₹1.00 right now, not the other way round.",
    );
  });
});

describe("where the viewer stands with someone", () => {
  it("says who owes whom, in words", () => {
    expect(standingSentence(olive, b(-30000), "INR")).toBe(
      "Right now you owe Olive ₹300.00.",
    );
    expect(standingSentence(olive, b(30000), "INR")).toBe(
      "Right now Olive owes you ₹300.00.",
    );
    expect(standingSentence(olive, b(0), "INR")).toBe(
      "Right now you and Olive are settled up.",
    );
  });
});

describe("settlementOutcome: what recording a payment does", () => {
  it("is partial, settles, or goes over, by exact minor units", () => {
    expect(settlementOutcome(b(30000), b(10000))).toEqual({
      kind: "partial",
      remainingMinor: b(20000),
    });
    expect(settlementOutcome(b(30000), b(30000))).toEqual({ kind: "settles" });
    expect(settlementOutcome(b(30000), b(30001))).toEqual({
      kind: "over",
      overMinor: b(1),
    });
  });

  it("is always over when nothing is owed that way (D9 warns)", () => {
    expect(settlementOutcome(b(0), b(1))).toEqual({
      kind: "over",
      overMinor: b(1),
    });
    expect(settlementOutcome(b(-20000), b(30000))).toEqual({
      kind: "over",
      overMinor: b(50000),
    });
  });
});

describe("outcome and warning sentences", () => {
  it("say what's left afterwards, from the viewer's side", () => {
    expect(
      outcomeSentence(you, olive, settlementOutcome(b(30000), b(10000)), "INR"),
    ).toBe("After this, you'll owe Olive ₹200.00.");
    expect(
      outcomeSentence(olive, you, settlementOutcome(b(30000), b(10000)), "INR"),
    ).toBe("After this, Olive will owe you ₹200.00.");
    expect(
      outcomeSentence(you, olive, settlementOutcome(b(30000), b(30000)), "INR"),
    ).toBe("After this, you and Olive will be settled up.");
    expect(
      outcomeSentence(olive, you, settlementOutcome(b(30000), b(30000)), "INR"),
    ).toBe("After this, you and Olive will be settled up.");
    expect(
      outcomeSentence(you, olive, settlementOutcome(b(30000), b(50000)), "INR"),
    ).toBe("After this, Olive will owe you ₹200.00.");
    expect(
      outcomeSentence(olive, you, settlementOutcome(b(0), b(500)), "INR"),
    ).toBe("After this, you'll owe Olive ₹5.00.");
  });

  it("warn when the amount is more than what's owed", () => {
    expect(overpaymentWarning(you, olive, b(30000), "INR")).toBe(
      "That's more than you owe Olive right now (₹300.00).",
    );
    expect(overpaymentWarning(olive, you, b(30000), "INR")).toBe(
      "That's more than Olive owes you right now (₹300.00).",
    );
    expect(overpaymentWarning(you, olive, b(0), "INR")).toBe(
      "You don't owe Olive anything right now.",
    );
    expect(overpaymentWarning(olive, you, b(0), "INR")).toBe(
      "Olive doesn't owe you anything right now.",
    );
    expect(overpaymentWarning(you, olive, b(-20000), "INR")).toBe(
      "Olive owes you ₹200.00 right now, not the other way round.",
    );
    expect(overpaymentWarning(olive, you, b(-20000), "INR")).toBe(
      "You owe Olive ₹200.00 right now, not the other way round.",
    );
  });
});
