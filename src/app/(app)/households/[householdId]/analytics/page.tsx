import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { io } from "next/cache";
import { ArrowLeftIcon, ChartColumnIcon } from "lucide-react";
import { Amount } from "@/components/amount";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { Skeleton } from "@/components/ui/skeleton";
import {
  averageMinor,
  barWidth,
  compareTotals,
  sharePermille,
} from "@/lib/analytics/figures";
import type { Analytics, Bucket } from "@/lib/analytics/payload";
import { nextBucket } from "@/lib/analytics/payload";
import {
  parseAnalyticsQuery,
  RANGE_LABELS,
  readAnalyticsQuery,
  type AnalyticsQuery,
} from "@/lib/analytics/query";
import { getAnalytics } from "@/lib/analytics/queries";
import { personName } from "@/lib/bills/board";
import { formatPermille } from "@/lib/budgets/figures";
import { addDays } from "@/lib/bills/schedule";
import { categoryLabel } from "@/lib/expenses/categories";
import { todayIn } from "@/lib/expenses/dates";
import { formatDate } from "@/lib/format";
import {
  getHousehold,
  listHouseholdPeople,
  type Household,
  type HouseholdPerson,
} from "@/lib/households/queries";
import { AnalyticsFilters } from "./analytics-filters";

export const metadata: Metadata = { title: "Spending analytics" };

