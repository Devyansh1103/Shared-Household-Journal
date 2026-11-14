// Turns the lines an OCR engine read from a receipt into suggested expense
// details (roadmap Phase 19). Pure: no engine, browser or network.
//
// Everything here is a guess for a person to check. A field the receipt
// doesn't clearly show stays empty; nothing is invented. Money is read into
// integer minor units with string and BigInt arithmetic, never floating
// point, at the household currency's decimal places (D2). Amounts on a line
// are read right to left (receipts put the amount last), dates day-first
// (en-IN, D18) with a warning when the order is ambiguous.

export type OcrLine = {
  text: string;
  /** 0–100 as the engine reports it; null when it gives none. */
  confidence: number | null;
};

/** How sure the engine was about the line a value came from. */
export type Confidence = "ok" | "low" | "unknown";

/** Below this (0–100) a value is flagged for checking. */
export const LOW_CONFIDENCE = 70;

export type Found<T> = { value: T; confidence: Confidence; line: string };

export type PaymentMethod = "cash" | "card" | "upi" | "other";

export type ReceiptItem = {
  name: string;
  quantity: string | null;
  unitMinor: bigint | null;
  totalMinor: bigint;
  confidence: Confidence;
};

export type ExtractionWarning =
  | { code: "nothing_read" }
  | { code: "no_total" }
  | { code: "no_date" }
  | { code: "no_merchant" }
  | { code: "date_ambiguous" }
  | { code: "date_in_future" }
  | { code: "date_old" }
  | { code: "other_currency"; currency: string }
  | { code: "several_currencies"; currencies: string[] }
  | { code: "totals_differ"; expectedMinor: bigint; totalMinor: bigint }
  | { code: "totals_rounding"; expectedMinor: bigint; totalMinor: bigint }
  | { code: "items_differ"; itemsMinor: bigint; againstMinor: bigint }
  | { code: "low_confidence"; fields: string[] }
  | { code: "unclear_lines"; count: number };

export type ReceiptExtraction = {
  merchant: Found<string> | null;
  /** ISO date (yyyy-mm-dd). */
  date: Found<string> | null;
  /** 24-hour hh:mm. */
  time: Found<string> | null;
  total: Found<bigint> | null;
  subtotal: Found<bigint> | null;
  taxes: Found<bigint>[];
  /** Sum of the discounts, as a positive amount. */
  discount: Found<bigint> | null;
  /** Service charges, delivery fees, rounding: signed. */
  charges: Found<bigint>[];
  /** ISO 4217 code the receipt shows, if it shows one. */
  currency: Found<string> | null;
  paymentMethod: Found<PaymentMethod> | null;
  invoiceNumber: Found<string> | null;
  items: ReceiptItem[];
  warnings: ExtractionWarning[];
};

export type ExtractContext = {
  /** The household's currency (D1). */
  currency: string;
  /** Its ISO 4217 decimal places (D2). */
  exponent: number;
  /** The household's date (D11), for checking the receipt's date. */
  today: string;
};

const MAX_MINOR = BigInt("999999999999");

function confidenceOf(line: OcrLine): Confidence {
  if (line.confidence === null || !Number.isFinite(line.confidence))
    return "unknown";
  return line.confidence < LOW_CONFIDENCE ? "low" : "ok";
}

