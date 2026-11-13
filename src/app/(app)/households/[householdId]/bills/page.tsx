import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  ChevronRightIcon,
  PlusIcon,
} from "lucide-react";
import { Amount } from "@/components/amount";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { billBoard, personName } from "@/lib/bills/board";
import { getBills } from "@/lib/bills/queries";
import { DUE_SOON_DAYS } from "@/lib/bills/schedule";
import { formatDate } from "@/lib/format";
import { getHousehold } from "@/lib/households/queries";
import { BillLinks, PeriodRows } from "./bill-rows";

export const metadata: Metadata = { title: "Bills" };

export default function BillsPage({
  params,
}: PageProps<"/households/[householdId]/bills">) {
  return (
    <PageContainer className="space-y-8">
      <Suspense fallback={<BillsSkeleton />}>
        <Bills params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function Bills({
  params,
}: Pick<PageProps<"/households/[householdId]/bills">, "params">) {
  const { householdId } = await params;
  const household = await getHousehold(householdId);
  const view = await getBills(household.id);
  const base = `/households/${household.id}/bills`;
  const currency = household.currencyCode;

  const addButton = (
    <Button asChild>
      <Link href={`${base}/new`}>
        <PlusIcon aria-hidden="true" data-icon="inline-start" />
        Add a bill
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
        title="Bills"
        description={`Bills that repeat in ${household.name}: what's due, what's coming and what's been paid. A bill is a reminder: it counts only once someone records it as an expense.`}
        actions={view.ok && view.bills.bills.length > 0 ? addButton : undefined}
      />
    </>
  );

  if (!view.ok) {
    return (
      <div className="space-y-8">
        {header}
        <ErrorState
          title="Bills can't be shown right now"
          description="The bills didn't pass the checks that make sure every one belongs to this household and every date is right, so nothing is shown. Nothing has been changed. Reload the page to try again."
        />
      </div>
    );
  }

  const data = view.bills;
  if (data.bills.length === 0) {
    return (
      <div className="space-y-8">
        {header}
        <EmptyState
          icon={<CalendarClockIcon />}
          title="No bills yet"
          description="Add the bills that repeat, like rent or electricity, to see when each one is due and record it as an expense when it's paid."
          action={addButton}
        />
      </div>
    );
  }

  const board = billBoard(data);
  const name = (userId: string) =>
    personName(data.people, userId, household.myUserId);
  const rows = (items: typeof board.overdue) => (
    <PeriodRows
      items={items}
      base={base}
      currency={currency}
      payerName={name}
    />
  );
  const nothingDue =
    board.overdue.length + board.dueToday.length + board.dueSoon.length === 0;

  return (
    <div className="space-y-8">
      {header}
      <p className="type-help">
        Today is {formatDate(data.today)} in the household&apos;s timezone.
        Bills show here as they come due; the app doesn&apos;t send
        notifications yet.
      </p>

      {nothingDue ? (
        <p className="type-body">
          Nothing is overdue or due in the next {DUE_SOON_DAYS} days.
        </p>
      ) : null}
      {board.overdue.length > 0 ? (
        <Section
          title="Overdue"
          description="Their due date has passed and they haven't been recorded or skipped."
        >
          {rows(board.overdue)}
        </Section>
      ) : null}
      {board.dueToday.length > 0 ? (
        <Section title="Due today">{rows(board.dueToday)}</Section>
      ) : null}
      {board.dueSoon.length > 0 ? (
        <Section title={`Due in the next ${DUE_SOON_DAYS} days`}>
          {rows(board.dueSoon)}
        </Section>
      ) : null}
      {board.upcoming.length > 0 ? (
        <Section title="Coming up" description="Each bill's next due date.">
          {rows(board.upcoming)}
        </Section>
      ) : null}

      {board.paidRecently.length > 0 ? (
        <Section
          title="Paid recently"
          description="Recorded as expenses dated in the last 30 days."
        >
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {board.paidRecently.map((paid) => (
              <li key={`${paid.billId}|${paid.dueOn}`}>
                <Link
                  href={`/households/${household.id}/expenses/${paid.expenseId}`}
                  className="flex items-center gap-3 p-4 hover:bg-muted"
                >
                  <span className="block min-w-0 flex-1 space-y-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 truncate type-card-title">
                        {paid.bill.description}
                      </span>
                      <StatusBadge status="success">Paid</StatusBadge>
                    </span>
                    <span className="block type-secondary">
                      Due {formatDate(paid.dueOn)} · paid{" "}
                      {formatDate(paid.expenseDate)} by {name(paid.paidBy)}
                    </span>
                  </span>
                  <Amount minor={paid.amountMinor} currency={currency} />
                  <ChevronRightIcon
                    aria-hidden="true"
                    className="size-5 shrink-0 text-muted-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {board.paused.length > 0 ? (
        <Section
          title="Paused"
          description="No new period comes until they're resumed."
        >
          <BillLinks bills={board.paused} base={base} label="Paused" />
        </Section>
      ) : null}
      {board.ended.length > 0 ? (
        <Section title="Ended" description="No more periods are due.">
          <BillLinks bills={board.ended} base={base} label="Ended" />
        </Section>
      ) : null}
    </div>
  );
}

function BillsSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading bills"
      className="space-y-6"
    >
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-9 w-40" />
      <div className="space-y-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}