export default function AnalyticsPage({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/analytics">) {
  return (
    <PageContainer className="space-y-8">
      <Suspense fallback={<AnalyticsSkeleton />}>
        <AnalyticsView params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function AnalyticsView({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/analytics">) {
  const { householdId } = await params;
  // Not a member (or no such household): the same 404, from the data layer.
  const household = await getHousehold(householdId);
  const [people, search] = await Promise.all([
    listHouseholdPeople(household.id),
    searchParams,
  ]);
  const base = `/households/${household.id}/analytics`;
  // Ranges are the household's own days (D11), worked out at request time.
  await io();
  const today = todayIn(household.timezone);
  const raw = readAnalyticsQuery(search);
  const parsed = parseAnalyticsQuery(raw, {
    today,
    personIds: people.map((p) => p.userId),
  });
  const name = (userId: string) =>
    personName(people, userId, household.myUserId);

  return (
    <div className="space-y-8">
      <Link
        href={`/households/${household.id}`}
        className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Household
      </Link>
      <PageHeader
        title="Spending analytics"
        description={`Where ${household.name}'s money goes, from the expenses recorded, in ${household.currencyCode}. Payments between members aren't spending, and bills count once they're recorded.`}
      />
      <AnalyticsFilters
        // Fields start again from the URL after every navigation.
        key={JSON.stringify(raw)}
        base={base}
        raw={raw}
        errors={parsed.ok ? {} : parsed.fieldErrors}
        people={people.map((p) => ({
          userId: p.userId,
          label:
            p.userId === household.myUserId
              ? `${p.displayName} (you)`
              : p.isActive
                ? p.displayName
                : `${p.displayName} (left)`,
        }))}
      />
      {parsed.ok ? (
        <Suspense
          key={JSON.stringify(parsed.query)}
          fallback={<FiguresSkeleton />}
        >
          <Figures
            household={household}
            query={parsed.query}
            name={name}
            people={people}
          />
        </Suspense>
      ) : (
        <p className="type-body">Fix the filters above to see the figures.</p>
      )}
    </div>
  );
}

const BUCKET_WORDS: Record<Bucket, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

function bucketLabel(
  start: string,
  bucket: Bucket,
  range: { from: string; to: string },
) {
  if (bucket === "day") return formatDate(start);
  if (bucket === "month") {
    const [y, m] = start.split("-").map(Number);
    return new Intl.DateTimeFormat("en-IN", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(y, m - 1, 1)));
  }
  // A week, cut to the range at either end.
  const from = start < range.from ? range.from : start;
  const end = addDays(nextBucket(start, bucket), -1);
  const to = end > range.to ? range.to : end;
  return `${formatDate(from)} – ${formatDate(to)}`;
}

async function Figures({
  household,
  query,
  name,
  people,
}: {
  household: Household;
  query: AnalyticsQuery;
  name: (userId: string) => string;
  people: HouseholdPerson[];
}) {
  const view = await getAnalytics(household.id, query);
  if (!view.ok) {
    return (
      <ErrorState
        title="The figures can't be shown right now"
        description="They didn't pass the checks that make sure every total adds up and belongs to this household, so nothing is shown. Nothing has been changed. Reload the page to try again."
      />
    );
  }
  const data: Analytics = view.data;
  const currency = household.currencyCode;
  const money = (minor: bigint, className?: string) => (
    <Amount minor={minor} currency={currency} className={className} />
  );
  const rangeText = `${formatDate(data.from)} – ${formatDate(data.to)}`;
  const compareText = `${formatDate(data.previousFrom)} – ${formatDate(data.previousTo)}`;
  const showing = [
    query.range === "custom"
      ? rangeText
      : `${RANGE_LABELS[query.range]} (${rangeText})`,
    query.category ? categoryLabel(query.category) : null,
    query.payer ? `paid by ${name(query.payer)}` : null,
  ].filter(Boolean);
  const comparison = compareTotals(data.totalMinor, data.previousTotalMinor);
  const average = averageMinor(data.totalMinor, data.expenseCount);
  const top = data.byCategory[0] ?? null;
  const largestCategory = data.byCategory.reduce(
    (m, c) => (c.totalMinor > m ? c.totalMinor : m),
    BigInt(0),
  );
  const largestBucket = data.trend.reduce(
    (m, t) => (t.totalMinor > m ? t.totalMinor : m),
    BigInt(0),
  );
  const base = `/households/${household.id}`;

  return (
    <div className="space-y-8">
      <p className="type-secondary" aria-live="polite">
        Showing: {showing.join(" · ")}
      </p>

      <Section title="Summary">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Spent">{money(data.totalMinor, "type-amount-lg")}</Stat>
          <Stat label="Expenses">
            <span className="type-amount-lg">{data.expenseCount}</span>
          </Stat>
          <Stat label="Average expense">
            {average === null ? (
              <span className="type-body">None yet</span>
            ) : (
              money(average)
            )}
          </Stat>
          <Stat label="Largest expense">
            {data.largest[0] ? (
              <span className="block space-y-1">
                {money(data.largest[0].amountMinor)}
                <Link
                  href={`${base}/expenses/${data.largest[0].id}`}
                  className="block truncate rounded-sm type-secondary text-primary underline underline-offset-4"
                >
                  {data.largest[0].description}
                </Link>
              </span>
            ) : (
              <span className="type-body">None yet</span>
            )}
          </Stat>
          <Stat label="Biggest category">
            {top ? (
              <span className="block">
                <span className="type-card-title">
                  {categoryLabel(top.category)}
                </span>{" "}
                <span className="type-secondary">{money(top.totalMinor)}</span>
              </span>
            ) : (
              <span className="type-body">None yet</span>
            )}
          </Stat>
          <Stat label={`Compared with ${compareText}`}>
            <span className="type-body">
              {comparison.kind === "no_previous" ? (
                "Nothing was recorded then, so there's nothing to compare with."
              ) : comparison.kind === "same" ? (
                <>The same as then ({money(data.previousTotalMinor)}).</>
              ) : (
                <>
                  {money(comparison.differenceMinor)} {comparison.kind} (
                  {formatPermille(comparison.permille)} {comparison.kind}) than{" "}
                  {money(data.previousTotalMinor)}.
                </>
              )}
            </span>
          </Stat>
        </dl>
      </Section>

      {data.expenseCount === 0 ? (
        <EmptyState
          icon={<ChartColumnIcon />}
          title="No expenses in this range"
          description="Nothing recorded matches these filters. Try a longer range or clear the filters."
        />
      ) : (
        <>
          <Section
            title="By category"
            description="What each category came to, biggest first."
          >
            <BarTable
              caption="Spending by category"
              headers={["Category", "Spent", "Share", "Expenses"]}
              rows={data.byCategory.map((c) => {
                const share = sharePermille(c.totalMinor, data.totalMinor);
                return {
                  key: c.category,
                  label: categoryLabel(c.category),
                  value: money(c.totalMinor),
                  extra: [
                    share === null ? "—" : formatPermille(share),
                    String(c.expenseCount),
                  ],
                  width: barWidth(c.totalMinor, largestCategory),
                };
              })}
            />
          </Section>

          <Section
            title="Over time"
            description={`By ${BUCKET_WORDS[data.bucket].toLowerCase()}, including ones with nothing recorded. Each expense counts on its own date.`}
          >
            <BarTable
              caption={`Spending by ${BUCKET_WORDS[data.bucket].toLowerCase()}`}
              headers={[BUCKET_WORDS[data.bucket], "Spent", "Expenses"]}
              rows={data.trend.map((t) => ({
                key: t.start,
                label: bucketLabel(t.start, data.bucket, data),
                value: money(t.totalMinor),
                extra: [String(t.expenseCount)],
                width: barWidth(t.totalMinor, largestBucket),
              }))}
            />
          </Section>

          <Section
            title="By person"
            description="Paid is what someone paid for when the expense was recorded. Share is their part of the split, what the expense was for them. They often differ, because one person pays for everyone; who owes whom is on the Balances page."
          >
            <div
              // A focusable region, so it can be scrolled by keyboard on a small screen.
              tabIndex={0}
              role="region"
              aria-label="Paid and share by person"
              className="overflow-x-auto rounded-xl border border-border bg-card"
            >
              <table className="w-full text-left">
                <caption className="sr-only">Paid and share by person</caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="p-3 type-label">
                      Person
                    </th>
                    <th scope="col" className="p-3 text-right type-label">
                      Paid
                    </th>
                    <th scope="col" className="p-3 text-right type-label">
                      Share
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.members]
                    .sort(
                      (a, b) =>
                        order(people, a.userId) - order(people, b.userId),
                    )
                    .map((m) => (
                      <tr
                        key={m.userId}
                        className="border-b border-border last:border-0"
                      >
                        <th scope="row" className="p-3 type-body font-normal">
                          {capitalise(name(m.userId))}
                        </th>
                        <td className="p-3 text-right">
                          {money(m.paidMinor)}
                          <span className="block type-help">
                            {m.paidCount === 1
                              ? "1 expense"
                              : `${m.paidCount} expenses`}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          {money(m.shareMinor)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            title="Largest expenses"
            description="Up to ten, biggest first."
          >
            <ol className="divide-y divide-border rounded-xl border border-border bg-card">
              {data.largest.map((l) => (
                <li key={l.id}>
                  <Link
                    href={`${base}/expenses/${l.id}`}
                    className="flex items-center gap-3 p-4 hover:bg-muted"
                  >
                    <span className="block min-w-0 flex-1 space-y-1">
                      <span className="block truncate type-card-title">
                        {l.description}
                      </span>
                      <span className="block type-secondary">
                        {categoryLabel(l.category)} ·{" "}
                        {formatDate(l.expenseDate)} · paid by {name(l.paidBy)}
                      </span>
                    </span>
                    {money(l.amountMinor)}
                  </Link>
                </li>
              ))}
            </ol>
          </Section>
        </>
      )}
    </div>
  );
}

function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Current members in join order, then former members (listHouseholdPeople's order). */
function order(people: HouseholdPerson[], userId: string) {
  const i = people.findIndex((p) => p.userId === userId);
  return i === -1 ? people.length : i;
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1 rounded-xl border border-border bg-card p-4">
      <dt className="type-label">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * A table that is also the chart: each row has its label, a bar (a picture of
 * the figure next to it, hidden from screen readers) and the figures. Screen
 * readers and anyone who can't see the bars get the same numbers.
 */
function BarTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: {
    key: string;
    label: string;
    value: React.ReactNode;
    extra: string[];
    width: number;
  }[];
}) {
  return (
    <div
      // A focusable region, so it can be scrolled by keyboard on a small screen.
      tabIndex={0}
      role="region"
      aria-label={caption}
      className="overflow-x-auto rounded-xl border border-border bg-card"
    >
      <table className="w-full text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="p-3 type-label">
              {headers[0]}
            </th>
            <th scope="col" className="hidden w-2/5 p-3 sm:table-cell">
              <span className="sr-only">Bar</span>
            </th>
            {headers.slice(1).map((h) => (
              <th key={h} scope="col" className="p-3 text-right type-label">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border last:border-0">
              <th scope="row" className="p-3 align-top type-body font-normal">
                {row.label}
                <span
                  aria-hidden="true"
                  className="mt-1.5 block h-2 rounded-full bg-muted sm:hidden"
                >
                  <span
                    className="block h-2 rounded-full bg-primary"
                    style={{ width: `${row.width}%` }}
                  />
                </span>
              </th>
              <td
                aria-hidden="true"
                className="hidden p-3 align-middle sm:table-cell"
              >
                <span className="block h-2.5 rounded-full bg-muted">
                  <span
                    className="block h-2.5 rounded-full bg-primary"
                    style={{ width: `${row.width}%` }}
                  />
                </span>
              </td>
              <td className="p-3 text-right align-top whitespace-nowrap">
                {row.value}
              </td>
              {row.extra.map((e, i) => (
                <td
                  key={i}
                  className="p-3 text-right align-top type-secondary whitespace-nowrap"
                >
                  {e}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FiguresSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading the figures"
      className="space-y-6"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading analytics"
      className="space-y-6"
    >
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
