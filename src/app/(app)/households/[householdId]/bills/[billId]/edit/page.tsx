import { Suspense } from "react";
import type { Metadata } from "next";
import { FormSkeleton } from "@/components/form-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { splitDefaults } from "@/lib/bills/board";
import { getBill } from "@/lib/bills/queries";
import { currencyExponent, minorToDecimalString } from "@/lib/format";
import { listMembersInJoinOrder } from "@/lib/households/queries";
import { updateBill } from "../../actions";
import { BillForm } from "../../bill-form";
import { BackToBill, Blocked, viewerCanManage } from "../manage";

export const metadata: Metadata = { title: "Edit bill" };

export default function EditBillPage({
  params,
}: PageProps<"/households/[householdId]/bills/[billId]/edit">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<FormSkeleton fields={6} label="Loading form" />}>
        <EditBill params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function EditBill({
  params,
}: Pick<PageProps<"/households/[householdId]/bills/[billId]/edit">, "params">) {
  const { householdId, billId } = await params;
  const { household, view } = await getBill(householdId, billId);
  if (!view.ok) {
    return (
      <Blocked household={household} billId={billId} reason="not_verified" />
    );
  }
  const { detail } = view;
  if (!viewerCanManage(household, detail)) {
    return (
      <Blocked
        household={household}
        billId={billId}
        reason={{ action: "edit this bill" }}
      />
    );
  }

  const members = await listMembersInJoinOrder(household.id);
  const exponent = currencyExponent(household.currencyCode);
  const { bill } = detail;

  return (
    <>
      <BackToBill household={household} billId={bill.id} />
      <PageHeader
        title="Edit bill"
        description="Periods to come use these details. Periods that have already come keep their expected amount, and expenses already recorded never change."
      />
      <Card>
        <CardContent>
          <BillForm
            mode="details"
            action={updateBill}
            hidden={{
              householdId: household.id,
              billId: bill.id,
              expectedUpdatedAt: bill.updatedAt,
            }}
            members={members.map(({ userId, displayName }) => ({
              userId,
              displayName,
            }))}
            currency={household.currencyCode}
            exponent={exponent}
            defaults={{
              description: bill.description,
              amount: minorToDecimalString(bill.amountMinor, exponent),
              category: bill.category,
              // Someone who has left can't be chosen (D13): pick again.
              paidBy: members.some((m) => m.userId === bill.payerId)
                ? bill.payerId
                : household.myUserId,
              ...splitDefaults(
                detail,
                members.map((m) => m.userId),
                exponent,
              ),
              schedule: "",
              unit: "",
              every: "",
              startsOn: "",
              endsOn: bill.endsOn ?? "",
              notes: bill.notes ?? "",
            }}
            submitLabel="Save changes"
            pendingLabel="Saving…"
          />
        </CardContent>
      </Card>
    </>
  );
}
