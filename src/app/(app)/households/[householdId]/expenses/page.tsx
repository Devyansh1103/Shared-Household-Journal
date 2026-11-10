import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon, PlusIcon, ReceiptIcon } from "lucide-react";
import { Amount } from "@/components/amount";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-alert";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { categoryLabel } from "@/lib/expenses/categories";
import {
  LIST_LIMIT,
  listExpenses,
  type ExpenseListItem,
} from "@/lib/expenses/queries";
import { formatDate } from "@/lib/format";
import { getHousehold } from "@/lib/households/queries";

export const metadata: Metadata = { title: "Expenses" };

export default function ExpensesPage({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/expenses">) {
  return (
    <PageContainer className="space-y-8">
      <Suspense fallback={<ListSkeleton />}>
        <Expenses params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function Expenses({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/expenses">) {
  const { householdId } = await params;
  const household = await getHousehold(householdId);
  const [{ active, deleted, truncated }, query] = await Promise.all([
    listExpenses(household.id),
    searchParams,
  ]);
  const base = `/households/${household.id}/expenses`;

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
          The expense is deleted. It no longer counts, and it&apos;s listed
          under “Deleted expenses” below.
        </FormAlert>
      ) : null}

      <PageHeader
        title="Expenses"
        description={`Shared costs for ${household.name}, newest first.`}
        actions={active.length > 0 ? addButton : undefined}
      />

      {active.length === 0 ? (
        <EmptyState
          icon={<ReceiptIcon />}
          title="No expenses yet"
          description="Add the first shared cost, like rent or a grocery run, and choose how to split it."
          action={addButton}
        />
      ) : (
        <div className="space-y-3">
          <ExpenseRows
            items={active}
            base={base}
            currency={household.currencyCode}
          />
          {truncated ? (
            <p className="type-help">
              Showing the latest {LIST_LIMIT} expenses. Older ones will be
              reachable once expense history and filters arrive.
            </p>
          ) : null}
        </div>
      )}

      {deleted.length > 0 ? (
        <Section
          title="Deleted expenses"
          description="These don't count towards anything. The owner can restore them."
        >
          <ExpenseRows
            items={deleted}
            base={base}
            currency={household.currencyCode}
          />
        </Section>
      ) : null}
    </div>
  );
}

function ExpenseRows({
  items,
  base,
  currency,
}: {
  items: ExpenseListItem[];
  base: string;
  currency: string;
}) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {items.map((expense) => (
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
                  Paid by {expense.payerName}
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

function ListSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading expenses"
      className="space-y-6"
    >
      <Skeleton className="h-9 w-48" />
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
