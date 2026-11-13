"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import {
  analyticsHref,
  RANGE_LABELS,
  RANGE_PRESETS,
  type RangePreset,
  type RawAnalyticsQuery,
} from "@/lib/analytics/query";
import { EXPENSE_CATEGORIES } from "@/lib/expenses/categories";

/**
 * The range, category and payer for every figure on the page. A GET form:
 * without JavaScript the browser submits it as it is; with JavaScript it
 * navigates to a clean URL. The custom dates are used, and sent, only with
 * "Custom dates".
 */
export function AnalyticsFilters({
  base,
  raw,
  errors,
  people,
}: {
  base: string;
  raw: RawAnalyticsQuery;
  errors: Record<string, string>;
  /** Everyone who is or was a member, labelled ("Pat (left)", "Olive (you)"). */
  people: { userId: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const [range, setRange] = useState(
    raw.range === "" ? "this_month" : raw.range,
  );
  const custom = range === "custom";

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => {
      const v = data.get(name);
      return typeof v === "string" ? v : "";
    };
    const href = analyticsHref(base, {
      range: (RANGE_PRESETS as readonly string[]).includes(value("range"))
        ? (value("range") as RangePreset)
        : "this_month",
      from: value("from"),
      to: value("to"),
      category: value("category") || null,
      payer: value("payer") || null,
    });
    startTransition(() => router.push(href));
  }

  const select = (
    name: "range" | "category" | "payer",
    label: string,
    options: { value: string; label: string }[],
    extra?: { value: string; onChange: (v: string) => void },
  ) => (
    <Field data-invalid={errors[name] ? true : undefined}>
      <FieldLabel htmlFor={fid(name)}>{label}</FieldLabel>
      <NativeSelect
        id={fid(name)}
        name={name}
        className="w-full"
        {...(extra
          ? {
              value: extra.value,
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
                extra.onChange(e.target.value),
            }
          : { defaultValue: raw[name] })}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? fid(`${name}-error`) : undefined}
      >
        {options.map((o) => (
          <NativeSelectOption key={o.value} value={o.value}>
            {o.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <FieldError id={fid(`${name}-error`)}>{errors[name]}</FieldError>
    </Field>
  );

  return (
    <form
      method="get"
      action={base}
      onSubmit={onSubmit}
      aria-label="Analytics filters"
      className="space-y-4 rounded-xl border border-border bg-card p-4"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {select(
          "range",
          "Dates",
          RANGE_PRESETS.map((p) => ({ value: p, label: RANGE_LABELS[p] })),
          { value: range, onChange: setRange },
        )}
        {select("category", "Category", [
          { value: "", label: "All categories" },
          ...EXPENSE_CATEGORIES.map((c) => ({
            value: c.value,
            label: c.label,
          })),
        ])}
        {select("payer", "Paid by", [
          { value: "", label: "Anyone" },
          ...people.map((p) => ({ value: p.userId, label: p.label })),
        ])}
      </div>
      {custom ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {(["from", "to"] as const).map((name) => (
            <Field key={name} data-invalid={errors[name] ? true : undefined}>
              <FieldLabel htmlFor={fid(name)}>
                {name === "from" ? "From" : "To"}
              </FieldLabel>
              <Input
                id={fid(name)}
                name={name}
                type="date"
                defaultValue={raw[name]}
                aria-invalid={errors[name] ? true : undefined}
                aria-describedby={`${fid("dates-help")}${errors[name] ? ` ${fid(`${name}-error`)}` : ""}`}
              />
              <FieldError id={fid(`${name}-error`)}>{errors[name]}</FieldError>
            </Field>
          ))}
          <FieldDescription id={fid("dates-help")} className="sm:col-span-2">
            Both days count. At most two years.
          </FieldDescription>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          disabled={pending}
          aria-busy={pending || undefined}
        >
          {pending ? (
            <Spinner aria-hidden="true" data-icon="inline-start" />
          ) : null}
          Show
        </Button>
        <Button variant="ghost" asChild>
          <Link href={base}>Clear filters</Link>
        </Button>
      </div>
    </form>
  );
}
