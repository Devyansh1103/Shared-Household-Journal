import { describe, expect, it } from "vitest";
import type { PersonBalance } from "@/domain/money/balances";
import {
  balanceSentence,
  combinedTotalSentence,
  DIRECTION_LABELS,
  partTotalSentence,
  entriesTotalSentence,
  formatBalance,
  formula,
  pairLineSentence,
  pairPhrase,
  paidBackSentence,
  paidSentence,
  personLabel,
  receivedBackSentence,
  shareLabel,
  shareSentence,
  workingSentence,
  WORD_JOINER as WJ,
} from "./explain";

const b = (value: number) => BigInt(value);
const you = { you: true, name: "Olive" };
const pat = { you: false, name: "Pat" };

function person(
  paid: number,
  paidCount: number,
  share: number,
  shareCount: number,
  settled: {
    paidBack?: [number, number];
    receivedBack?: [number, number];
  } = {},
): PersonBalance {
  const [settlementsPaid, settlementsPaidCount] = settled.paidBack ?? [0, 0];
  const [settlementsReceived, settlementsReceivedCount] =
    settled.receivedBack ?? [0, 0];
  return {
    userId: "p",
    paidMinor: b(paid),
    shareMinor: b(share),
    settlementsPaidMinor: b(settlementsPaid),
    settlementsReceivedMinor: b(settlementsReceived),
    netMinor: b(paid - share + settlementsPaid - settlementsReceived),
    paidCount,
    shareCount,
    settlementsPaidCount,
    settlementsReceivedCount,
  };
}

describe("labels", () => {
  it("names each direction in words, not colour", () => {
    expect(DIRECTION_LABELS).toEqual({
      owed: "Owed",
      owes: "Owes",
      settled: "Settled up",
    });
  });

  it("marks the viewer and people who have left (D13)", () => {
    const base = { displayName: "Pat", isActive: true };
    expect(personLabel({ ...base, userId: "me" }, "me")).toBe("Pat (you)");
    expect(personLabel({ ...base, userId: "p" }, "me")).toBe("Pat");
    expect(personLabel({ ...base, userId: "p", isActive: false }, "me")).toBe(
      "Pat (left)",
    );
  });

  it("shows a balance with its sign, in the currency's decimals", () => {
    expect(formatBalance(b(60000), "INR")).toBe(`+${WJ}₹600.00`);
    expect(formatBalance(b(-30000), "INR")).toBe(`-${WJ}₹300.00`);
    expect(formatBalance(b(0), "INR")).toBe("₹0.00");
    expect(formatBalance(b(1000), "KWD").replace(/ /g, " ")).toBe(
      `+${WJ}KWD 1.000`,
    );
    expect(formatBalance(b(-1500), "JPY")).toBe(`-${WJ}JP¥1,500`);
  });

  it("joins the sign to the amount so a line can't break between them", () => {
    // Browsers may wrap after "+" or "-" before "₹"; U+2060 forbids it and is
    // invisible. Without it, the text is exactly Intl's.
    const text = formatBalance(b(-30000), "INR");
    expect(text.indexOf(WJ)).toBe(1);
    expect(text.replace(WJ, "")).toBe("-₹300.00");
  });
});

describe("balanceSentence", () => {
  it("says the direction and the amount, for you and for others", () => {
    expect(balanceSentence(you, b(60000), "INR")).toBe(
      "You should get back ₹600.00.",
    );
    expect(balanceSentence(you, b(-30000), "INR")).toBe("You owe ₹300.00.");
    expect(balanceSentence(you, b(0), "INR")).toBe("You're settled up.");
    expect(balanceSentence(pat, b(60000), "INR")).toBe(
      "Pat should get back ₹600.00.",
    );
    expect(balanceSentence(pat, b(-30000), "INR")).toBe("Pat owes ₹300.00.");
    expect(balanceSentence(pat, b(0), "INR")).toBe("Pat is settled up.");
  });

  it("never changes how a name is written", () => {
    expect(balanceSentence({ you: false, name: "dee" }, b(-1), "INR")).toBe(
      "dee owes ₹0.01.",
    );
  });
});

describe("the working", () => {
  // The brief's example: paid ₹1,200 across three expenses, share ₹700.
  const example = person(120000, 3, 70000, 4);

  it("explains paid, share and the difference from the real figures", () => {
    expect(paidSentence(you, example, "INR")).toBe(
      "You paid ₹1,200.00 for 3 expenses.",
    );
    expect(shareSentence(you, example, "INR")).toBe(
      "Your share of the costs is ₹700.00, across 4 expenses.",
    );
    expect(formula(example, "INR")).toBe(
      `₹1,200.00 paid − ₹700.00 share = +${WJ}₹500.00`,
    );
    expect(workingSentence(you, example, "INR")).toBe(
      `₹1,200.00 paid − ₹700.00 share = +${WJ}₹500.00, so you should get back ₹500.00.`,
    );
  });

  it("reads naturally for other people, one expense, or none", () => {
    const one = person(0, 0, 30000, 1);
    expect(paidSentence(pat, one, "INR")).toBe(
      "Pat hasn't paid for any shared expenses.",
    );
    expect(shareSentence(pat, one, "INR")).toBe(
      "Pat's share of the costs is ₹300.00, across 1 expense.",
    );
    expect(workingSentence(pat, one, "INR")).toBe(
      `₹0.00 paid − ₹300.00 share = -${WJ}₹300.00, so Pat owes ₹300.00.`,
    );
    const none = person(0, 0, 0, 0);
    expect(paidSentence(you, none, "INR")).toBe(
      "You haven't paid for any shared expenses.",
    );
    expect(shareSentence(you, none, "INR")).toBe(
      "You don't have a share in any shared expenses.",
    );
    expect(workingSentence(you, none, "INR")).toBe(
      "₹0.00 paid − ₹0.00 share = ₹0.00, so you're settled up.",
    );
  });
});

