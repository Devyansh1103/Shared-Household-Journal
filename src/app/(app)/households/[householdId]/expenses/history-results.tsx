import Link from "next/link";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ReceiptIcon,
  SearchXIcon,
} from "lucide-react";
import { Amount } from "@/components/amount";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { FormAlert } from "@/components/form-alert";
import { Section } from "@/components/layout/section";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBasisPoints } from "@/domain/money/amount";
import { categoryLabel } from "@/lib/expenses/categories";
import {
  historyHref,
  isFiltered,
  SORT_LABELS,
  type HistoryFilters,
} from "@/lib/expenses/history";
import type { HistoryPage, HistoryRow } from "@/lib/expenses/history-payload";
import { getExpenseHistory } from "@/lib/expenses/queries";
import { formatDate, formatMoney } from "@/lib/format";
import type { Household } from "@/lib/households/queries";

const ZERO = BigInt(0);

/**
 * One page of the expense history, with a summary of everything that
 * matches. Everything shown comes from one call (one snapshot) and has passed
 * checkHistory; otherwise no figures are shown at all.
 */
export async function HistoryResults({
  household,
  filters,
  base,
  exponent,
  addButton,
}: {
  household: Household;
  filters: HistoryFilters;
  base: string;
  exponent: number;
  addButton: React.ReactNode;
}) {
  const view = await getExpenseHistory(household.id, filters);
  if (!view.ok) {
    return (
      <ErrorState
        title="Expenses can't be shown right now"
        description="The list didn't pass the checks that make sure every row and total is right, so nothing is shown. Nothing has been changed. Reload the page to try again."
      />
    );
  }

  const { history } = view;
  const currency = household.currencyCode;
  const deleted = filters.status === "deleted";
  const filtered = isFiltered(filters);

  if (!filtered && history.householdCount === 0) {
    return (
      <EmptyState
        icon={<ReceiptIcon />}
        title="No expenses yet"
        description={
          history.householdDeletedCount > 0
            ? "Nothing counts right now. Deleted expenses are under Filters → Show → Deleted expenses."
            : "Add the first shared cost, like rent or a grocery run, and choose how to split it."
        }
        action={addButton}
      />
    );
  }

  if (history.totalCount === 0) {
    return (
      <EmptyState
        icon={<SearchXIcon />}
        title={deleted ? "No deleted expenses match" : "No expenses match"}
        description={
          deleted && history.householdDeletedCount === 0
            ? "Nothing has been deleted in this household."
            : "Try other words, a wider date range or fewer filters."
        }
        action={
          <Button variant="outline" asChild>
            <Link href={base}>Clear all filters</Link>
          </Button>
        }
      />
    );
  }

  const first = (history.page - 1) * history.pageSize + 1;
  const last = first + history.rows.length - 1;
  return (
    <div className="space-y-8">
      {deleted ? (
        <p className="type-body">
          {history.totalCount === 1
            ? "1 deleted expense matches."
            : `${history.totalCount} deleted expenses match.`}{" "}
          Deleted expenses don&apos;t count towards balances or spending totals.
          The owner can restore one from its page.
        </p>
      ) : (
        <Summary
          history={history}
          filtered={filtered}
          currency={currency}
          householdName={household.name}
          base={base}
        />
      )}

      {filters.page > history.page ? (
        <FormAlert tone="info">
          {history.pageCount === 1
            ? "There's only 1 page, so this is it."
            : `There are only ${history.pageCount} pages, so this is the last one.`}
        </FormAlert>
      ) : null}

      <Section
        title={
          deleted
            ? "Deleted expenses"
            : filtered
              ? "Matching expenses"
              : "Expenses"
        }
        description={`Showing ${first}–${last} of ${history.totalCount}, ${SORT_LABELS[filters.sort].toLowerCase()}.`}
      >
        <ExpenseRows rows={history.rows} base={base} currency={currency} />
        <Pagination
          history={history}
          filters={filters}
          base={base}
          exponent={exponent}
        />
      </Section>
    </div>
  );
}

