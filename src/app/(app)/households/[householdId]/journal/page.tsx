import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { CheckIcon } from "lucide-react";
import { cn } from "cn";
import { FormAlert } from "@/components/form-alert";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getHousehold } from "@/lib/households/queries";
import {
  FILTER_LABELS,
  formatCursor,
  JOURNAL_FILTERS,
  journalHref,
  parseJournalQuery,
  readJournalQuery,
  type JournalFilter,
} from "@/lib/journal/query";
import { JournalTimeline, TimelineSkeleton } from "./journal-timeline";

export const metadata: Metadata = { title: "Household journal" };

export default function JournalPage({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/journal">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<JournalSkeleton />}>
        <Journal params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function Journal({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/journal">) {
  const { householdId } = await params;
  // Not a member (or no such household): the same 404, from the data layer.
  const household = await getHousehold(householdId);
  const parsed = parseJournalQuery(readJournalQuery(await searchParams));
  const base = `/households/${household.id}/journal`;
  const filter: JournalFilter = parsed.ok ? parsed.query.filter : "all";

  return (
    <div className="space-y-8">
      <PageHeader
        title="Household journal"
        description={`What's happened in ${household.name}, newest first: expenses, payments, and people joining, leaving or inviting others.`}
      />

      <JournalFilters base={base} current={parsed.ok ? filter : null} />

      {parsed.ok ? (
        // A new key for every view, so a new filter or page shows the loading
        // state rather than the previous entries.
        <Suspense
          key={`${parsed.query.filter}|${parsed.query.before ? formatCursor(parsed.query.before) : ""}`}
          fallback={<TimelineSkeleton />}
        >
          <JournalTimeline
            household={household}
            query={parsed.query}
            base={base}
          />
        </Suspense>
      ) : (
        <FormAlert tone="error">
          {parsed.problem === "filter"
            ? "That link asks for a part of the journal that doesn't exist, so nothing is shown."
            : "That link to older activity isn't valid, so nothing is shown."}{" "}
          <Link
            href={base}
            className="rounded-sm text-primary underline underline-offset-4"
          >
            Show the latest activity
          </Link>
        </FormAlert>
      )}
    </div>
  );
}

/**
 * Links, not a form: each view has its own URL. Changing the filter goes back
 * to the newest entries. The current one is marked with aria-current, a check
 * and a heavier weight, not colour alone.
 */
function JournalFilters({
  base,
  current,
}: {
  base: string;
  /** Null when the URL's filter isn't valid: none is current. */
  current: JournalFilter | null;
}) {
  return (
    <nav aria-label="Show in the journal">
      <ul className="flex flex-wrap gap-2">
        {JOURNAL_FILTERS.map((filter) => {
          const active = filter === current;
          return (
            <li key={filter}>
              <Link
                href={journalHref(base, { filter, before: null })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 type-label hover:bg-muted",
                  active &&
                    "border-info bg-info-subtle font-semibold text-info hover:bg-info-subtle",
                )}
              >
                {active ? (
                  <CheckIcon aria-hidden="true" className="size-4" />
                ) : null}
                {FILTER_LABELS[filter]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function JournalSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading the journal"
      className="space-y-8"
    >
      <div className="space-y-2">
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-5 w-full" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}
