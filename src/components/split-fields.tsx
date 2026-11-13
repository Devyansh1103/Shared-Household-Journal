"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  formatBasisPoints,
  parseAmount,
  parsePercent,
} from "@/domain/money/amount";
import {
  computeSplit,
  FULL_BASIS_POINTS,
  type Share,
  type SplitMethod,
} from "@/domain/money/split";
import { percentField, shareField } from "@/lib/expenses/form";
import { formatMoney } from "@/lib/format";

const METHODS: { value: SplitMethod; label: string; help: string }[] = [
  { value: "equal", label: "Equally", help: "Everyone ticked pays the same." },
  {
    value: "percentage",
    label: "By percentage",
    help: "Percentages must add up to 100%.",
  },
  {
    value: "custom",
    label: "Custom amounts",
    help: "Amounts must add up to the total.",
  },
];

export type FormMember = { userId: string; displayName: string };

export type SplitDefaults = {
  splitMethod: string;
  participants: string[];
  /** Custom split amounts, by user id. */
  shares: Record<string, string>;
  /** Percentage split values, by user id. */
  percents: Record<string, string>;
};

/**
 * How a cost is split: the method, who shares it, and their percentages or
 * amounts, with a live preview from the same engine the server uses. Used by
 * the expense form and the recurring bill form; the fields it submits are
 * read by readExpenseForm (splitMethod, participants, share:…, percent:…).
 */
