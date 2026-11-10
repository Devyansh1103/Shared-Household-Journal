import { describe, expect, it } from "vitest";
import {
  currencyOptions,
  DEFAULT_CURRENCY,
  isSupportedCurrency,
  isSupportedTimeZone,
  normalizeTimeZone,
  timeZoneLabel,
  timeZoneOptions,
} from "./options";

describe("currencyOptions", () => {
  it("lists ISO 4217 codes including the INR default (D1)", () => {
    const codes = currencyOptions().map((c) => c.code);
    expect(codes).toContain(DEFAULT_CURRENCY);
    expect(codes.every((code) => /^[A-Z]{3}$/.test(code))).toBe(true);
    expect(currencyOptions().find((c) => c.code === "INR")?.label).toBe(
      "INR — Indian Rupee",
    );
  });

  it("validates codes exactly", () => {
    expect(isSupportedCurrency("INR")).toBe(true);
    expect(isSupportedCurrency("inr")).toBe(false);
    expect(isSupportedCurrency("ZZZ")).toBe(false);
  });
});

describe("timeZoneOptions", () => {
  it("uses current IANA names", () => {
    expect(timeZoneOptions()).toContain("Asia/Kolkata");
    expect(timeZoneOptions()).not.toContain("Asia/Calcutta");
    expect(normalizeTimeZone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(normalizeTimeZone("Europe/London")).toBe("Europe/London");
  });

  it("has no duplicates and is sorted", () => {
    const zones = timeZoneOptions();
    expect(new Set(zones).size).toBe(zones.length);
    expect([...zones].sort()).toEqual(zones);
  });

  it("validates timezones against the list", () => {
    expect(isSupportedTimeZone("Asia/Kolkata")).toBe(true);
    expect(isSupportedTimeZone("Mars/Olympus")).toBe(false);
  });
});

describe("timeZoneLabel", () => {
  it("is readable", () => {
    expect(timeZoneLabel("America/Argentina/Buenos_Aires")).toBe(
      "America / Argentina / Buenos Aires",
    );
  });
});
