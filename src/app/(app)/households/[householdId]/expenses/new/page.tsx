import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { io } from "next/cache";
import { ArrowLeftIcon } from "lucide-react";
import { FormSkeleton } from "@/components/form-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { todayIn } from "@/lib/expenses/dates";
import { currencyExponent } from "@/lib/format";
import { getHousehold, listMembersInJoinOrder } from "@/lib/households/queries";
import { createExpense } from "../actions";
import { ExpenseForm } from "../expense-form";

export const metadata: Metadata = { title: "Add an expense" };

export default function NewExpensePage({
  params,
}: PageProps<"/households/[householdId]/expenses/new">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<FormSkeleton fields={5} label="Loading form" />}>
        <NewExpense params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function NewExpense({
  params,
}: Pick<PageProps<"/households/[householdId]/expenses/new">, "params">) {
  const { householdId } = await params;
  const household = await getHousehold(householdId);
  const members = await listMembersInJoinOrder(household.id);
  // A fresh key per visit, so resubmitting can't record the expense twice;
  // and "today" in the household's timezone (D11).
  await io();
  const requestKey = randomUUID();
  const today = todayIn(household.timezone);

  return (
    <>
      <Link
        href={`/households/${household.id}/expenses`}
        className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Expenses
      </Link>
      <PageHeader
        title="Add an expense"
        description={`Record a shared cost for ${household.name}. This records who paid and who shares it; it doesn't move any money.`}
      />
      <Card>
        <CardContent>
          <ExpenseForm
            action={createExpense}
            hidden={{ householdId: household.id, requestKey }}
            members={members.map(({ userId, displayName }) => ({
              userId,
              displayName,
            }))}
            currency={household.currencyCode}
            exponent={currencyExponent(household.currencyCode)}
            defaults={{
              description: "",
              amount: "",
              category: "",
              expenseDate: today,
              paidBy: household.myUserId,
              splitMethod: "equal",
              participants: members.map((m) => m.userId),
              shares: {},
              percents: {},
            }}
            submitLabel="Save expense"
            pendingLabel="Saving…"
          />
        </CardContent>
      </Card>
    </>
  );
}
