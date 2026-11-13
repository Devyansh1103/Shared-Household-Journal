import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { io } from "next/cache";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PiggyBankIcon,
  PlusIcon,
} from "lucide-react";
import { Amount } from "@/components/amount";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { FilterChips } from "@/components/filter-chips";
import { FormAlert } from "@/components/form-alert";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { BudgetRow } from "@/lib/budgets/payload";
import {
  BUDGET_PERIODS,
  isBudgetPeriod,
  PERIOD_ADJECTIVES,
  PERIOD_NOUNS,
  periodEnd,
  periodLabel,
  periodStart,
  relativePeriod,
  shiftPeriod,
  type BudgetPeriod,
} from "@/lib/budgets/period";
import { getBudgets } from "@/lib/budgets/queries";
import { isCalendarDate, todayIn } from "@/lib/expenses/dates";
import { formatDate } from "@/lib/format";
import { getHousehold } from "@/lib/households/queries";
import { BudgetCard } from "./budget-card";

export const metadata: Metadata = { title: "Budgets" };

export default function BudgetsPage({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/budgets">) {
  return (
    <PageContainer className="space-y-8">
      <Suspense fallback={<BudgetsSkeleton />}>
        <Budgets params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

function budgetsHref(base: string, period: BudgetPeriod, on: string | null) {
  const params = new URLSearchParams();
  if (period !== "month") params.set("period", period);
  if (on) params.set("on", on);
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

async function Budgets({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/budgets">) {
  const { householdId } = await params;
  // Not a member (or no such household): the same 404, from the data layer.
  const household = await getHousehold(householdId);
  const search = await searchParams;
  const base = `/households/${household.id}/budgets`;
  // Periods are the household's own (D11), worked out at request time.
  await io();
  const today = todayIn(household.timezone);

  const rawPeriod = typeof search.period === "string" ? search.period : "month";
  const rawOn = typeof search.on === "string" ? search.on : "";
  const period: BudgetPeriod = isBudgetPeriod(rawPeriod) ? rawPeriod : "month";
  const currentStart = periodStart(today, period);
  const adjective = PERIOD_ADJECTIVES[period].toLowerCase();
  const linkProblem =
    !isBudgetPeriod(rawPeriod) ||
    (rawOn !== "" &&
      (!isCalendarDate(rawOn) ||
        rawOn < "2000-01-01" ||
        periodStart(rawOn, period) > currentStart));

  const addButton = (
    <Button asChild>
      <Link href={`${base}/new`}>
        <PlusIcon aria-hidden="true" data-icon="inline-start" />
        Add a budget
      </Link>
    </Button>
  );
  const header = (
    <>
      <Link
        href={`/households/${household.id}`}
        className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Household
      </Link>
      <PageHeader
        title="Budgets"
        description={`Limits for what ${household.name} spends in a week, a month or a quarter, against the expenses recorded. Anyone in the household can set them.`}
        actions={addButton}
      />
      {search.created === "1" ? (
        <FormAlert tone="success">The budget is added.</FormAlert>
      ) : null}
      {search.updated === "1" ? (
        <FormAlert tone="success">
          The limit is saved, from this {PERIOD_NOUNS[period]} on.
        </FormAlert>
      ) : null}
    </>
  );

  if (linkProblem) {
    return (
      <div className="space-y-8">
        {header}
        <FormAlert tone="error">
          That link asks for a period that doesn&apos;t exist or hasn&apos;t
          started, so nothing is shown.{" "}
          <Link
            href={base}
            className="rounded-sm text-primary underline underline-offset-4"
          >
            Show this month
          </Link>
        </FormAlert>
      </div>
    );
  }

  const on =
    rawOn === "" || periodStart(rawOn, period) === currentStart ? null : rawOn;
  const view = await getBudgets(household.id, period, on);
  if (!view.ok) {
    return (
      <div className="space-y-8">
        {header}
        <ErrorState
          title="Budgets can't be shown right now"
          description="The figures didn't pass the checks that make sure every budget belongs to this household and every total adds up, so nothing is shown. Nothing has been changed. Reload the page to try again."
        />
      </div>
    );
  }

  const data = view.data;
  const isCurrent = data.periodStart === currentStart;
  const relative = relativePeriod(data.periodStart, period, today);
  const label = periodLabel(data.periodStart, period);
  const previous = shiftPeriod(data.periodStart, period, -1);
  const next = shiftPeriod(data.periodStart, period, 1);
  const overall = data.budgets.find((b) => b.category === null) ?? null;
  const categories = data.budgets.filter((b) => b.category !== null);
  const historyHref = (category: string | null) => {
    const p = new URLSearchParams({
      range: "custom",
      from: data.periodStart,
      to: data.periodEnd,
    });
    if (category) p.set("category", category);
    return `/households/${household.id}/expenses?${p.toString()}`;
  };
  const card = (budget: BudgetRow) => (
    <BudgetCard
      key={budget.id}
      budget={budget}
      household={household}
      editable={isCurrent && !budget.archived}
      expensesHref={historyHref(budget.category)}
    />
  );

  return (
    <div className="space-y-8">
      {header}
      <FilterChips
        label="Budget period"
        chips={BUDGET_PERIODS.map((p) => ({
          key: p,
          href: budgetsHref(base, p, null),
          label: `${PERIOD_ADJECTIVES[p]} (${data.activeCounts[p]})`,
          active: p === period,
        }))}
      />

      <nav
        aria-label={`Choose a ${PERIOD_NOUNS[period]}`}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <Button variant="outline" size="sm" asChild>
          <Link
            href={budgetsHref(base, period, previous)}
            aria-label={`Previous ${PERIOD_NOUNS[period]}: ${periodLabel(previous, period)}`}
          >
            <ChevronLeftIcon aria-hidden="true" data-icon="inline-start" />
            Previous
          </Link>
        </Button>
        <p className="type-card-title" aria-live="polite">
          {label}
          {relative ? (
            <span className="type-secondary"> ({relative})</span>
          ) : null}
        </p>
        {isCurrent ? (
          <Button variant="outline" size="sm" disabled>
            Next
            <ChevronRightIcon aria-hidden="true" data-icon="inline-end" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" asChild>
            <Link
              href={budgetsHref(
                base,
                period,
                next === currentStart ? null : next,
              )}
              aria-label={`Next ${PERIOD_NOUNS[period]}: ${periodLabel(next, period)}`}
            >
              Next
              <ChevronRightIcon aria-hidden="true" data-icon="inline-end" />
            </Link>
          </Button>
        )}
      </nav>

      <p className="type-body">
        The household spent{" "}
        <Amount
          minor={data.totalSpentMinor}
          currency={household.currencyCode}
        />{" "}
        in {data.totalCount === 1 ? "1 expense" : `${data.totalCount} expenses`}{" "}
        from {formatDate(data.periodStart)} to{" "}
        {formatDate(
          isCurrent ? data.today : periodEnd(data.periodStart, period),
        )}
        {isCurrent ? " so far" : ""}.{" "}
        <span className="type-help">
          Only recorded expenses count: bills that haven&apos;t been recorded
          and payments between members don&apos;t. Today is{" "}
          {formatDate(data.today)} in the household&apos;s timezone.
        </span>
      </p>

      {data.budgets.length === 0 ? (
        <EmptyState
          icon={<PiggyBankIcon />}
          title={
            isCurrent
              ? `No ${adjective} budgets yet`
              : `No ${adjective} budgets covered this ${PERIOD_NOUNS[period]}`
          }
          description={
            isCurrent
              ? `Set a limit for everything the household spends in a ${PERIOD_NOUNS[period]}, or for a category like groceries.`
              : "A budget covers the periods from the one it was added in."
          }
          action={isCurrent ? addButton : undefined}
        />
      ) : (
        <>
          <Section
            title="Everything"
            description={
              overall
                ? undefined
                : `No ${adjective} budget for everything${isCurrent ? " yet" : " in this period"}.`
            }
          >
            {overall ? <div className="max-w-xl">{card(overall)}</div> : null}
          </Section>
          <Section
            title="By category"
            description={
              categories.length === 0
                ? `No ${adjective} category budgets${isCurrent ? " yet" : " in this period"}.`
                : "Each counts only its category's expenses; they aren't added up into the budget for everything."
            }
          >
            {categories.length > 0 ? (
              <ul className="grid gap-4 sm:grid-cols-2">
                {categories.map((b) => (
                  <li key={b.id}>{card(b)}</li>
                ))}
              </ul>
            ) : null}
          </Section>
          {!isCurrent ? (
            <p className="type-help">
              Limits are changed for the current {PERIOD_NOUNS[period]}; earlier
              ones keep the limit they had.{" "}
              <Link
                href={budgetsHref(base, period, null)}
                className="rounded-sm text-primary underline underline-offset-4"
              >
                Back to this {PERIOD_NOUNS[period]}
              </Link>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function BudgetsSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading budgets"
      className="space-y-6"
    >
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-9 w-40" />
      <div className="flex gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
