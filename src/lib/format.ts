// Display formatting only. Money is stored as integer minor units (ADR-003);
// nothing here converts amounts through binary floating point.

const LOCALE = "en-IN";

/** Decimal places for an ISO 4217 currency, e.g. INR → 2, JPY → 0. */
export function currencyExponent(currency: string): number {
  return (
    new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
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
  const decimal = minorToDecimalString(minor, currencyExponent(currency));
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
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