function Summary({
  history,
  filtered,
  currency,
  householdName,
  base,
}: {
  history: HistoryPage;
  filtered: boolean;
  currency: string;
  householdName: string;
  base: string;
}) {
  const money = (minor: bigint) => formatMoney(minor, currency);
  // The matching expenses' part of all counted spending, in basis points,
  // rounded half up with whole numbers only.
  const share =
    filtered && history.householdTotalMinor > ZERO
      ? formatBasisPoints(
          Number(
            (history.totalMinor * BigInt(20000) + history.householdTotalMinor) /
              (history.householdTotalMinor * BigInt(2)),
          ),
        )
      : null;
  const { largest } = history;

  return (
    <Card>
      <CardContent className="space-y-4">
        <h2 className="type-section-title">
          {filtered ? "What matches" : "All counted spending"}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Figure term={filtered ? "Matching expenses" : "Expenses"}>
            <span className="type-amount">{history.totalCount}</span>
          </Figure>
          <Figure term="Total">
            <Amount minor={history.totalMinor} currency={currency} />
          </Figure>
          <Figure term="Average">
            {history.averageMinor !== null ? (
              <Amount minor={history.averageMinor} currency={currency} />
            ) : null}
          </Figure>
          <Figure term="Largest">
            {largest ? (
              <span className="block min-w-0 space-y-0.5">
                <Amount minor={largest.amountMinor} currency={currency} />
                <Link
                  href={`${base}/${largest.expenseId}`}
                  className="block truncate rounded-sm type-secondary text-primary underline-offset-4 hover:underline"
                >
                  {largest.description}
                </Link>
              </span>
            ) : null}
          </Figure>
        </dl>
        <p className="type-help">
          {filtered
            ? `That's ${money(history.totalMinor)} of the ${money(history.householdTotalMinor)} counted across all ${history.householdCount} expenses in ${householdName}${share ? ` (${share}%)` : ""}.`
            : `That's everything counted in ${householdName}. Deleted expenses don't count.`}{" "}
          The average is rounded to the nearest {money(BigInt(1))}.
        </p>
      </CardContent>
    </Card>
  );
}

function Figure({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="type-label">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ExpenseRows({
  rows,
  base,
  currency,
}: {
  rows: HistoryRow[];
  base: string;
  currency: string;
}) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {rows.map((expense) => (
        <li key={expense.id} className="min-w-0">
          <Link
            href={`${base}/${expense.id}`}
            className="flex items-center gap-3 p-4 hover:bg-muted"
          >
            <span className="block min-w-0 flex-1 space-y-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate type-card-title">
                  {expense.description}
                </span>
                {expense.deletedAt ? (
                  <StatusBadge status="neutral">Deleted</StatusBadge>
                ) : null}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 type-secondary">
                <Badge variant="outline">
                  {categoryLabel(expense.category)}
                </Badge>
                <span>{formatDate(expense.expenseDate)}</span>
                <span aria-hidden="true">·</span>
                <span className="min-w-0 truncate">
                  Paid by{" "}
                  {expense.payerIsActive
                    ? expense.payerName
                    : `${expense.payerName} (left)`}
                </span>
              </span>
            </span>
            <Amount
              minor={expense.amountMinor}
              currency={currency}
              tone={expense.deletedAt ? "muted" : "neutral"}
              className={expense.deletedAt ? "line-through" : undefined}
            />
            <ChevronRightIcon
              aria-hidden="true"
              className="size-5 shrink-0 text-muted-foreground"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Pagination({
  history,
  filters,
  base,
  exponent,
}: {
  history: HistoryPage;
  filters: HistoryFilters;
  base: string;
  exponent: number;
}) {
  const { page, pageCount } = history;
  if (pageCount <= 1) return null;
  const href = (to: number) =>
    historyHref(base, filters, exponent, { page: to });
  return (
    <nav
      aria-label="Pages"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="type-secondary">
        Page {page} of {pageCount}
      </p>
      <ul className="flex flex-wrap gap-2">
        <li>
          <PageLink href={href(1)} disabled={page === 1} label="First page">
            <ChevronsLeftIcon aria-hidden="true" data-icon="inline-start" />
            First
          </PageLink>
        </li>
        <li>
          <PageLink
            href={href(page - 1)}
            disabled={page === 1}
            label="Previous page"
          >
            <ChevronLeftIcon aria-hidden="true" data-icon="inline-start" />
            Previous
          </PageLink>
        </li>
        <li>
          <PageLink
            href={href(page + 1)}
            disabled={page === pageCount}
            label="Next page"
          >
            Next
            <ChevronRightIcon aria-hidden="true" data-icon="inline-end" />
          </PageLink>
        </li>
        <li>
          <PageLink
            href={href(pageCount)}
            disabled={page === pageCount}
            label="Last page"
          >
            Last
            <ChevronsRightIcon aria-hidden="true" data-icon="inline-end" />
          </PageLink>
        </li>
      </ul>
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled aria-label={label}>
        {children}
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" asChild>
      <Link href={href} aria-label={label}>
        {children}
      </Link>
    </Button>
  );
}

export function ResultsSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading expenses"
      className="space-y-6"
    >
      <Skeleton className="h-32 w-full" />
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