function found<T>(value: T, line: OcrLine): Found<T> {
  return { value, confidence: confidenceOf(line), line: line.text };
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

// A number as printed: digits with optional grouping and one decimal mark,
// possibly negative or in brackets.
// Not part of a word or of a longer number ("A4", "7UP", "SKU-123").
const NUMBER_TOKEN = /(?<![\w.,-])\(?-?\d(?:[\d,.']*\d)?\)?(?![\w])/g;

/**
 * Reads one printed number into minor units at `exponent` decimal places, or
 * null when it isn't clearly an amount ("1.250" for a 2-decimal currency,
 * phone numbers, more decimals than the currency has).
 */
export function readAmount(token: string, exponent: number): bigint | null {
  let text = token.trim();
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1).trim();
  }
  text = text.replace(/[' ]/g, "");
  if (!/^\d[\d,.]*$/.test(text) || /[,.]$/.test(text)) return null;

  let whole = text;
  let fraction = "";
  const lastMark = Math.max(text.lastIndexOf("."), text.lastIndexOf(","));
  if (lastMark >= 0) {
    const after = text.slice(lastMark + 1);
    const before = text.slice(0, lastMark);
    const mark = text[lastMark];
    const otherMark = mark === "." ? "," : ".";
    if (
      exponent > 0 &&
      after.length <= exponent &&
      !(after.length === 3 && mark === ",")
    ) {
      // A decimal mark: "12.50", "12,50", "1,234.56", "1.234,56".
      if (before.includes(mark)) return null; // "1.2.50"
      whole = before.split(otherMark).join("");
      fraction = after;
      if (!/^\d+$/.test(whole) || !groupsOk(before, otherMark)) return null;
    } else if (after.length === 3) {
      // Grouping only: "1,250", "12,34,567" (Indian), "1.250.000".
      if (before.includes(otherMark)) return null;
      if (mark === "." && !before.includes(".")) return null; // "1.250" is ambiguous
      if (!groupsOk(text, mark)) return null;
      whole = text.split(mark).join("");
    } else {
      return null;
    }
  }
  if (!/^\d+$/.test(whole)) return null;
  // Long runs without grouping are phone, card or GST numbers, not money.
  if (lastMark < 0 && whole.length > 7) return null;
  if (fraction.length > exponent) return null;

  const minor = BigInt(whole + fraction.padEnd(exponent, "0"));
  if (minor > MAX_MINOR) return null;
  return negative ? -minor : minor;
}

function groupsOk(text: string, mark: string): boolean {
  if (!text.includes(mark)) return true;
  const [first, ...rest] = text.split(mark);
  if (first.length < 1 || first.length > 3) return false;
  // International groups of 3, or Indian: groups of 2 then a final 3.
  if (rest.every((g) => g.length === 3)) return true;
  return (
    rest.length >= 2 &&
    rest.slice(0, -1).every((g) => g.length === 2) &&
    rest[rest.length - 1].length === 3 &&
    first.length <= 2
  );
}

const DATE_LIKE =
  /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b|\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi;
const PERCENT = /\d+(?:[.,]\d+)?\s*%/g;

type MoneyToken = { raw: string; minor: bigint };

/** The amounts on a line, left to right (dates, times and percentages skipped). */
function moneyTokens(text: string, exponent: number): MoneyToken[] {
  const stripped = text
    .replace(DATE_LIKE, " ")
    .replace(PERCENT, " ")
    // "Rs.450.00", "₹450", "INR 450": the symbol isn't part of the number.
    .replace(/₹|\b(?:rs|inr)\.?(?=\s*\d)/gi, " ");
  const tokens: MoneyToken[] = [];
  for (const match of stripped.matchAll(NUMBER_TOKEN)) {
    const minor = readAmount(match[0], exponent);
    if (minor !== null) tokens.push({ raw: match[0], minor });
  }
  return tokens;
}

export function amountsOn(text: string, exponent: number): bigint[] {
  return moneyTokens(text, exponent).map((t) => t.minor);
}

function lastAmount(text: string, exponent: number): bigint | null {
  const amounts = amountsOn(text, exponent);
  return amounts.length ? amounts[amounts.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Line kinds
// ---------------------------------------------------------------------------

const GRAND_TOTAL =
  /\b(grand\s*total|net\s*(?:amount|payable|total|amt)|amount\s*(?:payable|due)|total\s*(?:amount|amt|payable|due|rs\.?|inr)|bill\s*amount|to\s*pay|balance\s*due|total\s*:?\s*₹)/i;
const TOTAL = /\btotal\b/i;
const NOT_TOTAL =
  /\b(sub\s*-?\s*total|total\s*(?:qty|quantity|items?|savings?|discount|tax|gst|vat|weight)|items?\s*total|no\.?\s*of\s*items)\b/i;
const SUBTOTAL =
  /\b(sub\s*-?\s*total|taxable\s*(?:amount|amt|value)|items?\s*total)\b/i;
const TAX_LINE =
  /\b(c\s*gst|s\s*gst|u\s*gst|i\s*gst|ut\s*gst|cess|vat|service\s*tax)\b/i;
const TAX_SUMMARY = /\b(total\s*(?:tax|gst)|gst|tax)\b/i;
const NOT_TAX =
  /\b(gstin|gst\s*(?:no|number|reg)|tax\s*invoice|taxable|incl(?:usive|\.|uding)?|excl)\b/i;
const DISCOUNT =
  /\b(discount|disc\.?|savings?|you\s*saved|coupon|promo|offer)\b/i;
const CHARGE =
  /\b(service\s*charge|delivery\s*(?:fee|charge)|packing|packaging|round(?:ed|ing)?\s*-?\s*off|rounding|tip|surcharge|convenience\s*fee)\b/i;
const NOT_MERCHANT =
  /\b(tax\s*invoice|invoice|receipt|bill\s*of\s*supply|cash\s*memo|estimate|gstin|gst|fssai|cin|phone|ph\.?|tel|mob(?:ile)?|e-?mail|www\.|http|welcome|thank|order|table|date|time|cashier|counter|token|bill\s*no|kot|original|duplicate|copy)\b|@/i;

function isItemLine(text: string): boolean {
  return !(
    TOTAL.test(text) ||
    SUBTOTAL.test(text) ||
    TAX_LINE.test(text) ||
    (TAX_SUMMARY.test(text) && !NOT_TAX.test(text)) ||
    DISCOUNT.test(text) ||
    CHARGE.test(text) ||
    PAYMENT_ANY.test(text) ||
    /\b(change|tendered|balance|paid)\b/i.test(text)
  );
}

// ---------------------------------------------------------------------------
// Dates and times
// ---------------------------------------------------------------------------

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 100) year += 2000;
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1)
    return null;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > days) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type DateRead = { iso: string; ambiguous: boolean };

/** The first date on a line, read day-first unless that can't be right. */
export function dateOn(text: string): DateRead | null {
  let m = /\b(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})\b/.exec(text);
  if (m) {
    const iso = isoDate(+m[1], +m[2], +m[3]);
    if (iso) return { iso, ambiguous: false };
  }
  m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/.exec(text);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const year = +m[3];
    if (a > 12 || (a <= 12 && b <= 12)) {
      const iso = isoDate(year, b, a);
      if (iso) return { iso, ambiguous: a <= 12 && b <= 12 && a !== b };
    }
    if (b > 12) {
      const iso = isoDate(year, a, b);
      if (iso) return { iso, ambiguous: false };
    }
  }
  const monthNames =
    "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
  m = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s-]*${monthNames}[\\s,'-]*(\\d{4}|\\d{2})\\b`,
    "i",
  ).exec(text);
  if (m) {
    const iso = isoDate(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
    if (iso) return { iso, ambiguous: false };
  }
  m = new RegExp(
    `\\b${monthNames}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,
    "i",
  ).exec(text);
  if (m) {
    const iso = isoDate(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
    if (iso) return { iso, ambiguous: false };
  }
  return null;
}

/** A time on a line, as 24-hour hh:mm. */
export function timeOn(text: string): string | null {
  const m = /\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\s*(am|pm)?\b/i.exec(
    text,
  );
  if (!m) return null;
  let hour = +m[1];
  const meridiem = m[3]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }
  return `${String(hour).padStart(2, "0")}:${m[2]}`;
}

function daysBetween(a: string, b: string): number {
  return (
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000
  );
}

// ---------------------------------------------------------------------------
// Currency, payment, invoice number
// ---------------------------------------------------------------------------

const KNOWN_CODES = new Set([
  "INR",
  "USD",
  "EUR",
  "GBP",
  "AED",
  "SGD",
  "JPY",
  "CNY",
  "AUD",
  "CAD",
  "CHF",
  "SAR",
  "QAR",
  "KWD",
  "BHD",
  "OMR",
  "NPR",
  "LKR",
  "BDT",
  "PKR",
  "MYR",
  "THB",
  "IDR",
  "HKD",
  "NZD",
  "ZAR",
]);

function currenciesOn(text: string): string[] {
  const codes: string[] = [];
  if (/₹|\brs\.?\s*\d|\brs\b|\brupees?\b/i.test(text)) codes.push("INR");
  if (/€/.test(text)) codes.push("EUR");
  if (/£/.test(text)) codes.push("GBP");
  if (/\bus\$|\busd\b/i.test(text)) codes.push("USD");
  for (const m of text.matchAll(/\b([A-Z]{3})\b/g)) {
    if (KNOWN_CODES.has(m[1])) codes.push(m[1]);
  }
  return codes;
}

const PAYMENT_UPI = /\b(upi|g\s*pay|google\s*pay|phone\s*pe|paytm|bhim)\b/i;
const PAYMENT_CARD =
  /\b(card|visa|master\s*card|rupay|amex|debit|credit|pos)\b/i;
const PAYMENT_CASH = /\bcash\b(?!ier)/i;
const PAYMENT_OTHER = /\b(net\s*banking|wallet|cheque|neft|imps)\b/i;
const PAYMENT_ANY = new RegExp(
  [PAYMENT_UPI, PAYMENT_CARD, PAYMENT_CASH, PAYMENT_OTHER]
    .map((r) => r.source)
    .join("|"),
  "i",
);

function paymentOn(text: string): PaymentMethod | null {
  if (PAYMENT_UPI.test(text)) return "upi";
  if (PAYMENT_CARD.test(text)) return "card";
  if (PAYMENT_CASH.test(text)) return "cash";
  if (PAYMENT_OTHER.test(text)) return "other";
  return null;
}

const INVOICE =
  /\b(?:invoice|inv|bill|receipt|order|txn|transaction)\s*(?:no\.?|number|num|#|id)\s*[:.#-]?\s*([A-Z0-9][A-Z0-9/-]{1,30})/i;

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function hasDecimals(raw: string, exponent: number): boolean {
  const digits = raw.replace(/\)$/, "");
  const mark = Math.max(digits.lastIndexOf("."), digits.lastIndexOf(","));
  return mark >= 0 && digits.length - mark - 1 === exponent;
}

function itemOn(line: OcrLine, exponent: number): ReceiptItem | null {
  const text = clean(line.text);
  if (!/[a-z]{2,}/i.test(text)) return null;
  const tokens = moneyTokens(text, exponent);
  if (tokens.length === 0) return null;
  const amounts = tokens.map((t) => t.minor);
  const total = amounts[amounts.length - 1];
  if (total <= BigInt(0)) return null;
  // A price is printed with its decimals ("45.00"); a bare number at the end
  // of a line is more likely a PIN code, a phone number or a count.
  if (exponent > 0 && !hasDecimals(tokens[tokens.length - 1].raw, exponent)) {
    return null;
  }

  // The name: what comes before the first number standing on its own ("2",
  // "(12)", "45.00"), so "Milk 1L" and "Eggs 6pc" keep their sizes.
  const firstNumber = text.search(/(?:^|\s)\(?-?\d[\d,.]*\)?(?=\s|$)/);
  const name = clean(
    (firstNumber > 0
      ? text.slice(0, firstNumber)
      : text.replace(/[\d.,()-]+/g, " ")
    )
      .replace(/^[^a-z]+/i, "")
      .replace(/[^a-z0-9)]+$/i, ""),
  );
  if (!/[a-z]{2,}/i.test(name)) return null;

  let quantity: string | null = null;
  let unit: bigint | null = null;
  const times = /(\d+(?:\.\d+)?)\s*(?:x|×|\*|@)\s*([\d,]+(?:\.\d{1,2})?)/i.exec(
    text,
  );
  if (times) {
    quantity = times[1];
    unit = readAmount(times[2], exponent);
  } else if (amounts.length >= 3) {
    const q = /(?:^|\s)(\d{1,3}(?:\.\d{1,3})?)\s/.exec(text.slice(firstNumber));
    quantity = q ? q[1] : null;
    unit = amounts[amounts.length - 2];
  }
  return {
    name,
    quantity,
    unitMinor: unit,
    totalMinor: total,
    confidence: confidenceOf(line),
  };
}

// ---------------------------------------------------------------------------
// Everything
// ---------------------------------------------------------------------------

/** Suggested expense details from a receipt's lines, with what to check. */
export function extractReceipt(
  input: OcrLine[],
  context: ExtractContext,
): ReceiptExtraction {
  const lines = input
    .map((line) => ({ ...line, text: clean(line.text) }))
    .filter((line) => line.text.length > 0);
  const { exponent } = context;
  const warnings: ExtractionWarning[] = [];

  const result: ReceiptExtraction = {
    merchant: null,
    date: null,
    time: null,
    total: null,
    subtotal: null,
    taxes: [],
    discount: null,
    charges: [],
    currency: null,
    paymentMethod: null,
    invoiceNumber: null,
    items: [],
    warnings,
  };
  if (lines.length === 0) {
    warnings.push({ code: "nothing_read" });
    return result;
  }

  // Totals: the strongest wording wins; the last line of that strength (a
  // receipt's grand total is usually below anything called "total" before).
  let totalRank = 0;
  let firstSummaryLine = lines.length;
  const discounts: Found<bigint>[] = [];
  const taxSummaries: Found<bigint>[] = [];
  lines.forEach((line, index) => {
    const text = line.text;
    const amount = lastAmount(text, exponent);
    const summary =
      SUBTOTAL.test(text) ||
      (TOTAL.test(text) && !NOT_TOTAL.test(text)) ||
      GRAND_TOTAL.test(text) ||
      TAX_LINE.test(text);
    if (summary) firstSummaryLine = Math.min(firstSummaryLine, index);
    if (amount === null) return;

    if (SUBTOTAL.test(text)) {
      if (amount > BigInt(0)) result.subtotal = found(amount, line);
      return;
    }
    const rank = GRAND_TOTAL.test(text)
      ? 2
      : TOTAL.test(text) && !NOT_TOTAL.test(text)
        ? 1
        : 0;
    if (rank > 0 && rank >= totalRank && amount > BigInt(0)) {
      totalRank = rank;
      result.total = found(amount, line);
      return;
    }
    if (rank > 0) return;
    if (NOT_TAX.test(text) && !TAX_LINE.test(text)) return;
    if (TAX_LINE.test(text)) {
      if (amount > BigInt(0)) result.taxes.push(found(amount, line));
      return;
    }
    if (TAX_SUMMARY.test(text)) {
      if (amount > BigInt(0)) taxSummaries.push(found(amount, line));
      return;
    }
    if (DISCOUNT.test(text)) {
      if (amount !== BigInt(0))
        discounts.push(found(amount < BigInt(0) ? -amount : amount, line));
      return;
    }
    if (CHARGE.test(text)) {
      if (amount !== BigInt(0)) result.charges.push(found(amount, line));
    }
  });
  // Individual taxes (CGST, SGST…) if there are any; otherwise a summary line.
  if (result.taxes.length === 0 && taxSummaries.length > 0) {
    result.taxes.push(taxSummaries[taxSummaries.length - 1]);
  }
  if (discounts.length > 0) {
    const sum = discounts.reduce((acc, d) => acc + d.value, BigInt(0));
    const worst = discounts.some((d) => d.confidence === "low")
      ? "low"
      : discounts.some((d) => d.confidence === "unknown")
        ? "unknown"
        : "ok";
    result.discount = {
      value: sum,
      confidence: worst,
      line: discounts.map((d) => d.line).join(" / "),
    };
  }

  // The merchant: the first plain line near the top.
  for (const line of lines.slice(0, 6)) {
    const text = line.text;
    if (!/[a-z].*[a-z].*[a-z]/i.test(text)) continue;
    if (
      NOT_MERCHANT.test(text) ||
      dateOn(text) ||
      /^[\d\s.,:/()+-]+$/.test(text)
    )
      continue;
    if (amountsOn(text, exponent).length > 0 && /\d[.,]\d/.test(text)) continue;
    const name = clean(text.replace(/^[^a-z0-9]+|[^a-z0-9.)&']+$/gi, ""));
    if (name.length >= 3) {
      result.merchant = found(name.slice(0, 120), line);
      break;
    }
  }

  // Date: a line that says "date" first, otherwise the first date anywhere.
  let dateLine = lines.find(
    (line) => /\b(date|dt|dated)\b/i.test(line.text) && dateOn(line.text),
  );
  dateLine ??= lines.find((line) => dateOn(line.text));
  if (dateLine) {
    const read = dateOn(dateLine.text)!;
    result.date = found(read.iso, dateLine);
    if (read.ambiguous) warnings.push({ code: "date_ambiguous" });
    const age = daysBetween(read.iso, context.today);
    if (age < 0) warnings.push({ code: "date_in_future" });
    else if (age > 366) warnings.push({ code: "date_old" });
  }
  const timeLine = lines.find((line) => timeOn(line.text));
  if (timeLine) result.time = found(timeOn(timeLine.text)!, timeLine);

  // Currency: what the receipt shows, if one clearly.
  const seen = new Map<string, OcrLine>();
  for (const line of lines)
    for (const code of currenciesOn(line.text))
      if (!seen.has(code)) seen.set(code, line);
  if (seen.size === 1) {
    const [[code, line]] = [...seen];
    result.currency = found(code, line);
    if (code !== context.currency)
      warnings.push({ code: "other_currency", currency: code });
  } else if (seen.size > 1) {
    const codes = [...seen.keys()].sort();
    warnings.push({ code: "several_currencies", currencies: codes });
    const other = codes.filter((c) => c !== context.currency);
    if (other.length === codes.length)
      warnings.push({ code: "other_currency", currency: other[0] });
  }

  // Payment method: only when the receipt points to one kind.
  const methods = new Map<PaymentMethod, OcrLine>();
  for (const line of lines) {
    const method = paymentOn(line.text);
    if (method && !methods.has(method)) methods.set(method, line);
  }
  if (methods.size === 1) {
    const [[method, line]] = [...methods];
    result.paymentMethod = found(method, line);
  }

  for (const line of lines) {
    const m = INVOICE.exec(line.text);
    if (m && /\d/.test(m[1])) {
      result.invoiceNumber = found(m[1], line);
      break;
    }
  }

  // Items: lines with a name and an amount, between the header and the totals.
  const merchantIndex = result.merchant
    ? lines.findIndex((l) => l.text === result.merchant!.line)
    : -1;
  for (let i = merchantIndex + 1; i < firstSummaryLine; i++) {
    const line = lines[i];
    if (dateOn(line.text) || timeOn(line.text) || INVOICE.test(line.text))
      continue;
    if (NOT_MERCHANT.test(line.text) || !isItemLine(line.text)) continue;
    const item = itemOn(line, exponent);
    if (item) result.items.push(item);
  }

  // What's missing, and whether the figures agree.
  if (!result.total) warnings.push({ code: "no_total" });
  if (!result.date) warnings.push({ code: "no_date" });
  if (!result.merchant) warnings.push({ code: "no_merchant" });

  const taxMinor = result.taxes.reduce((acc, t) => acc + t.value, BigInt(0));
  const chargeMinor = result.charges.reduce(
    (acc, c) => acc + c.value,
    BigInt(0),
  );
  const discountMinor = result.discount?.value ?? BigInt(0);
  if (result.total && result.subtotal) {
    const expected =
      result.subtotal.value + taxMinor + chargeMinor - discountMinor;
    const total = result.total.value;
    // Prices that already include tax: the subtotal is the total.
    const inclusive = result.subtotal.value === total && taxMinor > BigInt(0);
    const difference = expected > total ? expected - total : total - expected;
    if (expected !== total && !inclusive) {
      const oneUnit = BigInt(10) ** BigInt(exponent);
      warnings.push({
        code: difference < oneUnit ? "totals_rounding" : "totals_differ",
        expectedMinor: expected,
        totalMinor: total,
      });
    }
  }
  if (result.items.length > 0) {
    const itemsMinor = result.items.reduce(
      (acc, item) => acc + item.totalMinor,
      BigInt(0),
    );
    const against =
      result.subtotal?.value ??
      (result.taxes.length === 0 &&
      result.charges.length === 0 &&
      !result.discount
        ? result.total?.value
        : undefined);
    if (against !== undefined && itemsMinor !== against) {
      warnings.push({
        code: "items_differ",
        itemsMinor,
        againstMinor: against,
      });
    }
  }

  const low: string[] = [];
  if (result.merchant?.confidence === "low") low.push("merchant");
  if (result.date?.confidence === "low") low.push("date");
  if (result.total?.confidence === "low") low.push("total");
  if (result.subtotal?.confidence === "low") low.push("subtotal");
  if (result.taxes.some((t) => t.confidence === "low")) low.push("tax");
  if (result.discount?.confidence === "low") low.push("discount");
  if (low.length > 0) warnings.push({ code: "low_confidence", fields: low });

  // Hard-to-read lines that didn't become any value: a tax or an item may be
  // missing because it couldn't be read, so say so rather than stay silent.
  const used = new Set(
    [
      result.merchant,
      result.date,
      result.time,
      result.total,
      result.subtotal,
      result.currency,
      result.paymentMethod,
      result.invoiceNumber,
      ...result.taxes,
      ...result.charges,
    ].flatMap((found) => (found ? [found.line] : [])),
  );
  const unclear = lines.filter(
    (line) =>
      confidenceOf(line) === "low" &&
      !used.has(line.text) &&
      !result.items.some((i) => line.text.includes(i.name)),
  ).length;
  if (unclear > 0) warnings.push({ code: "unclear_lines", count: unclear });

  return result;
}
