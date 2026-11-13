import { describe, expect, it } from "vitest";
import {
  readBillForm,
  validateBillDetails,
  validateNewBill,
  validateNewSchedule,
  type RawBillForm,
} from "./form";
import { addDays } from "./schedule";

const OLIVE = "11111111-1111-4111-8111-111111111111";
const PAT = "22222222-2222-4222-8222-222222222222";
const OUTSIDER = "99999999-9999-4999-8999-999999999999";
const TODAY = "2026-11-13";
const context = { memberIds: [OLIVE, PAT], exponent: 2, today: TODAY };

function form(change: Partial<RawBillForm> = {}): RawBillForm {
  return {
    description: "Electricity",
    amount: "1500",
    category: "utilities",
    paidBy: OLIVE,
    splitMethod: "equal",
    participants: [OLIVE, PAT],
    shares: {},
    percents: {},
    schedule: "monthly",
    unit: "",
    every: "",
    startsOn: "2026-11-30",
    endsOn: "",
    notes: "",
    ...change,
  };
}

describe("readBillForm", () => {
  it("reads the expense fields and the schedule", () => {
    const data = new FormData();
    data.set("description", "Rent");
    data.set("amount", "20000");
    data.set("category", "rent");
    data.set("paidBy", OLIVE);
    data.set("splitMethod", "percentage");
    data.append("participants", OLIVE);
    data.append("participants", PAT);
    data.set(`percent:${OLIVE}`, "60");
    data.set(`percent:${PAT}`, "40");
    data.set("schedule", "custom");
    data.set("unit", "week");
    data.set("every", "3");
    data.set("startsOn", TODAY);
    data.set("endsOn", "2027-11-13");
    data.set("notes", "Account 42");
    expect(readBillForm(data)).toEqual({
      description: "Rent",
      amount: "20000",
      category: "rent",
      paidBy: OLIVE,
      splitMethod: "percentage",
      participants: [OLIVE, PAT],
      shares: {},
      percents: { [OLIVE]: "60", [PAT]: "40" },
      schedule: "custom",
      unit: "week",
      every: "3",
      startsOn: TODAY,
      endsOn: "2027-11-13",
      notes: "Account 42",
    });
  });
});

describe("validateNewBill", () => {
  it("accepts a monthly bill split equally, with the split engine's shares", () => {
    const result = validateNewBill(form(), context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schedule).toEqual({
      unit: "month",
      every: 1,
      startsOn: "2026-11-30",
    });
    expect(result.value.details).toMatchObject({
      description: "Electricity",
      amountMinor: BigInt(150000),
      category: "utilities",
      payerId: OLIVE,
      splitMethod: "equal",
      endsOn: null,
      notes: null,
    });
    expect(result.value.details.shares.map((s) => s.shareMinor)).toEqual([
      BigInt(75000),
      BigInt(75000),
    ]);
  });

  it("maps each preset, and reads a custom interval", () => {
    for (const [schedule, unit, every] of [
      ["weekly", "week", 1],
      ["fortnightly", "week", 2],
      ["quarterly", "month", 3],
      ["yearly", "year", 1],
    ] as const) {
      const result = validateNewBill(form({ schedule }), context);
      expect(result.ok && result.value.schedule).toMatchObject({ unit, every });
    }
    const custom = validateNewBill(
      form({ schedule: "custom", unit: "month", every: "6" }),
      context,
    );
    expect(custom.ok && custom.value.schedule).toMatchObject({
      unit: "month",
      every: 6,
    });
  });

  it("refuses schedules that can't be right", () => {
    const errors = (change: Partial<RawBillForm>) => {
      const result = validateNewBill(form(change), context);
      return result.ok ? {} : result.fieldErrors;
    };
    expect(errors({ schedule: "daily" }).schedule).toBe(
      "Choose how often it repeats.",
    );
    expect(errors({ schedule: "custom", unit: "day", every: "2" }).unit).toBe(
      "Choose weeks, months or years.",
    );
    for (const every of ["0", "53", "1.5", "-1", "", "x"]) {
      expect(
        errors({ schedule: "custom", unit: "week", every }).every,
        every,
      ).toBe("Enter a whole number from 1 to 52.");
    }
    expect(errors({ startsOn: "2026-02-30" }).startsOn).toBe(
      "Choose a real date.",
    );
    expect(errors({ startsOn: "2025-11-11" }).startsOn).toBe(
      "Choose a date within the past year.",
    );
    expect(errors({ startsOn: "2025-11-12" }).startsOn).toBeUndefined();
    expect(errors({ startsOn: addDays(TODAY, 3660) }).startsOn).toBeUndefined();
    expect(errors({ startsOn: addDays(TODAY, 3661) }).startsOn).toBe(
      "Choose a date within the next ten years.",
    );
    expect(errors({ endsOn: "2026-11-29" }).endsOn).toBe(
      "The last due date can't be before the first.",
    );
    expect(errors({ endsOn: "2026-13-01" }).endsOn).toBe("Choose a real date.");
  });

  it("uses the expense form's rules for what, how much, who and the split", () => {
    const errors = (change: Partial<RawBillForm>) => {
      const result = validateNewBill(form(change), context);
      return result.ok ? {} : result.fieldErrors;
    };
    expect(errors({ description: "  " }).description).toBe(
      "Name the bill, like “Electricity” or “Rent”.",
    );
    expect(errors({ amount: "0" }).amount).toBeDefined();
    expect(errors({ amount: "12.345" }).amount).toBe(
      "Use at most 2 decimal places.",
    );
    expect(errors({ category: "pets" }).category).toBe("Choose a category.");
    expect(errors({ paidBy: OUTSIDER }).paidBy).toBe(
      "Choose who usually pays it.",
    );
    expect(errors({ participants: [OUTSIDER] }).participants).toBe(
      "Choose people from this household.",
    );
    expect(
      errors({
        splitMethod: "custom",
        shares: { [OLIVE]: "1000", [PAT]: "400" },
      }).participants,
    ).toBeDefined();
    expect(errors({ notes: "x".repeat(501) }).notes).toBe(
      "Use 500 characters or fewer.",
    );
  });
});

describe("validateBillDetails", () => {
  it("ignores the schedule fields and keeps notes trimmed", () => {
    const result = validateBillDetails(
      form({ schedule: "nonsense", startsOn: "", notes: "  Pay online  " }),
      context,
    );
    expect(result.ok && result.value.notes).toBe("Pay online");
  });
});

describe("validateNewSchedule", () => {
  it("starts today or later, after every stored period", () => {
    const at = (startsOn: string, latestStoredDueOn: string | null) => {
      const result = validateNewSchedule(
        { schedule: "monthly", unit: "", every: "", startsOn },
        { today: TODAY, latestStoredDueOn },
      );
      return result.ok ? "ok" : result.fieldErrors.startsOn;
    };
    expect(at(TODAY, null)).toBe("ok");
    expect(at("2026-11-12", null)).toBe("Choose today or a later date.");
    expect(at(TODAY, "2026-11-01")).toBe("ok");
    expect(at("2026-12-01", "2026-12-01")).toBe(
      "Choose a date after the last period that's already been recorded or skipped.",
    );
    expect(at("2026-12-02", "2026-12-01")).toBe("ok");
  });
});
