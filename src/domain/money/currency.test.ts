import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  currencyExponent,
  formatMoney,
  minorToDecimalString,
} from "@/lib/format";
import { currencyOptions, isSupportedCurrency } from "@/lib/households/options";
import { isoMinorUnits, NO_MINOR_UNIT } from "./currency";

describe("isoMinorUnits (D2)", () => {
  it("follows ISO 4217 for 0, 2, 3 and 4 decimal currencies", () => {
    expect(isoMinorUnits("INR")).toBe(2);
    expect(isoMinorUnits("USD")).toBe(2);
    expect(isoMinorUnits("EUR")).toBe(2);
    expect(isoMinorUnits("JPY")).toBe(0);
    expect(isoMinorUnits("KRW")).toBe(0);
    expect(isoMinorUnits("KWD")).toBe(3);
    expect(isoMinorUnits("BHD")).toBe(3);
    expect(isoMinorUnits("CLF")).toBe(4);
  });

  it("uses ISO, not CLDR, where they differ", () => {
    // CLDR (and so Intl) says 0 for these; ISO 4217 says otherwise.
    expect(isoMinorUnits("IQD")).toBe(3);
    expect(isoMinorUnits("IRR")).toBe(2);
    expect(isoMinorUnits("LAK")).toBe(2);
    // Node and Edge disagree on these; ISO says 2.
    for (const code of ["PKR", "HUF", "IDR", "COP"]) {
      expect(isoMinorUnits(code), code).toBe(2);
    }
  });

  it("has no answer for codes without a minor unit, or malformed codes", () => {
    for (const code of ["XDR", "XSU", "XAU", "XTS", "XXX", "inr", "IN", ""]) {
      expect(isoMinorUnits(code), code).toBeNull();
    }
    expect(() => currencyExponent("XDR")).toThrow(RangeError);
  });

  it("matches the database's list of codes without a minor unit", () => {
    // households_currency_has_minor_unit repeats NO_MINOR_UNIT; keep them equal.
    const dir = join(process.cwd(), "supabase", "migrations");
    const file = readdirSync(dir).find((name) =>
      name.endsWith("_currency_minor_units.sql"),
    );
    expect(file).toBeDefined();
    const sql = readFileSync(join(dir, file!), "utf8");
    const list = /not in \(([^)]*)\)/.exec(sql)?.[1] ?? "";
    const codes = [...list.matchAll(/'([A-Z]{3})'/g)].map((m) => m[1]);
    expect(codes.sort()).toEqual([...NO_MINOR_UNIT].sort());
  });
});

describe("household currency options", () => {
  it("offer only currencies with an ISO minor unit", () => {
    const codes = currencyOptions().map((c) => c.code);
    expect(codes).toContain("INR");
    expect(codes.length).toBeGreaterThan(100);
    expect(codes.filter((code) => NO_MINOR_UNIT.has(code))).toEqual([]);
    expect(codes.every((code) => isoMinorUnits(code) !== null)).toBe(true);
    expect(isSupportedCurrency("XDR")).toBe(false);
    expect(isSupportedCurrency("XSU")).toBe(false);
  });
});

describe("formatMoney shows exactly the ISO decimal places", () => {
  it("never rounds or pads beyond the stored precision", () => {
    // Intl separates a code from the digits with a no-break space.
    const fmt = (minor: number, code: string) =>
      formatMoney(minor, code).replaceAll(" ", " ");
    expect(fmt(123456, "INR")).toBe("₹1,234.56");
    expect(fmt(1250, "JPY")).toBe("JP¥1,250");
    expect(fmt(1234567, "KWD")).toBe("KWD 1,234.567");
    expect(fmt(1000, "IQD")).toBe("IQD 1.000");
    expect(fmt(12345678, "CLF")).toBe("CLF 1,234.5678");
    // Edge's CLDR would show PKR with 0 places; ISO (and the stored value) has 2.
    expect(fmt(10050, "PKR")).toBe("PKR 100.50");
  });

  it("agrees with the exact decimal string for every offered currency", () => {
    for (const { code } of currencyOptions()) {
      const exponent = currencyExponent(code);
      const decimal = minorToDecimalString(123456789, exponent);
      const digits = formatMoney(123456789, code).replace(/[^0-9.]/g, "");
      // Strip grouping and symbol; what remains is the stored value, unrounded.
      expect(digits.replace(/^\.+|\.+$/g, ""), code).toBe(decimal);
    }
  });
});
