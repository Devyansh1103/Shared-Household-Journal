"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDownIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { EXPENSE_CATEGORIES } from "@/lib/expenses/categories";
import {
  DATE_RANGES,
  HISTORY_SORTS,
  RANGE_LABELS,
  SEARCH_MAX_LENGTH,
  SORT_LABELS,
  type HistoryField,
  type RawHistoryQuery,
} from "@/lib/expenses/history";

/** Values the URL leaves out because they're what you get anyway. */
const DEFAULTS: Record<string, string> = {
  range: "any",
  status: "counted",
  sort: "newest",
};

type HistoryFiltersProps = {
  /** The history page; the form's own (no-JavaScript) target. */
  base: string;
  /** What the URL says now, as given. */
  raw: RawHistoryQuery;
  errors: Partial<Record<HistoryField, string>>;
  /** Everyone who is or was a member, labelled ("Pat (left)", "Olive (you)"). */
  people: { userId: string; label: string }[];
  currency: string;
  exponent: number;
  /** How many filter groups (not search or sort) are in use. */
  activeCount: number;
};

/**
 * Search, sort and filters for the expense history. A GET form: without
 * JavaScript the browser submits it as it is. With JavaScript it navigates to
 * a clean URL (no empty fields or defaults), so a view can be refreshed or
 * shared, and any change goes back to page 1.
 */
