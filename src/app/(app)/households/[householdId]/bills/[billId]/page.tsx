import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon, CalendarCogIcon, PencilIcon } from "lucide-react";
import { cn } from "cn";
import { Amount } from "@/components/amount";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { ErrorState } from "@/components/error-state";
import { FormAlert } from "@/components/form-alert";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBasisPoints } from "@/domain/money/amount";
import {
  billState,
  canManageBill,
  periodBadge,
  personName,
} from "@/lib/bills/board";
import { getBill } from "@/lib/bills/queries";
import { scheduleLabel } from "@/lib/bills/schedule";
import { categoryLabel } from "@/lib/expenses/categories";
import { isCalendarDate } from "@/lib/expenses/dates";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import {
  endBill,
  pauseBill,
  resumeBill,
  skipPeriod,
  unskipPeriod,
} from "../actions";

export const metadata: Metadata = { title: "Bill" };

const METHOD_LABELS = {
  equal: "Split equally",
  percentage: "Split by percentage",
  custom: "Split by custom amounts",
} as const;

const NOTICES = {
  created: "The bill is saved. It shows on the bills page as it comes due.",
  updated:
    "Your changes are saved. Periods to come use them; periods that have already come keep what they had.",
  rescheduled:
    "The new schedule is saved. Periods that have already come keep their dates.",
} as const;

