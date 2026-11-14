import { describe, expect, it } from "vitest";
import type { RawExpenseForm } from "@/lib/expenses/form";
import { extractReceipt, type ExtractionWarning } from "./extract";
import { prefillFrom, warningMessage } from "./review";

const blank: RawExpenseForm = {
  description: "",
  amount: "",
  category: "",
  expenseDate: "2026-11-14",
  paidBy: "me",
  splitMethod: "equal",
  participants: ["me", "you"],
  shares: {},
  percents: {},
};
const context = { currency: "INR", exponent: 2, today: "2026-11-14" };
const read = (text: string) =>
  extractReceipt(
    text.split("\n").map((line) => ({ text: line, confidence: 90 })),
    context,
  );

describe("prefillFrom", () => {
  it("fills in only the description, the amount and the date", () => {
    const { defaults, fromReceipt } = prefillFrom(
      read("Fresh Mart\nDate 13/11/2026\nGrand Total 1,250.50"),
      blank,
      2,
    );
    expect(defaults).toEqual({
      ...blank,
      description: "Fresh Mart",
      amount: "1250.50",
      expenseDate: "2026-11-13",
    });
    expect(fromReceipt).toEqual({
      description: true,
      amount: true,
      date: true,
    });
    // Category, payer and split are always the person's.
    expect(defaults.category).toBe("");
    expect(defaults.paidBy).toBe("me");
    expect(defaults.participants).toEqual(["me", "you"]);
  });

  it("keeps the household's today for a missing or future date, and leaves a missing total empty", () => {
    const future = prefillFrom(read("Shop\nDate 20/11/2026"), blank, 2);
    expect(future.defaults.expenseDate).toBe("2026-11-14");
    expect(future.defaults.amount).toBe("");
    expect(future.fromReceipt).toEqual({
      description: true,
      amount: false,
      date: false,
    });

    expect(prefillFrom(read("Total 0.00"), blank, 2).defaults.amount).toBe("");
  });

  it("starts from a blank form when nothing was read or reading was skipped", () => {
    expect(prefillFrom(null, blank, 2)).toEqual({
      defaults: blank,
      fromReceipt: { description: false, amount: false, date: false },
    });
  });
});

describe("warningMessage", () => {
  it("words every warning, with money in the household's currency", () => {
    const warnings: ExtractionWarning[] = [
      { code: "nothing_read" },
      { code: "no_total" },
      { code: "no_date" },
      { code: "no_merchant" },
      { code: "date_ambiguous" },
      { code: "date_in_future" },
      { code: "date_old" },
      { code: "other_currency", currency: "USD" },
      { code: "several_currencies", currencies: ["EUR", "INR"] },
      {
        code: "totals_differ",
        expectedMinor: BigInt(11800),
        totalMinor: BigInt(12800),
      },
      {
        code: "totals_rounding",
        expectedMinor: BigInt(11840),
        totalMinor: BigInt(11800),
      },
      {
        code: "items_differ",
        itemsMinor: BigInt(47000),
        againstMinor: BigInt(52000),
      },
      { code: "low_confidence", fields: ["merchant", "total"] },
      { code: "unclear_lines", count: 2 },
    ];
    for (const warning of warnings)
      expect(warningMessage(warning, "INR")).toMatch(/\.$/);
    expect(warningMessage(warnings[7], "INR")).toContain(
      "in INR, with no conversion",
    );
    expect(warningMessage(warnings[9], "INR")).toContain("₹118.00");
    expect(warningMessage(warnings[9], "INR")).toContain("₹128.00");
    expect(warningMessage(warnings[12], "INR")).toBe(
      "Hard to read: the shop's name and the total. Check against the receipt.",
    );
    expect(warningMessage(warnings[13], "INR")).toMatch(
      /^2 lines of the receipt couldn't be read clearly/,
    );
    expect(warningMessage({ code: "unclear_lines", count: 1 }, "INR")).toMatch(
      /^One line/,
    );
  });
});
