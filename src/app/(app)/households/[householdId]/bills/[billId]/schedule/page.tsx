import { Suspense } from "react";
import type { Metadata } from "next";
import { FormSkeleton } from "@/components/form-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getBill } from "@/lib/bills/queries";
import { presetFor, scheduleLabel } from "@/lib/bills/schedule";
import { formatDate } from "@/lib/format";
import { rescheduleBill } from "../../actions";
import { ScheduleForm } from "../../bill-form";
import { BackToBill, Blocked, viewerCanManage } from "../manage";

export const metadata: Metadata = { title: "Change schedule" };

export default function ScheduleBillPage({
  params,
}: PageProps<"/households/[householdId]/bills/[billId]/schedule">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<FormSkeleton fields={2} label="Loading form" />}>
        <Reschedule params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function Reschedule({
  params,
}: Pick<
  PageProps<"/households/[householdId]/bills/[billId]/schedule">,
  "params"
>) {
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
        reason={{ action: "change this schedule" }}
      />
    );
  }

  const { bill, today } = detail;
  const preset = presetFor(bill.frequency, bill.every);
  return (
    <>
      <BackToBill household={household} billId={bill.id} />
      <PageHeader
        title="Change schedule"
        description={`Now: ${scheduleLabel(bill.frequency, bill.every).toLowerCase()}, from ${formatDate(bill.anchorOn)}. The new schedule starts on the next due date you choose; periods that have already come keep their dates.`}
      />
      <Card>
        <CardContent>
          <ScheduleForm
            action={rescheduleBill}
            hidden={{
              householdId: household.id,
              billId: bill.id,
              expectedUpdatedAt: bill.updatedAt,
            }}
            defaults={{
              schedule: preset,
              unit: bill.frequency,
              every: String(bill.every),
              startsOn: bill.nextDueOn ?? today,
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
