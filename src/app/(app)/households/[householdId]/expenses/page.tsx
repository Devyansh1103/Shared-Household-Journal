import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { io } from "next/cache";
import { PlusIcon, XIcon } from "lucide-react";
import { FormAlert } from "@/components/form-alert";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { todayIn } from "@/lib/expenses/dates";
import {
  activeFilterChips,
  activeFilterCount,
  historySearchParams,
  parseHistoryQuery,
  readHistoryQuery,
  type HistoryFilters as Filters,
} from "@/lib/expenses/history";
import { currencyExponent } from "@/lib/format";
import { getHousehold, listHouseholdPeople } from "@/lib/households/queries";
import { HistoryFilters } from "./history-filters";
import { HistoryResults, ResultsSkeleton } from "./history-results";

export const metadata: Metadata = { title: "Expense history" };

export default function ExpensesPage({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/expenses">) {
  return (
    <PageContainer className="space-y-8">
      <Suspense fallback={<HistorySkeleton />}>
        <ExpenseHistory params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function ExpenseHistory({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/expenses">) {
  const { householdId } = await params;
  const household = await getHousehold(householdId);
  const [people, query] = await Promise.all([
    listHouseholdPeople(household.id),
    searchParams,
  ]);
  // "Today", "this week" and the like are the household's own days (D11),
  // worked out at request time.
  await io();
  const today = todayIn(household.timezone);
  const exponent = currencyExponent(household.currencyCode);
  const base = `/households/${household.id}/expenses`;

  const raw = readHistoryQuery(query);
  const parsed = parseHistoryQuery(raw, {
    today,
    exponent,
    payerIds: people.map((p) => p.userId),
  });
  const labelled = people.map((person) => ({
    userId: person.userId,
    label:
      person.userId === household.myUserId
        ? `${person.displayName} (you)`
        : person.isActive
          ? person.displayName
          : `${person.displayName} (left)`,
  }));

  const addButton = (
    <Button asChild>
      <Link href={`${base}/new`}>
        <PlusIcon aria-hidden="true" data-icon="inline-start" />
        Add expense
      </Link>
    </Button>
  );

  return (
    <div className="space-y-8">
      {query.deleted === "1" ? (
        <FormAlert tone="success">
          The expense is deleted. It no longer counts towards anything, and the
          owner can restore it.{" "}
          <Link
            href={`${base}?status=deleted`}
            className="rounded-sm text-primary underline underline-offset-4"
          >
            See deleted expenses
          </Link>
        </FormAlert>
      ) : null}

      <PageHeader
        title="Expense history"
        description={`Every shared cost for ${household.name}. Search, filter and sort them; the figures count only the expenses that match.`}
        actions={addButton}
      />

      {/* Keyed by the URL's filters: the form's fields are uncontrolled, so
          after a navigation (a chip removed, "Clear all") it starts again from
          the new URL instead of keeping what was typed before. */}
      <HistoryFilters
        key={JSON.stringify(raw)}
        base={base}
        raw={raw}
        errors={parsed.ok ? {} : parsed.errors}
        people={labelled}
        currency={household.currencyCode}
        exponent={exponent}
        activeCount={parsed.ok ? activeFilterCount(parsed.filters) : 0}
      />

      {parsed.ok ? (
        <>
          <ActiveFilters
            chips={activeFilterChips(parsed.filters, {
              base,
              exponent,
              currency: household.currencyCode,
              people: labelled,
            })}
            clearHref={base}
          />
          {/* A new key for every view, so changing filters, the sort or the
              page shows the loading state rather than the old figures. */}
          <Suspense
            key={viewKey(parsed.filters, exponent)}
            fallback={<ResultsSkeleton />}
          >
            <HistoryResults
              household={household}
              filters={parsed.filters}
              base={base}
              exponent={exponent}
              addButton={addButton}
            />
          </Suspense>
        </>
      ) : (
        <FormAlert tone="error">
          Some of these filters can&apos;t be used, so no expenses are shown.
          Fix the ones marked in the filters above, or clear them all.
        </FormAlert>
      )}
    </div>
  );
}

/** The view's identity: its filters, plus the dates a preset resolved to. */
function viewKey(filters: Filters, exponent: number): string {
  return `${historySearchParams(filters, exponent)}|${filters.from}|${filters.to}`;
}

function ActiveFilters({
  chips,
  clearHref,
}: {
  chips: { key: string; label: string; href: string }[];
  clearHref: string;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p id="active-filters" className="type-label">
        Showing only:
      </p>
      <ul aria-labelledby="active-filters" className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.key} className="max-w-full">
            <Link
              href={chip.href}
              aria-label={`Remove filter: ${chip.label}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 type-label hover:bg-muted"
            >
              <span className="min-w-0 truncate">{chip.label}</span>
              <XIcon aria-hidden="true" className="size-3.5 shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href={clearHref}
        className="rounded-sm type-label text-primary underline-offset-4 hover:underline"
      >
        Clear all
      </Link>
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading expenses"
      className="space-y-6"
    >
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-14 w-full" />
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
