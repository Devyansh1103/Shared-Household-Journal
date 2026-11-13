import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import type { Metadata } from "next";
import { io } from "next/cache";
import { ErrorState } from "@/components/error-state";
import { FormSkeleton } from "@/components/form-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { splitDefaults } from "@/lib/bills/board";
import { getBill } from "@/lib/bills/queries";
import { isCalendarDate, todayIn } from "@/lib/expenses/dates";
import {
  currencyExponent,
  formatDate,
  formatMoney,
  minorToDecimalString,
} from "@/lib/format";
import { listMembersInJoinOrder } from "@/lib/households/queries";
import { recordBill } from "../../actions";
import { ExpenseForm } from "../../../expenses/expense-form";
import { BackToBill, Blocked } from "../manage";

export const metadata: Metadata = { title: "Record a bill" };

export default function RecordBillPage({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/bills/[billId]/record">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<FormSkeleton fields={5} label="Loading form" />}>
        <RecordBill params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function RecordBill({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/bills/[billId]/record">) {
  const { householdId, billId } = await params;
  const [{ household, view }, query] = await Promise.all([
    getBill(householdId, billId),
    searchParams,
  ]);
  if (!view.ok) {
    return (
      <Blocked household={household} billId={billId} reason="not_verified" />
    );
  }
  const { detail } = view;
  const { bill } = detail;
  const due = typeof query.due === "string" ? query.due : "";
  const period = isCalendarDate(due)
    ? detail.periods.find((p) => p.dueOn === due)
    : undefined;

  if (!period || (period.status !== "open" && period.status !== "upcoming")) {
    return (
      <>
        <BackToBill household={household} billId={bill.id} />
        <ErrorState
          title="That period can't be recorded"
          description={
            period?.status === "recorded"
              ? "It's already recorded. Its expense is linked from the bill's page."
              : period?.status === "skipped"
                ? "It's skipped. Undo the skip on the bill's page to record it."
                : "Choose a period on the bill's page: ones that have come and the next one can be recorded."
          }
        />
      </>
    );
  }

  const members = await listMembersInJoinOrder(household.id);
  const exponent = currencyExponent(household.currencyCode);
  const activeIds = members.map((m) => m.userId);
  // A fresh key per visit, so resubmitting can't record it twice; and "today"
  // in the household's timezone (D11) as the date it was paid.
  await io();
  const requestKey = randomUUID();
  const today = todayIn(household.timezone);
  const split = splitDefaults(detail, activeIds, exponent);

  return (
    <>
      <BackToBill household={household} billId={bill.id} />
      <PageHeader
        title={`Record ${bill.description}`}
        description={`The period due ${formatDate(period.dueOn)}, expected ${formatMoney(period.expectedMinor, household.currencyCode)}. Change anything that was different this time: it's saved as an expense, linked to this period, and counts towards balances. It doesn't move any money.`}
      />
      {split.participants.length < detail.shares.length ||
      !activeIds.includes(bill.payerId) ? (
        <p className="type-secondary">
          Someone in this bill&apos;s usual split has left the household, so
          they aren&apos;t ticked. Check who paid and who shares it.
        </p>
      ) : null}
      <Card>
        <CardContent>
          <ExpenseForm
            action={recordBill}
            hidden={{
              householdId: household.id,
              billId: bill.id,
              dueOn: period.dueOn,
              requestKey,
            }}
            members={members.map(({ userId, displayName }) => ({
              userId,
              displayName,
            }))}
            currency={household.currencyCode}
            exponent={exponent}
            defaults={{
              description: bill.description,
              amount: minorToDecimalString(period.expectedMinor, exponent),
              category: bill.category,
              expenseDate: today,
              paidBy: activeIds.includes(bill.payerId)
                ? bill.payerId
                : household.myUserId,
              ...split,
            }}
            submitLabel="Record bill"
            pendingLabel="Recording…"
          />
        </CardContent>
      </Card>
    </>
  );
}
