import { describe, expect, it } from "vitest";
import {
  currencyExponent,
  formatDate,
  formatDateTime,
  formatLongDate,
  formatMoney,
  formatTime,
  formatWeekdayTime,
  minorToDecimalString,
} from "./format";

describe("minorToDecimalString", () => {
  it("places the decimal point by exponent", () => {
    expect(minorToDecimalString(12345, 2)).toBe("123.45");
    expect(minorToDecimalString(5, 2)).toBe("0.05");
    expect(minorToDecimalString(0, 2)).toBe("0.00");
    expect(minorToDecimalString(-150, 2)).toBe("-1.50");
    expect(minorToDecimalString(500, 0)).toBe("500");
  });

  it("is exact for values beyond float precision", () => {
    expect(minorToDecimalString(BigInt("123456789012345678"), 2)).toBe(
      "1234567890123456.78",
    );
  });

  it("rejects non-integer numbers", () => {
    expect(() => minorToDecimalString(1.5, 2)).toThrow(RangeError);
  });
});

describe("currencyExponent", () => {
  it("reads ISO 4217 decimal places", () => {
    expect(currencyExponent("INR")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
  });
});

describe("formatMoney", () => {
  it("formats INR with Indian digit grouping", () => {
    expect(formatMoney(123456, "INR")).toBe("₹1,234.56");
    expect(formatMoney(10000000, "INR")).toBe("₹1,00,000.00");
  });

  it("shows signs only when asked", () => {
    expect(formatMoney(-50000, "INR")).toBe("-₹500.00");
    expect(formatMoney(-50000, "INR", { signDisplay: "never" })).toBe(
      "₹500.00",
    );
  });
});

describe("formatDate", () => {
  it("formats a calendar date without timezone shift", () => {
    expect(formatDate("2026-11-02")).toBe("2 Nov 2026");
    expect(formatDate("2026-01-31")).toBe("31 Jan 2026");
  });
});

describe("formatDateTime", () => {
  it("renders an instant in the given timezone", () => {
    // 18:45 UTC on 1 Nov is 00:15 on 2 Nov in India (UTC+05:30).
    expect(formatDateTime("2026-11-01T18:45:00Z", "Asia/Kolkata")).toBe(
      "2 Nov 2026, 12:15 am",
    );
  });
});

describe("formatTime and formatWeekdayTime", () => {
  it("render the time of day, and the weekday, in the given timezone", () => {
    // 18:45 UTC on Sunday 1 Nov is 00:15 on Monday 2 Nov in India.
    expect(formatTime("2026-11-01T18:45:00Z", "Asia/Kolkata")).toBe("12:15 am");
    expect(formatWeekdayTime("2026-11-01T18:45:00Z", "Asia/Kolkata")).toBe(
      "Mon, 12:15 am",
    );
    expect(formatTime("2026-11-01T18:45:00Z", "UTC")).toBe("6:45 pm");
    expect(formatWeekdayTime(new Date("2026-11-01T18:45:00Z"), "UTC")).toBe(
      "Sun, 6:45 pm",
    );
  });
});

describe("formatLongDate", () => {
  it("formats a calendar date with its weekday, without timezone shift", () => {
    expect(formatLongDate("2026-11-06")).toBe("Friday, 6 November 2026");
    expect(formatLongDate("2027-01-01")).toBe("Friday, 1 January 2027");
  });
});
