// From what was read on a receipt to the expense form's starting values, and
// the words for each warning (roadmap Phase 19). Pure, so it's tested.
//
// Only three things are filled in: the description (the shop's name), the
// amount (the total) and the date. Category, payer and split always come from
// the person (D31: a receipt never decides who pays what). Every value stays
// editable, and nothing is saved until the person confirms the form.

import type { RawExpenseForm } from "@/lib/expenses/form";
import { formatMoney, minorToDecimalString } from "@/lib/format";
import type {
  ExtractionWarning,
  PaymentMethod,
  ReceiptExtraction,
} from "./extract";

export type Prefill = {
  defaults: RawExpenseForm;
  /** Which form values came from the receipt (for the page to say so). */
  fromReceipt: { description: boolean; amount: boolean; date: boolean };
};

export function prefillFrom(
  extraction: ReceiptExtraction | null,
  blank: RawExpenseForm,
  exponent: number,
): Prefill {
  if (!extraction) {
    return {
      defaults: blank,
      fromReceipt: { description: false, amount: false, date: false },
    };
  }
  const total = extraction.total?.value;
  const useTotal = total !== undefined && total > BigInt(0);
  const futureDate = extraction.warnings.some(
    (w) => w.code === "date_in_future",
  );
  const useDate = Boolean(extraction.date) && !futureDate;
  const description = extraction.merchant?.value.slice(0, 120) ?? "";
  return {
    defaults: {
      ...blank,
      description: description || blank.description,
      amount: useTotal ? minorToDecimalString(total, exponent) : blank.amount,
      expenseDate: useDate ? extraction.date!.value : blank.expenseDate,
    },
    fromReceipt: {
      description: description !== "",
      amount: useTotal,
      date: useDate,
    },
  };
}

const FIELD_NAMES: Record<string, string> = {
  merchant: "the shop's name",
  date: "the date",
  total: "the total",
  subtotal: "the subtotal",
  tax: "the tax",
  discount: "the discount",
};

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** One warning in words. `currency` is the household's. */
export function warningMessage(
  warning: ExtractionWarning,
  currency: string,
): string {
  const money = (minor: bigint) => formatMoney(minor, currency);
  switch (warning.code) {
    case "nothing_read":
      return "No text could be read from this receipt. Fill in the details yourself, or try a sharper photo in good light.";
    case "no_total":
      return "No total was found. Enter the amount yourself.";
    case "no_date":
      return "No date was found, so today is filled in. Check it.";
    case "no_merchant":
      return "No shop name was found. Describe the expense yourself.";
    case "date_ambiguous":
      return "The date can be read two ways (day/month or month/day). It's read day first: check it.";
    case "date_in_future":
      return "The date read from the receipt is in the future, so today is filled in. Check it.";
    case "date_old":
      return "The date read from the receipt is more than a year ago. Check it.";
    case "other_currency":
      return `This receipt seems to be in ${warning.currency}. This household records amounts in ${currency}, with no conversion: enter what it came to in ${currency}.`;
    case "several_currencies":
      return `The receipt shows more than one currency (${list(warning.currencies)}). Check the amount.`;
    case "totals_differ":
      return `The figures don't add up: the subtotal, tax, charges and discounts come to ${money(warning.expectedMinor)}, but the total says ${money(warning.totalMinor)}. Check the amount.`;
    case "totals_rounding":
      return `The total (${money(warning.totalMinor)}) is a little different from the figures above it (${money(warning.expectedMinor)}), probably rounding. Check the amount.`;
    case "items_differ":
      return `The items read add up to ${money(warning.itemsMinor)}, not ${money(warning.againstMinor)}. Some may be missing or misread.`;
    case "low_confidence":
      return `Hard to read: ${list(warning.fields.map((f) => FIELD_NAMES[f] ?? f))}. Check against the receipt.`;
    case "unclear_lines":
      return warning.count === 1
        ? "One line of the receipt couldn't be read clearly, so something may be missing above (a tax or an item, for example). Check against the receipt."
        : `${warning.count} lines of the receipt couldn't be read clearly, so something may be missing above (a tax or an item, for example). Check against the receipt.`;
  }
}

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  other: "Other",
};
