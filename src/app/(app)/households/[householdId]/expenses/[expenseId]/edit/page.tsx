import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { FormSkeleton } from "@/components/form-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { formatBasisPoints } from "@/domain/money/amount";
import { getExpense } from "@/lib/expenses/queries";
import { listMembersInJoinOrder } from "@/lib/households/queries";
import { currencyExponent, minorToDecimalString } from "@/lib/format";
import { updateExpense } from "../../actions";
import { ExpenseForm } from "../../expense-form";

export const metadata: Metadata = { title: "Edit expense" };

export default function EditExpensePage({
  params,
}: PageProps<"/households/[householdId]/expenses/[expenseId]/edit">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<FormSkeleton fields={5} label="Loading expense" />}>
        <EditExpense params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function EditExpense({
  params,
}: Pick<
  PageProps<"/households/[householdId]/expenses/[expenseId]/edit">,
  "params"
>) {
  const { householdId, expenseId } = await params;
  const { household, expense } = await getExpense(householdId, expenseId);
  const detailPath = `/households/${household.id}/expenses/${expense.id}`;

  const back = (
    <Link
      href={detailPath}
      className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      Back to the expense
    </Link>
  );

  // The database enforces the same rules (D6, ADR-006); this explains them.
  const blocked = !expense.canChange
    ? expense.deletedAt
      ? "This expense is deleted. The owner can restore it first."
      : "Only the person who added this expense, the person who paid, or the household owner can edit it."
    : !expense.everyoneActive
      ? "Someone in this expense has left the household, so it can't be edited."
      : null;
  if (blocked) {
    return (
      <>
        {back}
        <ErrorState title="You can't edit this expense" description={blocked} />
      </>
    );
  }

  const members = await listMembersInJoinOrder(household.id);
  const exponent = currencyExponent(household.currencyCode);
  const shares: Record<string, string> = {};
  const percents: Record<string, string> = {};
  for (const share of expense.shares) {
    if (expense.splitMethod === "custom") {
      shares[share.userId] = minorToDecimalString(share.shareMinor, exponent);
    }
    if (expense.splitMethod === "percentage" && share.percentageBp !== null) {
      percents[share.userId] = formatBasisPoints(share.percentageBp);
    }
  }

  return (
    <>
      {back}
      <PageHeader
        title="Edit expense"
        description="Changes are recorded in the household journal with the old and new values."
      />
      <Card>
        <CardContent>
          <ExpenseForm
            action={updateExpense}
            hidden={{
              householdId: household.id,
              expenseId: expense.id,
              expectedUpdatedAt: expense.updatedAt,
            }}
            members={members.map(({ userId, displayName }) => ({
              userId,
              displayName,
            }))}
            currency={household.currencyCode}
            exponent={exponent}
            defaults={{
              description: expense.description,
              amount: minorToDecimalString(expense.amountMinor, exponent),
              category: expense.category,
              expenseDate: expense.expenseDate,
              paidBy: expense.paidBy,
              splitMethod: expense.splitMethod,
              participants: expense.shares.map((s) => s.userId),
              shares,
              percents,
            }}
            submitLabel="Save changes"
            pendingLabel="Saving…"
          />
        </CardContent>
      </Card>
    </>
  );
}