export default function BillPage({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/bills/[billId]">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<DetailSkeleton />}>
        <BillDetail params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function BillDetail({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/bills/[billId]">) {
  const { householdId, billId } = await params;
  const [{ household, view }, query] = await Promise.all([
    getBill(householdId, billId),
    searchParams,
  ]);
  const base = `/households/${household.id}/bills`;
  const back = (
    <Link
      href={base}
      className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      Bills
    </Link>
  );
  if (!view.ok) {
    return (
      <>
        {back}
        <ErrorState
          title="This bill can't be shown right now"
          description="Its periods didn't pass the checks that make sure every date and status is right, so nothing is shown. Nothing has been changed. Reload the page to try again."
        />
      </>
    );
  }

  const { detail } = view;
  const { bill, today } = detail;
  const me = household.myUserId;
  const currency = household.currencyCode;
  const name = (userId: string) => personName(detail.people, userId, me);
  const state = billState(bill);
  const manage = canManageBill(bill, {
    userId: me,
    isOwner: household.myRole === "owner",
  });
  const fields = { householdId: household.id, billId: bill.id };
  const notice = (Object.keys(NOTICES) as (keyof typeof NOTICES)[]).find(
    (key) => query[key] === "1",
  );
  const recorded =
    typeof query.recorded === "string" && isCalendarDate(query.recorded)
      ? query.recorded
      : null;

  return (
    <>
      {back}
      {notice ? <FormAlert tone="success">{NOTICES[notice]}</FormAlert> : null}
      {recorded ? (
        <FormAlert tone="success">
          The period due {formatDate(recorded)} is recorded as an expense, and
          the balances now include it.
        </FormAlert>
      ) : null}

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{categoryLabel(bill.category)}</Badge>
          {state === "active" ? (
            <StatusBadge status="info">Active</StatusBadge>
          ) : (
            <StatusBadge status="neutral">
              {state === "paused" ? "Paused" : "Ended"}
            </StatusBadge>
          )}
        </div>
        <h1 className="type-page-title">{bill.description}</h1>
        <p className="space-x-2">
          <span className="type-help">Expected</span>
          <Amount minor={bill.amountMinor} currency={currency} size="lg" />
        </p>
        <p className="type-body">
          {scheduleLabel(bill.frequency, bill.every)}
          {state === "active" && bill.nextDueOn
            ? ` · next due ${formatDate(bill.nextDueOn)}`
            : state === "paused" && bill.pausedAt
              ? ` · paused since ${formatDateTime(bill.pausedAt, household.timezone)}`
              : " · no more periods are due"}
        </p>
      </header>

      <Card>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Item term="Usually paid by">{name(bill.payerId)}</Item>
            <Item term="Schedule">
              {scheduleLabel(bill.frequency, bill.every)}, from{" "}
              {formatDate(bill.anchorOn)}
            </Item>
            <Item term="Last due date">
              {bill.endsOn ? formatDate(bill.endsOn) : "None: it keeps coming"}
            </Item>
            <Item term="Added by">{name(bill.createdBy)}</Item>
            <Item term="Default split" className="sm:col-span-2">
              {METHOD_LABELS[bill.splitMethod]} between{" "}
              {detail.shares
                .map((share) =>
                  share.percentageBp !== null
                    ? `${name(share.userId)} (${formatBasisPoints(share.percentageBp)}%)`
                    : share.shareMinor !== null
                      ? `${name(share.userId)} (${formatMoney(share.shareMinor, currency)})`
                      : name(share.userId),
                )
                .join(", ")}
            </Item>
            {bill.notes ? (
              <Item term="Notes" className="sm:col-span-2">
                <span className="wrap-break-word whitespace-pre-line">
                  {bill.notes}
                </span>
              </Item>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Section
        title="Periods"
        description="Each time it's due, newest first. Recording a period adds it as an expense; skipping one adds nothing."
      >
        {detail.periods.length === 0 ? (
          <p className="type-secondary">
            No periods yet{state === "paused" ? ": the bill is paused" : ""}.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {detail.periods.map((period) => {
              const badge = periodBadge(period, today);
              const due = formatDate(period.dueOn);
              return (
                <li
                  key={period.dueOn}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="type-card-title">Due {due}</span>
                      <StatusBadge status={badge.status}>
                        {badge.label}
                      </StatusBadge>
                    </p>
                    <p className="type-secondary">
                      Expected{" "}
                      <Amount
                        minor={period.expectedMinor}
                        currency={currency}
                        tone="muted"
                      />
                    </p>
                    {period.expense ? (
                      <p className="type-secondary">
                        Paid{" "}
                        <Amount
                          minor={period.expense.amountMinor}
                          currency={currency}
                        />{" "}
                        on {formatDate(period.expense.expenseDate)} by{" "}
                        {name(period.expense.paidBy)} ·{" "}
                        <Link
                          href={`/households/${household.id}/expenses/${period.expense.id}`}
                          aria-label={`View expense for the period due ${due}`}
                          className="rounded-sm type-label text-primary underline-offset-4 hover:underline"
                        >
                          View expense
                        </Link>
                      </p>
                    ) : null}
                    {period.skippedBy && period.skippedAt ? (
                      <p className="type-secondary">
                        Skipped by {name(period.skippedBy)} on{" "}
                        {formatDateTime(period.skippedAt, household.timezone)}.
                        No expense was recorded.
                      </p>
                    ) : null}
                    {period.deletedExpenseCount > 0 && !period.expense ? (
                      <p className="type-help">
                        An expense recorded for it was deleted, so it&apos;s
                        open again.
                      </p>
                    ) : null}
                  </div>
                  <PeriodActions
                    actionable={badge.actionable}
                    skipped={period.status === "skipped"}
                    manage={manage}
                    recordHref={`${base}/${bill.id}/record?due=${period.dueOn}`}
                    due={due}
                    fields={{ ...fields, dueOn: period.dueOn }}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {detail.storedCount > 200 ? (
          <p className="type-help">Showing the latest 200 periods.</p>
        ) : null}
      </Section>

      <Section title="Change this bill">
        {manage ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`${base}/${bill.id}/edit`}>
                <PencilIcon aria-hidden="true" data-icon="inline-start" />
                Edit details
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`${base}/${bill.id}/schedule`}>
                <CalendarCogIcon aria-hidden="true" data-icon="inline-start" />
                Change schedule
              </Link>
            </Button>
            {state === "paused" ? (
              <ConfirmActionDialog
                triggerLabel="Resume bill"
                title={`Resume “${bill.description}”?`}
                description="It's due again from its next date on the schedule, starting today. Periods that fell while it was paused don't come back."
                confirmLabel="Resume bill"
                cancelLabel="Keep it paused"
                pendingLabel="Resuming…"
                action={resumeBill}
                fields={fields}
              />
            ) : state === "active" ? (
              <ConfirmActionDialog
                triggerLabel="Pause bill"
                title={`Pause “${bill.description}”?`}
                description="No new period comes while it's paused. Periods that have already come stay open until they're recorded or skipped. You can resume it any time."
                confirmLabel="Pause bill"
                cancelLabel="Keep it going"
                pendingLabel="Pausing…"
                action={pauseBill}
                fields={fields}
              />
            ) : null}
            {state !== "ended" ? (
              <ConfirmActionDialog
                triggerLabel="End bill"
                title={`End “${bill.description}”?`}
                description="No period after today will come. Periods that have already come stay, and so does everything recorded. You can set a later last due date again under Edit details."
                confirmLabel="End bill"
                cancelLabel="Keep the bill"
                pendingLabel="Ending…"
                destructive
                action={endBill}
                fields={fields}
              />
            ) : null}
          </div>
        ) : (
          <p className="type-secondary">
            Only the person who added it, the person who usually pays it, or the
            household owner can change, pause, end it or skip a period. Anyone
            in the household can record a period.
          </p>
        )}
      </Section>
    </>
  );
}

function PeriodActions({
  actionable,
  skipped,
  manage,
  recordHref,
  due,
  fields,
}: {
  actionable: boolean;
  skipped: boolean;
  manage: boolean;
  recordHref: string;
  due: string;
  fields: Record<string, string>;
}) {
  if (!actionable && !(skipped && manage)) return null;
  return (
    <div className="flex flex-wrap gap-2 sm:justify-end">
      {actionable ? (
        <Button variant="outline" size="sm" asChild>
          <Link href={recordHref} aria-label={`Record the period due ${due}`}>
            Record
          </Link>
        </Button>
      ) : null}
      {actionable && manage ? (
        <ConfirmActionDialog
          triggerLabel="Skip"
          triggerAriaLabel={`Skip the period due ${due}`}
          title={`Skip the period due ${due}?`}
          description="Nothing is recorded and it doesn't count as paid. Use it when the bill didn't come this time. You can undo it."
          confirmLabel="Skip period"
          cancelLabel="Keep it open"
          pendingLabel="Skipping…"
          action={skipPeriod}
          fields={fields}
        />
      ) : null}
      {skipped && manage ? (
        <ConfirmActionDialog
          triggerLabel="Undo skip"
          triggerAriaLabel={`Undo skip of the period due ${due}`}
          title={`Undo skipping the period due ${due}?`}
          description="It's open again, so it can be recorded."
          confirmLabel="Undo skip"
          cancelLabel="Keep it skipped"
          pendingLabel="Undoing…"
          action={unskipPeriod}
          fields={fields}
        />
      ) : null}
    </div>
  );
}

function Item({
  term,
  children,
  className,
}: {
  term: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <dt className="type-label">{term}</dt>
      <dd className="type-body">{children}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading bill"
      className="space-y-6"
    >
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-9 w-64 max-w-full" />
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
