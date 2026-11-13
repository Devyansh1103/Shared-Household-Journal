// Display formatting only. Money is stored as integer minor units (ADR-003);
// nothing here converts amounts through binary floating point.

import { isoMinorUnits } from "@/domain/money/currency";

const LOCALE = "en-IN";

/**
 * Decimal places for a currency from ISO 4217 (D2), e.g. INR → 2, JPY → 0,
 * KWD → 3. The same on the server and in every browser. Throws for a code
 * without a minor unit, which no household can have.
 */
export function currencyExponent(currency: string): number {
  const units = isoMinorUnits(currency);
  if (units === null) {
    throw new RangeError(`${currency} has no ISO 4217 minor unit`);
  }
  return units;
}

/** Converts integer minor units to an exact decimal string, e.g. (12345, 2) → "123.45". */
export function minorToDecimalString(
  minor: bigint | number,
  exponent: number,
): string {
  if (typeof minor === "number" && !Number.isSafeInteger(minor)) {
    throw new RangeError(`Minor units must be a safe integer, got ${minor}`);
  }
  const value = BigInt(minor);
  const negative = value < BigInt(0);
  const digits = (negative ? -value : value)
    .toString()
    .padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? `.${digits.slice(-exponent)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

export function formatMoney(
  minor: bigint | number,
  currency: string,
  options: { signDisplay?: "auto" | "never" | "always" | "exceptZero" } = {},
): string {
  const exponent = currencyExponent(currency);
  const decimal = minorToDecimalString(minor, exponent);
  // Show exactly the ISO decimal places. Left to Intl, the browser's CLDR data
  // could round the exact decimal (e.g. PKR to 0 places in Edge).
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
    signDisplay: options.signDisplay ?? "auto",
  }).format(decimal as `${number}`);
}

/** Formats a calendar date ("YYYY-MM-DD") without shifting it across timezones (D11). */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Formats an instant in the household's IANA timezone (D11). */
export function formatDateTime(
  instant: string | Date,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(instant));
}

/** The time of day of an instant in the household's timezone (D11): "10:30 am". */
export function formatTime(instant: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(instant));
}

/** The weekday and time of an instant in the household's timezone: "Fri, 10:30 am". */
export function formatWeekdayTime(
  instant: string | Date,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(instant));
}

/**
 * A calendar date ("YYYY-MM-DD") in full, with its weekday, without shifting
 * it across timezones (D11): "Friday, 6 November 2026".
 */
export function formatLongDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
