// Parsing money typed by a person into integer minor units (ADR-003, D2).
// Exact: digits are handled as strings and BigInt, never as floating point.
// Nothing is rounded: more decimal places than the currency has is an error.

/**
 * Largest accepted amount in minor units (e.g. ₹9,99,99,99,999.99). A technical
 * bound that keeps every amount, and every sum of shares, far inside
 * JavaScript's safe-integer range when it travels as JSON.
 */
export const MAX_AMOUNT_MINOR = BigInt("999999999999");

export type AmountResult =
  { ok: true; minor: bigint } | { ok: false; error: string };

const NUMBER = /^(\d+)(?:\.(\d+))?$/;
// Grouping commas are accepted only where they belong, so "12,50" (a decimal
// comma) is rejected instead of being read as 1250.
const INDIAN_GROUPING = /^\d{1,2}(?:,\d{2})*,\d{3}$/;
const INTERNATIONAL_GROUPING = /^\d{1,3}(?:,\d{3})+$/;

/**
 * Parses an amount like "1250", "1,250.50" or "1,25,000" for a currency with
 * `exponent` decimal places (INR 2, JPY 0). Must be greater than zero.
 */
export function parseAmount(input: string, exponent: number): AmountResult {
  const text = input.trim();
  if (!text) return { ok: false, error: "Enter an amount." };

  const [integerPart, ...rest] = text.split(".");
  if (integerPart.includes(",")) {
    if (
      !INDIAN_GROUPING.test(integerPart) &&
      !INTERNATIONAL_GROUPING.test(integerPart)
    ) {
      return {
        ok: false,
        error: "Use a dot for decimals and commas only between thousands.",
      };
    }
  }
  const plain = [integerPart.replaceAll(",", ""), ...rest].join(".");

  const match = NUMBER.exec(plain);
  if (!match) {
    return {
      ok: false,
      error:
        exponent > 0
          ? "Enter an amount like 1250 or 1250.50."
          : "Enter a whole amount like 1250.",
    };
  }

  const [, whole, fraction = ""] = match;
  if (fraction.length > exponent) {
    return {
      ok: false,
      error:
        exponent === 0
          ? "This currency has no decimal places. Enter a whole amount."
          : `Use at most ${exponent} decimal place${exponent === 1 ? "" : "s"}.`,
    };
  }

  const minor =
    BigInt(whole) * BigInt(10) ** BigInt(exponent) +
    BigInt(fraction.padEnd(exponent, "0") || "0");

  if (minor <= BigInt(0)) {
    return { ok: false, error: "Enter an amount greater than zero." };
  }
  if (minor > MAX_AMOUNT_MINOR) {
    return { ok: false, error: "That amount is too large." };
  }
  return { ok: true, minor };
}

export type PercentResult =
  { ok: true; basisPoints: number } | { ok: false; error: string };

/** Parses a percentage like "50" or "33.33" into basis points (1% = 100). */
export function parsePercent(input: string): PercentResult {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) {
    return {
      ok: false,
      error: "Enter a percentage like 50 or 33.33.",
    };
  }
  const basisPoints =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (basisPoints > 10000) {
    return { ok: false, error: "A share can't be more than 100%." };
  }
  return { ok: true, basisPoints };
}

/** Basis points as a percentage string, e.g. 3333 → "33.33", 5000 → "50". */
export function formatBasisPoints(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = basisPoints % 100;
  return fraction === 0
    ? String(whole)
    : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}
