import { describe, expect, it } from "vitest";
import {
  CATEGORY_VALUES,
  categoryLabel,
  EXPENSE_CATEGORIES,
} from "./categories";
import { isCalendarDate, todayIn } from "./dates";
import {
  percentField,
  readExpenseForm,
  shareField,
  sharesJson,
  validateExpenseForm,
  type RawExpenseForm,
} from "./form";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const OUTSIDER = "99999999-9999-4999-8999-999999999999";
const context = { memberIds: [A, B, C], exponent: 2 };

const valid: RawExpenseForm = {
  description: "Electricity bill",
  amount: "100.00",
  category: "utilities",
  expenseDate: "2026-11-10",
  paidBy: A,
  splitMethod: "equal",
  participants: [A, B, C],
  shares: {},
  percents: {},
};

function errors(raw: Partial<RawExpenseForm>) {
  const result = validateExpenseForm({ ...valid, ...raw }, context);
  return result.ok ? {} : result.fieldErrors;
}

describe("validateExpenseForm", () => {
  it("accepts a valid equal split and follows join order for leftovers", () => {
    // Ticked in a different order: join order (A, B, C) still decides.
    const result = validateExpenseForm(
      { ...valid, participants: [C, A, B] },
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expense.amountMinor).toBe(BigInt(10000));
    expect(sharesJson(result.expense.shares)).toEqual([
      { user_id: A, share_minor: 3334, percentage_bp: null },
      { user_id: B, share_minor: 3333, percentage_bp: null },
      { user_id: C, share_minor: 3333, percentage_bp: null },
    ]);
  });

  it("rejects a missing title, invalid amount and invalid category", () => {
    expect(errors({ description: "  " }).description).toBeDefined();
    expect(errors({ description: "x".repeat(121) }).description).toBeDefined();
    expect(errors({ amount: "" }).amount).toBe("Enter an amount.");
    expect(errors({ amount: "0" }).amount).toBe(
      "Enter an amount greater than zero.",
    );
    expect(errors({ amount: "-5" }).amount).toBeDefined();
    expect(errors({ amount: "10.005" }).amount).toBe(
      "Use at most 2 decimal places.",
    );
    expect(errors({ category: "fun" }).category).toBe("Choose a category.");
    expect(errors({ category: "" }).category).toBe("Choose a category.");
    expect(errors({ splitMethod: "random" }).splitMethod).toBeDefined();
    expect(errors({ expenseDate: "2026-02-30" }).expenseDate).toBeDefined();
    expect(errors({ expenseDate: "10/11/2026" }).expenseDate).toBeDefined();
  });

  it("rejects payers and participants who aren't active members", () => {
    expect(errors({ paidBy: OUTSIDER }).paidBy).toBe("Choose who paid.");
    expect(errors({ paidBy: "" }).paidBy).toBe("Choose who paid.");
    expect(errors({ participants: [A, OUTSIDER] }).participants).toBe(
      "Choose people from this household.",
    );
    expect(errors({ participants: [] }).participants).toBe(
      "Choose at least one person to split with.",
    );
  });

  it("validates percentage splits", () => {
    const ok = validateExpenseForm(
      {
        ...valid,
        splitMethod: "percentage",
        participants: [A, B],
        percents: { [A]: "60", [B]: "40" },
      },
      context,
    );
    expect(ok.ok && sharesJson(ok.expense.shares)).toEqual([
      { user_id: A, share_minor: 6000, percentage_bp: 6000 },
      { user_id: B, share_minor: 4000, percentage_bp: 4000 },
    ]);

    expect(
      errors({
        splitMethod: "percentage",
        participants: [A, B],
        percents: { [A]: "60", [B]: "30" },
      }).participants,
    ).toBe("The percentages must add up to exactly 100%.");
    expect(
      errors({
        splitMethod: "percentage",
        participants: [A, B],
        percents: { [A]: "60" },
      })[percentField(B)],
    ).toBeDefined();
  });

  it("validates custom splits, allowing zero for someone", () => {
    const ok = validateExpenseForm(
      {
        ...valid,
        splitMethod: "custom",
        participants: [A, B],
        shares: { [A]: "0", [B]: "100" },
      },
      context,
    );
    expect(ok.ok && sharesJson(ok.expense.shares)).toEqual([
      { user_id: A, share_minor: 0, percentage_bp: null },
      { user_id: B, share_minor: 10000, percentage_bp: null },
    ]);

    expect(
      errors({
        splitMethod: "custom",
        participants: [A, B],
        shares: { [A]: "50", [B]: "49.99" },
      }).participants,
    ).toBe("The shares must add up exactly to the amount.");
    expect(
      errors({
        splitMethod: "custom",
        participants: [A, B],
        shares: { [A]: "50", [B]: "abc" },
      })[shareField(B)],
    ).toBeDefined();
  });

  it("respects currencies without decimals", () => {
    const yen = { memberIds: [A], exponent: 0 };
    const result = validateExpenseForm(
      { ...valid, amount: "1250", participants: [A] },
      yen,
    );
    expect(result.ok && Number(result.expense.amountMinor)).toBe(1250);
    const bad = validateExpenseForm(
      { ...valid, amount: "12.50", participants: [A] },
      yen,
    );
    expect(bad.ok).toBe(false);
  });
});

describe("readExpenseForm", () => {
  it("collects participants and per-person values", () => {
    const data = new FormData();
    data.set("description", "Rent");
    data.set("amount", "100");
    data.append("participants", A);
    data.append("participants", B);
    data.set(shareField(A), "60");
    data.set(percentField(B), "40");
    const raw = readExpenseForm(data);
    expect(raw.participants).toEqual([A, B]);
    expect(raw.shares).toEqual({ [A]: "60" });
    expect(raw.percents).toEqual({ [B]: "40" });
    expect(raw.category).toBe("");
  });
});

describe("categories (D17)", () => {
  it("is the confirmed fixed list, in order", () => {
    expect(EXPENSE_CATEGORIES.map((c) => c.label)).toEqual([
      "Rent",
      "Utilities",
      "Groceries",
      "Household supplies",
      "Internet",
      "Dining",
      "Transport",
      "Other",
    ]);
    expect(CATEGORY_VALUES).toHaveLength(8);
    expect(categoryLabel("household_supplies")).toBe("Household supplies");
  });
});

describe("dates", () => {
  it("gives today in the household's timezone", () => {
    // 20:00 UTC on 10 Nov is already 11 Nov in India.
    const instant = new Date("2026-11-10T20:00:00Z");
    expect(todayIn("Asia/Kolkata", instant)).toBe("2026-11-11");
    expect(todayIn("Europe/London", instant)).toBe("2026-11-10");
  });

  it("accepts only real calendar dates", () => {
    expect(isCalendarDate("2026-11-10")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("26-11-10")).toBe(false);
    expect(isCalendarDate("1800-01-01")).toBe(false);
  });
});
