import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { FormSkeleton } from "@/components/form-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getBudget } from "@/lib/budgets/queries";
import { budgetName } from "@/lib/budgets/words";
import { currencyExponent, minorToDecimalString } from "@/lib/format";
import { updateBudget } from "../../actions";
import { BudgetForm } from "../../budget-form";

export const metadata: Metadata = { title: "Change a budget's limit" };

export default function EditBudgetPage({
  params,
}: PageProps<"/households/[householdId]/budgets/[budgetId]/edit">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<FormSkeleton fields={1} label="Loading form" />}>
        <EditBudget params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function EditBudget({
  params,
}: Pick<
  PageProps<"/households/[householdId]/budgets/[budgetId]/edit">,
  "params"
>) {
  const { householdId, budgetId } = await params;
  // A 404 for a non-member, a malformed id or another household's budget.
  const { household, budget } = await getBudget(householdId, budgetId);
  const back = (
    <Link
      href={`/households/${household.id}/budgets${budget.period === "month" ? "" : `?period=${budget.period}`}`}
      className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      Budgets
    </Link>
  );
  if (budget.archived) {
    return (
      <>
        {back}
        <ErrorState
          title="This budget has been removed"
          description="Its limit can't be changed any more. Add a new budget if you'd like one again."
        />
      </>
    );
  }
  const exponent = currencyExponent(household.currencyCode);
  return (
    <>
      {back}
      <PageHeader
        title="Change the limit"
        description={budgetName(budget.category, budget.period)}
      />
      <Card>
        <CardContent>
          <BudgetForm
            mode="edit"
            action={updateBudget}
            hidden={{
              householdId: household.id,
              budgetId: budget.id,
              expectedUpdatedAt: budget.updatedAt,
            }}
            currency={household.currencyCode}
            exponent={exponent}
            defaults={{
              category: budget.category ?? "all",
              period: budget.period,
              limit: minorToDecimalString(budget.currentLimitMinor, exponent),
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
