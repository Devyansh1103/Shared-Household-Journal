import { describe, expect, it } from "vitest";
import {
  formatBasisPoints,
  MAX_AMOUNT_MINOR,
  parseAmount,
  parsePercent,
} from "./amount";

const minor = (input: string, exponent = 2) => {
  const result = parseAmount(input, exponent);
  return result.ok ? Number(result.minor) : result.error;
};

describe("parseAmount", () => {
  it("converts to minor units exactly", () => {
    expect(minor("1250")).toBe(125000);
    expect(minor("1250.5")).toBe(125050);
    expect(minor("1250.50")).toBe(125050);
    expect(minor("0.01")).toBe(1);
    expect(minor(" 99.99 ")).toBe(9999);
    // 0.1 + 0.2 style float traps don't apply: digits are handled as text.
    expect(minor("0.29")).toBe(29);
    expect(minor("1.15")).toBe(115);
  });

  it("accepts Indian and international digit grouping", () => {
    expect(minor("1,25,000")).toBe(12500000);
    expect(minor("1,250.75")).toBe(125075);
    expect(minor("125,000")).toBe(12500000);
  });

  it("rejects decimal commas and misplaced grouping instead of guessing", () => {
    for (const bad of ["12,50", "1,2,3", ",100", "100,"]) {
      expect(typeof minor(bad)).toBe("string");
    }
  });

  it("rejects zero, negative, empty and malformed input", () => {
    for (const bad of [
      "",
      "0",
      "0.00",
      "-5",
      "abc",
      "1e3",
      "12.",
      ".5",
      "₹100",
      "1 000",
      "Infinity",
    ]) {
      expect(typeof minor(bad), bad).toBe("string");
    }
  });

  it("rejects more decimal places than the currency has, without rounding", () => {
    expect(minor("10.005")).toBe("Use at most 2 decimal places.");
    expect(minor("100.5", 0)).toBe(
      "This currency has no decimal places. Enter a whole amount.",
    );
    expect(minor("100", 0)).toBe(100);
    expect(minor("1.234", 3)).toBe(1234);
  });

  it("enforces the maximum", () => {
    expect(minor("9999999999.99")).toBe(Number(MAX_AMOUNT_MINOR));
    expect(minor("10000000000.00")).toBe("That amount is too large.");
  });
});

describe("parsePercent", () => {
  it("converts to basis points", () => {
    const bp = (input: string) => {
      const result = parsePercent(input);
      return result.ok ? result.basisPoints : null;
    };
    expect(bp("50")).toBe(5000);
    expect(bp("33.33")).toBe(3333);
    expect(bp("33.3")).toBe(3330);
    expect(bp("0")).toBe(0);
    expect(bp("100")).toBe(10000);
    expect(bp("100.01")).toBeNull();
    expect(bp("33.333")).toBeNull();
    expect(bp("-1")).toBeNull();
    expect(bp("")).toBeNull();
  });
});

describe("formatBasisPoints", () => {
  it("drops trailing zeros", () => {
    expect(formatBasisPoints(5000)).toBe("50");
    expect(formatBasisPoints(3333)).toBe("33.33");
    expect(formatBasisPoints(3330)).toBe("33.3");
    expect(formatBasisPoints(3305)).toBe("33.05");
  });
});
