import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon, PencilIcon } from "lucide-react";
import { Amount } from "@/components/amount";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { FormAlert } from "@/components/form-alert";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBasisPoints } from "@/domain/money/amount";
import { categoryLabel } from "@/lib/expenses/categories";
import { getExpense } from "@/lib/expenses/queries";
import { formatDate, formatDateTime } from "@/lib/format";
import { deleteExpense, restoreExpense } from "../actions";

export const metadata: Metadata = { title: "Expense" };

const METHOD_LABELS = {
  equal: "Split equally",
  percentage: "Split by percentage",
  custom: "Split by custom amounts",
} as const;

const NOTICES = {
  created: "The expense is saved.",
  updated: "Your changes are saved.",
} as const;

export default function ExpensePage({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/expenses/[expenseId]">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<DetailSkeleton />}>
        <ExpenseDetail params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function ExpenseDetail({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/expenses/[expenseId]">) {
  const { householdId, expenseId } = await params;
  const [{ household, expense }, query] = await Promise.all([
    getExpense(householdId, expenseId),
    searchParams,
  ]);
  const notice = (Object.keys(NOTICES) as (keyof typeof NOTICES)[]).find(
    (key) => query[key] === "1",
  );
  const base = `/households/${household.id}/expenses`;
  const currency = household.currencyCode;
  const fields = { householdId: household.id, expenseId: expense.id };
  const deleted = Boolean(expense.deletedAt);

  return (
    <>
      <Link
        href={base}
        className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Expenses
      </Link>

      {notice ? <FormAlert tone="success">{NOTICES[notice]}</FormAlert> : null}
      {deleted ? (
        <FormAlert tone="info">
          Deleted by {expense.deletedByName} on{" "}
          {formatDateTime(expense.deletedAt!, household.timezone)}. It no longer
          counts towards anything.
        </FormAlert>
      ) : null}

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{categoryLabel(expense.category)}</Badge>
          {deleted ? <StatusBadge status="neutral">Deleted</StatusBadge> : null}
        </div>
        <h1 className="type-page-title">{expense.description}</h1>
        <Amount
          minor={expense.amountMinor}
          currency={currency}
          size="lg"
          tone={deleted ? "muted" : "neutral"}
        />
      </header>

      <Card>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <dt className="type-label">Paid by</dt>
              <dd className="type-body">{expense.payerName}</dd>
            </div>
            <div className="space-y-1">
              <dt className="type-label">Date</dt>
              <dd className="type-body">{formatDate(expense.expenseDate)}</dd>
            </div>
            <div className="space-y-1">
              <dt className="type-label">Added by</dt>
              <dd className="type-body">{expense.creatorName}</dd>
            </div>
            <div className="space-y-1">
              <dt className="type-label">Last changed</dt>
              <dd className="type-body">
                {formatDateTime(expense.updatedAt, household.timezone)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Section
        title="Who shares it"
        description={METHOD_LABELS[expense.splitMethod]}
      >
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {expense.shares.map((share) => (
            <li
              key={share.userId}
              className="flex items-center justify-between gap-3 p-4"
            >
              <span className="min-w-0 truncate type-label">
                {share.name}
                {share.percentageBp !== null ? (
                  <span className="type-secondary">
                    {" "}
                    · {formatBasisPoints(share.percentageBp)}%
                  </span>
                ) : null}
              </span>
              <Amount minor={share.shareMinor} currency={currency} />
            </li>
          ))}
        </ul>
        <p className="type-help">
          {deleted ? (
            "Shares always add up exactly to the amount."
          ) : (
            <>
              Shares always add up exactly to the amount, and each one counts
              towards that person&apos;s balance.{" "}
              <Link
                href={`/households/${household.id}/balances`}
                className="rounded-sm text-primary underline underline-offset-4"
              >
                See balances
              </Link>
            </>
          )}
        </p>
      </Section>

      {expense.canChange ? (
        <Section title="Change this expense">
          {expense.everyoneActive ? null : (
            <p className="type-secondary">
              Someone in this expense has left the household, so it can&apos;t
              be edited. It can still be deleted, but then it can&apos;t be
              restored, and their balance changes.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {expense.everyoneActive ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`${base}/${expense.id}/edit`}>
                  <PencilIcon aria-hidden="true" data-icon="inline-start" />
                  Edit expense
                </Link>
              </Button>
            ) : null}
            <ConfirmActionDialog
              triggerLabel="Delete expense"
              title={`Delete “${expense.description}”?`}
              description={
                expense.everyoneActive
                  ? "It stops counting straight away and moves to “Deleted expenses”. The household owner can restore it."
                  : "It stops counting straight away and moves to “Deleted expenses”. Someone in it has left the household, so it can't be restored, and their balance will change."
              }
              confirmLabel="Delete expense"
              cancelLabel="Keep expense"
              pendingLabel="Deleting…"
              destructive
              action={deleteExpense}
              fields={fields}
            />
          </div>
        </Section>
      ) : null}

      {expense.canRestore ? (
        <Section title="Restore this expense">
          {expense.everyoneActive ? (
            <div>
              <ConfirmActionDialog
                triggerLabel="Restore expense"
                title={`Restore “${expense.description}”?`}
                description="It will count again, exactly as it was before it was deleted."
                confirmLabel="Restore expense"
                cancelLabel="Keep deleted"
                pendingLabel="Restoring…"
                action={restoreExpense}
                fields={fields}
              />
            </div>
          ) : (
            <p className="type-secondary">
              Someone in this expense has left the household, so it can&apos;t
              be restored.
            </p>
          )}
        </Section>
      ) : null}
    </>
  );
}

function DetailSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading expense"
      className="space-y-6"
    >
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-9 w-64 max-w-full" />
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
