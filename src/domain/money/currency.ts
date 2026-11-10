// ISO 4217 minor units: how many decimal places a currency's amounts have (D2).
//
// Pinned here instead of read from Intl. Intl uses CLDR data, which differs
// from ISO 4217 for some currencies (e.g. IQD: ISO 3, CLDR 0) and differs
// between runtimes (Node 22 and Edge 157 disagree on COP, HUF, IDR and PKR).
// A stored amount means "minor units at this exponent", so the exponent must
// never change underneath it.
//
// Source: ISO 4217 list one. Every active currency has 2 minor units except
// the codes below. Codes with no minor unit ("N.A.": precious metals, SDR,
// bond-market units, test codes) can't hold money in minor units, so they are
// never offered as a household currency (D1) and the database rejects them.

const ZERO_DECIMALS = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const THREE_DECIMALS = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

const FOUR_DECIMALS = new Set(["CLF", "UYW"]);

/** Codes ISO 4217 lists with no minor unit. Mirrored by a check on households. */
export const NO_MINOR_UNIT: ReadonlySet<string> = new Set([
  "XAG",
  "XAU",
  "XBA",
  "XBB",
  "XBC",
  "XBD",
  "XDR",
  "XPD",
  "XPT",
  "XSU",
  "XTS",
  "XUA",
  "XXX",
]);

/**
 * The ISO 4217 minor units of a currency code (INR 2, JPY 0, KWD 3, CLF 4), or
 * null for a malformed code or one without a minor unit.
 */
export function isoMinorUnits(code: string): number | null {
  if (!/^[A-Z]{3}$/.test(code) || NO_MINOR_UNIT.has(code)) return null;
  if (ZERO_DECIMALS.has(code)) return 0;
  if (THREE_DECIMALS.has(code)) return 3;
  if (FOUR_DECIMALS.has(code)) return 4;
  return 2;
}