describe("the working with recorded payments (roadmap Phase 10)", () => {
  // The brief's example after B pays A back ₹300: A paid ₹900, share ₹300,
  // received ₹300 back; B paid nothing, share ₹300, paid back ₹300.
  const creditor = person(90000, 1, 30000, 1, { receivedBack: [30000, 1] });
  const debtor = person(0, 0, 30000, 1, { paidBack: [30000, 1] });

  it("adds what was paid back and received back to the formula", () => {
    expect(formula(creditor, "INR")).toBe(
      `₹900.00 paid − ₹300.00 share − ₹300.00 received back = +${WJ}₹300.00`,
    );
    expect(workingSentence(you, debtor, "INR")).toBe(
      "₹0.00 paid − ₹300.00 share + ₹300.00 paid back = ₹0.00, so you're settled up.",
    );
    const both = person(0, 0, 0, 0, {
      paidBack: [10000, 1],
      receivedBack: [2500, 2],
    });
    expect(formula(both, "INR")).toBe(
      `₹0.00 paid − ₹0.00 share + ₹100.00 paid back − ₹25.00 received back = +${WJ}₹75.00`,
    );
  });

  it("adds up the expenses and the payments separately, then together", () => {
    expect(partTotalSentence(1, b(-30000), "INR")).toBe(
      `It comes to -${WJ}₹300.00.`,
    );
    expect(partTotalSentence(2, b(30000), "INR")).toBe(
      `Together they come to +${WJ}₹300.00.`,
    );
    expect(combinedTotalSentence(you, b(0), "INR")).toBe(
      "Expenses and recorded payments together come to ₹0.00, your balance.",
    );
    expect(combinedTotalSentence(pat, b(-100), "INR")).toBe(
      `Expenses and recorded payments together come to -${WJ}₹1.00, Pat's balance.`,
    );
  });

  it("leaves the formula exactly as before when there are none", () => {
    expect(formula(person(90000, 1, 30000, 1), "INR")).toBe(
      `₹900.00 paid − ₹300.00 share = +${WJ}₹600.00`,
    );
  });

  it("says who paid back and who was paid back, or nothing", () => {
    expect(paidBackSentence(you, debtor, "INR")).toBe(
      "You paid back ₹300.00 in 1 recorded payment.",
    );
    expect(paidBackSentence(pat, debtor, "INR")).toBe(
      "Pat paid back ₹300.00 in 1 recorded payment.",
    );
    expect(receivedBackSentence(you, creditor, "INR")).toBe(
      "You were paid back ₹300.00 in 1 recorded payment.",
    );
    expect(
      receivedBackSentence(
        pat,
        person(0, 0, 0, 0, { receivedBack: [500, 2] }),
        "INR",
      ),
    ).toBe("Pat was paid back ₹5.00 in 2 recorded payments.");
    expect(paidBackSentence(you, creditor, "INR")).toBeNull();
    expect(receivedBackSentence(you, debtor, "INR")).toBeNull();
  });
});

describe("pairs", () => {
  it("say who owes whom from the viewer's side", () => {
    expect(pairPhrase(pat, { you: false, name: "Quin" })).toBe("Pat owes Quin");
    expect(pairPhrase(you, pat)).toBe("You owe Pat");
    expect(pairPhrase(pat, you)).toBe("Pat owes you");
  });

  it("explain each expense between two people", () => {
    // You paid ₹900; Pat's share is ₹300 → Pat owes you ₹300 (+).
    expect(pairLineSentence(you, pat, b(90000), b(30000), "INR")).toBe(
      "You paid ₹900.00; Pat's share is ₹300.00.",
    );
    // Pat paid ₹300; your share is ₹150 → you owe Pat ₹150 (−).
    expect(pairLineSentence(you, pat, b(30000), b(-15000), "INR")).toBe(
      "Pat paid ₹300.00; your share is ₹150.00.",
    );
    // On Pat's page, with the viewer as the other person.
    expect(pairLineSentence(pat, you, b(30000), b(15000), "INR")).toBe(
      "Pat paid ₹300.00; your share is ₹150.00.",
    );
    expect(shareLabel(you)).toBe("Your share");
    expect(shareLabel(pat)).toBe("Pat's share");
  });
});

describe("entriesTotalSentence", () => {
  it("reads naturally for one expense or several", () => {
    expect(entriesTotalSentence(you, 1, b(-30000), "INR")).toBe(
      `It comes to -${WJ}₹300.00, your balance.`,
    );
    expect(entriesTotalSentence(pat, 3, b(60000), "INR")).toBe(
      `Together they come to +${WJ}₹600.00, Pat's balance.`,
    );
  });
});
