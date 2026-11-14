"use client";

import { useId, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { FormAlert } from "@/components/form-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseAmount } from "@/domain/money/amount";
import { formatDate, formatMoney, minorToDecimalString } from "@/lib/format";
import type { Found, ReceiptExtraction } from "@/lib/receipts/extract";
import { PAYMENT_LABELS, warningMessage } from "@/lib/receipts/review";

// What was read from the receipt, shown beside the form (roadmap Phase 19).
// Everything here is the photo's reading, not a record: nothing on this panel
// is saved. Values that were hard to read say so in words, not colour alone.

function Check({ found }: { found: Found<unknown> | null }) {
  if (!found || found.confidence === "ok") return null;
  return (
    <Badge variant="warning" className="ml-2">
      {found.confidence === "low" ? "Hard to read" : "Check"}
    </Badge>
  );
}

type Row = { id: number; name: string; amount: string };

export function ReceiptDetails({
  extraction,
  currency,
  exponent,
}: {
  extraction: ReceiptExtraction;
  currency: string;
  exponent: number;
}) {
  const uid = useId();
  const money = (minor: bigint) => formatMoney(minor, currency);
  const [rows, setRows] = useState<Row[]>(() =>
    extraction.items.map((item, index) => ({
      id: index,
      name: item.quantity ? `${item.name} × ${item.quantity}` : item.name,
      amount: minorToDecimalString(item.totalMinor, exponent),
    })),
  );
  const [nextId, setNextId] = useState(extraction.items.length);

  let itemsMinor = BigInt(0);
  let unreadable = 0;
  for (const row of rows) {
    const parsed = parseAmount(row.amount, exponent);
    if (parsed.ok) itemsMinor += parsed.minor;
    else if (row.amount.trim() !== "") unreadable++;
  }
  const compareTo = extraction.subtotal ?? extraction.total;

  const details: {
    label: string;
    value: string;
    found: Found<unknown> | null;
  }[] = [];
  if (extraction.merchant)
    details.push({
      label: "Shop",
      value: extraction.merchant.value,
      found: extraction.merchant,
    });
  if (extraction.date) {
    details.push({
      label: "Date",
      value: `${formatDate(extraction.date.value)}${extraction.time ? `, ${extraction.time.value}` : ""}`,
      found: extraction.date,
    });
  }
  if (extraction.subtotal)
    details.push({
      label: "Subtotal",
      value: money(extraction.subtotal.value),
      found: extraction.subtotal,
    });
  for (const tax of extraction.taxes)
    details.push({ label: "Tax", value: money(tax.value), found: tax });
  for (const charge of extraction.charges)
    details.push({
      label: "Charge or rounding",
      value: money(charge.value),
      found: charge,
    });
  if (extraction.discount)
    details.push({
      label: "Discount",
      value: `− ${money(extraction.discount.value)}`,
      found: extraction.discount,
    });
  if (extraction.total)
    details.push({
      label: "Total",
      value: money(extraction.total.value),
      found: extraction.total,
    });
  if (extraction.currency)
    details.push({
      label: "Currency shown",
      value: extraction.currency.value,
      found: extraction.currency,
    });
  if (extraction.paymentMethod) {
    details.push({
      label: "Paid by",
      value: PAYMENT_LABELS[extraction.paymentMethod.value],
      found: extraction.paymentMethod,
    });
  }
  if (extraction.invoiceNumber)
    details.push({
      label: "Bill number",
      value: extraction.invoiceNumber.value,
      found: extraction.invoiceNumber,
    });

  return (
    <div className="space-y-6">
      <section aria-labelledby={`${uid}-read`} className="space-y-3">
        <h2 id={`${uid}-read`} className="type-section-title">
          Read from the receipt
        </h2>
        <p className="type-help">
          Read on this device, not checked. Only what you confirm in the form is
          saved.
        </p>
        {details.length > 0 ? (
          <dl className="divide-y divide-border rounded-xl border border-border bg-card">
            {details.map((detail, index) => (
              <div
                key={index}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3"
              >
                <dt className="type-secondary">{detail.label}</dt>
                <dd className="min-w-0 text-right type-label break-words">
                  {detail.value}
                  <Check found={detail.found} />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {extraction.warnings.length > 0 ? (
          <FormAlert tone="warning">
            <ul className="list-disc space-y-1 pl-4">
              {extraction.warnings.map((warning, index) => (
                <li key={index}>{warningMessage(warning, currency)}</li>
              ))}
            </ul>
          </FormAlert>
        ) : null}
      </section>

      <section aria-labelledby={`${uid}-items`} className="space-y-3">
        <h2 id={`${uid}-items`} className="type-section-title">
          Items
        </h2>
        <p className="type-help">
          To help you check the total. Items aren&apos;t saved, and they
          don&apos;t decide who pays what: the split does.
        </p>
        {rows.length > 0 ? (
          <ul className="space-y-2">
            {rows.map((row, index) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label={`Item ${index + 1}`}
                  value={row.name}
                  onChange={(event) =>
                    setRows(
                      rows.map((r) =>
                        r.id === row.id
                          ? { ...r, name: event.target.value }
                          : r,
                      ),
                    )
                  }
                  className="min-w-0 flex-1 basis-40"
                />
                <Input
                  aria-label={`Amount of item ${index + 1} (${currency})`}
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(event) =>
                    setRows(
                      rows.map((r) =>
                        r.id === row.id
                          ? { ...r, amount: event.target.value }
                          : r,
                      ),
                    )
                  }
                  className="w-28"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove item ${index + 1}`}
                  onClick={() => setRows(rows.filter((r) => r.id !== row.id))}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-secondary">No items were read.</p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setRows([...rows, { id: nextId, name: "", amount: "" }]);
            setNextId(nextId + 1);
          }}
        >
          <PlusIcon aria-hidden="true" data-icon="inline-start" />
          Add an item
        </Button>
        {rows.length > 0 ? (
          <p className="type-secondary" aria-live="polite">
            Items add up to {money(itemsMinor)}
            {compareTo
              ? itemsMinor === compareTo.value
                ? `, the same as the ${extraction.subtotal ? "subtotal" : "total"}.`
                : `; the ${extraction.subtotal ? "subtotal" : "total"} read is ${money(compareTo.value)}.`
              : "."}
            {unreadable > 0
              ? ` ${unreadable === 1 ? "One amount isn't" : `${unreadable} amounts aren't`} a valid amount yet.`
              : ""}
          </p>
        ) : null}
      </section>
    </div>
  );
}