export function HistoryFilters({
  base,
  raw,
  errors,
  people,
  currency,
  exponent,
  activeCount,
}: HistoryFiltersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Next.js keeps the previous page mounted (hidden) after navigating, so
  // ids must be unique.
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;

  const initialRange =
    raw.range === "" ? (raw.from || raw.to ? "custom" : "any") : raw.range;
  const [range, setRange] = useState(initialRange);
  const filterErrors = (
    [
      "range",
      "from",
      "to",
      "category",
      "payer",
      "min",
      "max",
      "status",
    ] as const
  ).some((field) => errors[field]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value !== "string") continue;
      const text = value.trim();
      if (text === "" || DEFAULTS[key] === text) continue;
      params.append(key, text);
    }
    const query = params.toString();
    startTransition(() => router.push(query ? `${base}?${query}` : base));
  }

  const describedBy = (field: HistoryField, help?: string) =>
    [help, errors[field] ? fid(`${field}-error`) : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <form
      action={base}
      method="get"
      onSubmit={submit}
      role="search"
      aria-label="Search and filter expenses"
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto] sm:items-start">
        <Field data-invalid={errors.q ? true : undefined}>
          <FieldLabel htmlFor={fid("q")}>Search</FieldLabel>
          <Input
            id={fid("q")}
            type="search"
            name="q"
            defaultValue={raw.q}
            maxLength={SEARCH_MAX_LENGTH}
            placeholder="Like “electricity” or “groceries”"
            autoComplete="off"
            aria-invalid={errors.q ? true : undefined}
            aria-describedby={describedBy("q", fid("q-help"))}
          />
          <FieldDescription id={fid("q-help")}>
            Searches descriptions and category names, ignoring capitals.
          </FieldDescription>
          <FieldError id={fid("q-error")}>{errors.q}</FieldError>
        </Field>

        <Field data-invalid={errors.sort ? true : undefined}>
          <FieldLabel htmlFor={fid("sort")}>Sort</FieldLabel>
          <NativeSelect
            id={fid("sort")}
            name="sort"
            className="w-full"
            defaultValue={raw.sort || "newest"}
            // A new order applies straight away.
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            aria-invalid={errors.sort ? true : undefined}
            aria-describedby={describedBy("sort")}
          >
            {HISTORY_SORTS.map((sort) => (
              <NativeSelectOption key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldError id={fid("sort-error")}>{errors.sort}</FieldError>
        </Field>

        <PendingButton
          pending={pending}
          pendingLabel="Searching…"
          className="sm:mt-7"
        >
          <SearchIcon aria-hidden="true" data-icon="inline-start" />
          Search
        </PendingButton>
      </div>

      <details
        open={filterErrors || undefined}
        className="group rounded-xl border border-border bg-card"
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl p-4 type-label group-open:rounded-b-none hover:bg-muted [&::-webkit-details-marker]:hidden">
          <SlidersHorizontalIcon
            aria-hidden="true"
            className="size-4 shrink-0"
          />
          Filters
          {activeCount > 0 ? (
            <Badge variant="info">{activeCount} in use</Badge>
          ) : null}
          <ChevronDownIcon
            aria-hidden="true"
            className="ml-auto size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>

        <div className="space-y-6 border-t border-border p-4">
          <div className="grid gap-6 md:grid-cols-2">
            <FieldSet
              data-invalid={
                errors.range || errors.from || errors.to ? true : undefined
              }
            >
              <FieldLegend variant="label">Date</FieldLegend>
              <RadioGroup
                name="range"
                value={range}
                onValueChange={setRange}
                aria-describedby={describedBy("range")}
              >
                {DATE_RANGES.map((value) => (
                  <Field key={value} orientation="horizontal">
                    <RadioGroupItem value={value} id={fid(`range-${value}`)} />
                    <FieldLabel
                      htmlFor={fid(`range-${value}`)}
                      className="font-normal"
                    >
                      {RANGE_LABELS[value]}
                    </FieldLabel>
                  </Field>
                ))}
              </RadioGroup>
              <FieldError id={fid("range-error")}>{errors.range}</FieldError>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field data-invalid={errors.from ? true : undefined}>
                  <FieldLabel htmlFor={fid("from")}>From</FieldLabel>
                  <Input
                    id={fid("from")}
                    type="date"
                    name="from"
                    defaultValue={raw.from}
                    // Only custom dates are sent; a preset means its own dates.
                    disabled={range !== "custom"}
                    aria-invalid={errors.from ? true : undefined}
                    aria-describedby={describedBy("from")}
                  />
                  <FieldError id={fid("from-error")}>{errors.from}</FieldError>
                </Field>
                <Field data-invalid={errors.to ? true : undefined}>
                  <FieldLabel htmlFor={fid("to")}>To</FieldLabel>
                  <Input
                    id={fid("to")}
                    type="date"
                    name="to"
                    defaultValue={raw.to}
                    disabled={range !== "custom"}
                    aria-invalid={errors.to ? true : undefined}
                    aria-describedby={describedBy("to")}
                  />
                  <FieldError id={fid("to-error")}>{errors.to}</FieldError>
                </Field>
              </div>
              <FieldDescription>
                Dates are the household&apos;s own days. Weeks run Monday to
                Sunday.
              </FieldDescription>
            </FieldSet>

            <FieldSet data-invalid={errors.category ? true : undefined}>
              <FieldLegend variant="label">Category</FieldLegend>
              <div className="grid gap-3 sm:grid-cols-2">
                {EXPENSE_CATEGORIES.map((category) => (
                  <Field key={category.value} orientation="horizontal">
                    <Checkbox
                      id={fid(`category-${category.value}`)}
                      name="category"
                      value={category.value}
                      defaultChecked={raw.category.includes(category.value)}
                    />
                    <FieldLabel
                      htmlFor={fid(`category-${category.value}`)}
                      className="font-normal"
                    >
                      {category.label}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
              <FieldDescription>
                None ticked means every category.
              </FieldDescription>
              <FieldError>{errors.category}</FieldError>
            </FieldSet>

            <FieldSet data-invalid={errors.payer ? true : undefined}>
              <FieldLegend variant="label">Paid by</FieldLegend>
              <div className="grid gap-3 sm:grid-cols-2">
                {people.map((person) => (
                  <Field key={person.userId} orientation="horizontal">
                    <Checkbox
                      id={fid(`payer-${person.userId}`)}
                      name="payer"
                      value={person.userId}
                      defaultChecked={raw.payer.includes(person.userId)}
                    />
                    <FieldLabel
                      htmlFor={fid(`payer-${person.userId}`)}
                      className="min-w-0 font-normal"
                    >
                      <span className="truncate">{person.label}</span>
                    </FieldLabel>
                  </Field>
                ))}
              </div>
              <FieldDescription>None ticked means anyone.</FieldDescription>
              <FieldError>{errors.payer}</FieldError>
            </FieldSet>

            <FieldSet
              data-invalid={errors.min || errors.max ? true : undefined}
            >
              <FieldLegend variant="label">Amount ({currency})</FieldLegend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field data-invalid={errors.min ? true : undefined}>
                  <FieldLabel htmlFor={fid("min")}>Minimum</FieldLabel>
                  <Input
                    id={fid("min")}
                    name="min"
                    inputMode={exponent > 0 ? "decimal" : "numeric"}
                    autoComplete="off"
                    className="type-amount"
                    defaultValue={raw.min}
                    aria-invalid={errors.min ? true : undefined}
                    aria-describedby={describedBy("min")}
                  />
                  <FieldError id={fid("min-error")}>{errors.min}</FieldError>
                </Field>
                <Field data-invalid={errors.max ? true : undefined}>
                  <FieldLabel htmlFor={fid("max")}>Maximum</FieldLabel>
                  <Input
                    id={fid("max")}
                    name="max"
                    inputMode={exponent > 0 ? "decimal" : "numeric"}
                    autoComplete="off"
                    className="type-amount"
                    defaultValue={raw.max}
                    aria-invalid={errors.max ? true : undefined}
                    aria-describedby={describedBy("max")}
                  />
                  <FieldError id={fid("max-error")}>{errors.max}</FieldError>
                </Field>
              </div>
              <FieldDescription>
                {exponent > 0
                  ? `Exact amounts, up to ${exponent} decimal place${exponent === 1 ? "" : "s"}. Both ends count.`
                  : "Whole amounts. Both ends count."}
              </FieldDescription>
            </FieldSet>

            <FieldSet data-invalid={errors.status ? true : undefined}>
              <FieldLegend variant="label">Show</FieldLegend>
              <RadioGroup
                name="status"
                defaultValue={raw.status || "counted"}
                aria-describedby={describedBy("status")}
              >
                <Field orientation="horizontal">
                  <RadioGroupItem value="counted" id={fid("status-counted")} />
                  <FieldLabel
                    htmlFor={fid("status-counted")}
                    className="font-normal"
                  >
                    Expenses that count
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <RadioGroupItem value="deleted" id={fid("status-deleted")} />
                  <FieldLabel
                    htmlFor={fid("status-deleted")}
                    className="font-normal"
                  >
                    Deleted expenses
                  </FieldLabel>
                </Field>
              </RadioGroup>
              <FieldDescription>
                Deleted expenses never count towards balances or totals.
              </FieldDescription>
              <FieldError id={fid("status-error")}>{errors.status}</FieldError>
            </FieldSet>
          </div>

          <div className="flex flex-wrap gap-2">
            <PendingButton pending={pending} pendingLabel="Applying…">
              Apply filters
            </PendingButton>
            <Button variant="outline" asChild>
              <Link href={base}>Clear all</Link>
            </Button>
          </div>
        </div>
      </details>
    </form>
  );
}

/** A submit button that shows the navigation it started is still loading. */
function PendingButton({
  pending,
  pendingLabel,
  className,
  children,
}: {
  pending: boolean;
  pendingLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={className}
    >
      {pending ? (
        <>
          <Spinner aria-hidden="true" data-icon="inline-start" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
