import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { canManageBill } from "@/lib/bills/board";
import type { BillDetail } from "@/lib/bills/payload";
import type { Household } from "@/lib/households/queries";

export function BackToBill({
  household,
  billId,
}: {
  household: Household;
  billId: string;
}) {
  return (
    <Link
      href={`/households/${household.id}/bills/${billId}`}
      className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      Back to the bill
    </Link>
  );
}

/** D27 (proposed); the database enforces the same rule. */
export function viewerCanManage(household: Household, detail: BillDetail) {
  return canManageBill(detail.bill, {
    userId: household.myUserId,
    isOwner: household.myRole === "owner",
  });
}

/** In place of a form the viewer can't use: why, and the way back. */
export function Blocked({
  household,
  billId,
  reason,
}: {
  household: Household;
  billId: string;
  reason: "not_verified" | { action: string };
}) {
  return (
    <>
      <BackToBill household={household} billId={billId} />
      {reason === "not_verified" ? (
        <ErrorState
          title="This bill can't be shown right now"
          description="Its details didn't pass their checks, so nothing is shown. Nothing has been changed. Reload the page to try again."
        />
      ) : (
        <ErrorState
          title={`You can't ${reason.action}`}
          description="Only the person who added it, the person who usually pays it, or the household owner can."
        />
      )}
    </>
  );
}
