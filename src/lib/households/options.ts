// Currency and timezone choices for a new household (D1, D11). The lists come
// from the runtime's ISO 4217 and IANA data; the database checks them again
// (currency format and minor unit, and the timezone against pg_timezone_names).

import { isoMinorUnits } from "@/domain/money/currency";

const LOCALE = "en-IN";

/** D1: a household's currency defaults to INR. */
export const DEFAULT_CURRENCY = "INR";

// ICU still lists some zones under their old IANA names. Postgres knows both,
// so offer the current name.
const TIME_ZONE_RENAMES: Record<string, string> = {
  "America/Godthab": "America/Nuuk",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
};

export type CurrencyOption = { code: string; label: string };

let currencies: CurrencyOption[] | undefined;
let timeZones: string[] | undefined;

export function currencyOptions(): CurrencyOption[] {
  if (!currencies) {
    const names = new Intl.DisplayNames(LOCALE, { type: "currency" });
    currencies = Intl.supportedValuesOf("currency")
      // Codes without an ISO 4217 minor unit (e.g. XDR) can't hold money in
      // minor units (D2).
      .filter((code) => isoMinorUnits(code) !== null)
      .map((code) => {
        const name = names.of(code);
        return {
          code,
          label: name && name !== code ? `${code} — ${name}` : code,
        };
      });
  }
  return currencies;
}

/** The current IANA name for a timezone, e.g. "Asia/Calcutta" → "Asia/Kolkata". */
export function normalizeTimeZone(timeZone: string): string {
  return Object.hasOwn(TIME_ZONE_RENAMES, timeZone)
    ? TIME_ZONE_RENAMES[timeZone]
    : timeZone;
}

export function timeZoneOptions(): string[] {
  if (!timeZones) {
    timeZones = [
      ...new Set(Intl.supportedValuesOf("timeZone").map(normalizeTimeZone)),
    ].sort();
  }
  return timeZones;
}

export function isSupportedCurrency(code: string): boolean {
  return currencyOptions().some((option) => option.code === code);
}

export function isSupportedTimeZone(timeZone: string): boolean {
  return timeZoneOptions().includes(timeZone);
}

/** "America/Argentina/Buenos_Aires" → "America / Argentina / Buenos Aires". */
export function timeZoneLabel(timeZone: string): string {
  return timeZone.replaceAll("_", " ").replaceAll("/", " / ");
}