export function SplitFields({
  fid,
  members,
  currency,
  exponent,
  amount,
  defaults,
  errors,
}: {
  /** Builds a unique id from a name (the form's useId prefix). */
  fid: (name: string) => string;
  /** Active members in the order they joined. */
  members: FormMember[];
  currency: string;
  exponent: number;
  /** The amount as typed, for the preview. */
  amount: string;
  defaults: SplitDefaults;
  errors: Record<string, string>;
}) {
  const [method, setMethod] = useState<SplitMethod>(
    (defaults.splitMethod as SplitMethod) || "equal",
  );
  const [participants, setParticipants] = useState(
    () => new Set(defaults.participants),
  );
  const [shares, setShares] = useState(defaults.shares);
  const [percents, setPercents] = useState(defaults.percents);

  const preview = previewSplit({
    currency,
    amount,
    exponent,
    method,
    participants: members
      .map((m) => m.userId)
      .filter((id) => participants.has(id)),
    shares,
    percents,
  });
  const money = (minor: bigint) => formatMoney(minor, currency);

  function toggle(userId: string, checked: boolean) {
    setParticipants((current) => {
      const next = new Set(current);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  return (
    <>
      <FieldSet>
        <FieldLegend variant="label">How should it be split?</FieldLegend>
        <RadioGroup
          name="splitMethod"
          value={method}
          onValueChange={(value) => setMethod(value as SplitMethod)}
          aria-describedby={fid("method-help")}
        >
          {METHODS.map((option) => (
            <Field key={option.value} orientation="horizontal">
              <RadioGroupItem
                value={option.value}
                id={fid(`method-${option.value}`)}
              />
              <FieldLabel
                htmlFor={fid(`method-${option.value}`)}
                className="font-normal"
              >
                {option.label}
              </FieldLabel>
            </Field>
          ))}
        </RadioGroup>
        <FieldDescription id={fid("method-help")}>
          {METHODS.find((m) => m.value === method)?.help}
        </FieldDescription>
      </FieldSet>

      <FieldSet data-invalid={errors.participants ? true : undefined}>
        <FieldLegend variant="label">Split between</FieldLegend>
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {members.map((member) => {
            const checked = participants.has(member.userId);
            const share = preview.shares?.get(member.userId);
            const inputName =
              method === "percentage"
                ? percentField(member.userId)
                : shareField(member.userId);
            const rowError =
              method === "percentage"
                ? errors[percentField(member.userId)]
                : method === "custom"
                  ? errors[shareField(member.userId)]
                  : undefined;
            const checkboxId = fid(`participant-${member.userId}`);
            const inputId = fid(`participant-value-${member.userId}`);
            return (
              <li
                key={member.userId}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Checkbox
                    id={checkboxId}
                    name="participants"
                    value={member.userId}
                    checked={checked}
                    onCheckedChange={(value) =>
                      toggle(member.userId, value === true)
                    }
                  />
                  <label
                    htmlFor={checkboxId}
                    className="min-w-0 truncate type-label"
                  >
                    {member.displayName}
                  </label>
                </div>

                {method === "equal" ? (
                  <span className="type-secondary type-amount">
                    {checked && share !== undefined ? money(share) : "—"}
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <label htmlFor={inputId} className="sr-only">
                      {method === "percentage"
                        ? `${member.displayName}'s percentage`
                        : `${member.displayName}'s amount`}
                    </label>
                    <Input
                      id={inputId}
                      name={inputName}
                      inputMode="decimal"
                      autoComplete="off"
                      disabled={!checked}
                      className="w-28 type-amount"
                      value={
                        method === "percentage"
                          ? (percents[member.userId] ?? "")
                          : (shares[member.userId] ?? "")
                      }
                      onChange={(event) => {
                        const value = event.target.value;
                        if (method === "percentage") {
                          setPercents((p) => ({
                            ...p,
                            [member.userId]: value,
                          }));
                        } else {
                          setShares((s) => ({
                            ...s,
                            [member.userId]: value,
                          }));
                        }
                      }}
                      aria-invalid={rowError ? true : undefined}
                      aria-describedby={
                        rowError ? `${inputId}-error` : undefined
                      }
                    />
                    <span aria-hidden="true" className="type-secondary">
                      {method === "percentage" ? "%" : currency}
                    </span>
                  </div>
                )}
                {rowError ? (
                  <p
                    id={`${inputId}-error`}
                    role="alert"
                    className="w-full text-sm text-destructive"
                  >
                    {rowError}
                  </p>
                ) : null}
                {method === "percentage" && checked && share !== undefined ? (
                  <p className="w-full text-right type-help">{money(share)}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="type-secondary" aria-live="polite">
          {preview.summary}
        </p>
        <FieldError>{errors.participants}</FieldError>
      </FieldSet>
    </>
  );
}

/** What the split would be right now, for the live preview. */
function previewSplit(input: {
  currency: string;
  amount: string;
  exponent: number;
  method: SplitMethod;
  participants: string[];
  shares: Record<string, string>;
  percents: Record<string, string>;
}): { shares?: Map<string, bigint>; summary: string } {
  const total = parseAmount(input.amount, input.exponent);
  if (!total.ok) return { summary: "Enter the amount to see each share." };
  if (input.participants.length === 0) {
    return { summary: "Tick at least one person." };
  }

  const toMap = (shares: Share[]) =>
    new Map(shares.map((s) => [s.userId, s.shareMinor]));

  if (input.method === "equal") {
    const result = computeSplit({
      method: "equal",
      total: total.minor,
      participants: input.participants,
    });
    return result.ok
      ? {
          shares: toMap(result.shares),
          summary: `Split equally between ${input.participants.length} ${input.participants.length === 1 ? "person" : "people"}.`,
        }
      : { summary: result.error };
  }

  if (input.method === "percentage") {
    // Blanks count as 0% while typing, so the remainder is always shown; the
    // server still requires a value for everyone ticked.
    let sum = 0;
    const entries = [];
    for (const userId of input.participants) {
      const value = (input.percents[userId] ?? "").trim();
      const parsed = value
        ? parsePercent(value)
        : { ok: true as const, basisPoints: 0 };
      if (!parsed.ok) return { summary: parsed.error };
      sum += parsed.basisPoints;
      entries.push({ userId, basisPoints: parsed.basisPoints });
    }
    if (sum !== FULL_BASIS_POINTS) {
      const left = FULL_BASIS_POINTS - sum;
      return {
        summary:
          left > 0
            ? `${formatBasisPoints(left)}% still to assign.`
            : `${formatBasisPoints(-left)}% too much: percentages must add up to 100%.`,
      };
    }
    const result = computeSplit({
      method: "percentage",
      total: total.minor,
      participants: entries,
    });
    return result.ok
      ? { shares: toMap(result.shares), summary: "Percentages add up to 100%." }
      : { summary: result.error };
  }

  let sum = BigInt(0);
  for (const userId of input.participants) {
    const value = (input.shares[userId] ?? "").trim();
    // Blank or zero counts as nothing yet (see percentages above).
    if (!value || /^0(\.0+)?$/.test(value)) continue;
    const parsed = parseAmount(value, input.exponent);
    if (!parsed.ok) return { summary: parsed.error };
    sum += parsed.minor;
  }
  const left = total.minor - sum;
  return {
    summary:
      left === BigInt(0)
        ? "The amounts add up to the total."
        : left > BigInt(0)
          ? `${formatMoney(left, input.currency)} still to assign.`
          : `${formatMoney(-left, input.currency)} too much.`,
  };
}
