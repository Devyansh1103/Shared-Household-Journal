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
import { createBill } from "../actions";
import { BillForm } from "../bill-form";

export const metadata: Metadata = { title: "Add a bill" };

export default function NewBillPage({
  params,
}: PageProps<"/households/[householdId]/bills/new">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<FormSkeleton fields={7} label="Loading form" />}>
        <NewBill params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function NewBill({
  params,
}: Pick<PageProps<"/households/[householdId]/bills/new">, "params">) {
  const { householdId } = await params;
  const household = await getHousehold(householdId);
  const members = await listMembersInJoinOrder(household.id);
  // A fresh key per visit, so resubmitting can't add the bill twice; and
  // "today" in the household's timezone (D11).
  await io();
  const requestKey = randomUUID();
  const today = todayIn(household.timezone);

  return (
    <>
      <Link
        href={`/households/${household.id}/bills`}
        className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Bills
      </Link>
      <PageHeader
        title="Add a bill"
        description={`A bill that repeats in ${household.name}, like rent or electricity. It's a reminder: each time it's paid, someone records it as an expense. Adding it doesn't record anything.`}
      />
      <Card>
        <CardContent>
          <BillForm
            mode="create"
            action={createBill}
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
              paidBy: household.myUserId,
              splitMethod: "equal",
              participants: members.map((m) => m.userId),
              shares: {},
              percents: {},
              schedule: "monthly",
              unit: "month",
              every: "1",
              startsOn: today,
              endsOn: "",
              notes: "",
            }}
            submitLabel="Save bill"
            pendingLabel="Saving…"
          />
        </CardContent>
      </Card>
    </>
  );
}
