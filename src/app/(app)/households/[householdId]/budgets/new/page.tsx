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
import { EMPTY_BUDGET_FORM } from "@/lib/budgets/form";
import { isBudgetPeriod } from "@/lib/budgets/period";
import { currencyExponent } from "@/lib/format";
import { getHousehold } from "@/lib/households/queries";
import { createBudget } from "../actions";
import { BudgetForm } from "../budget-form";

export const metadata: Metadata = { title: "Add a budget" };

export default function NewBudgetPage({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/budgets/new">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<FormSkeleton fields={3} label="Loading form" />}>
        <NewBudget params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function NewBudget({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/budgets/new">) {
  const { householdId } = await params;
  const household = await getHousehold(householdId);
  const search = await searchParams;
  const period =
    typeof search.period === "string" && isBudgetPeriod(search.period)
      ? search.period
      : EMPTY_BUDGET_FORM.period;
  // A fresh key per visit, so resubmitting can't add the budget twice.
  await io();
  const requestKey = randomUUID();

  return (
    <>
      <Link
        href={`/households/${household.id}/budgets`}
        className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Budgets
      </Link>
      <PageHeader
        title="Add a budget"
        description={`A spending limit for ${household.name}, in ${household.currencyCode}, the household's currency. It's compared with the expenses recorded; nothing is blocked or sent when it's reached.`}
      />
      <Card>
        <CardContent>
          <BudgetForm
            mode="create"
            action={createBudget}
            hidden={{ householdId: household.id, requestKey }}
            currency={household.currencyCode}
            exponent={currencyExponent(household.currencyCode)}
            defaults={{ ...EMPTY_BUDGET_FORM, period }}
          />
        </CardContent>
      </Card>
    </>
  );
}
