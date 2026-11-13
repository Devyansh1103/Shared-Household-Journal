import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { billBoard, boardCounts } from "@/lib/bills/board";
import { getBills } from "@/lib/bills/queries";
import { DUE_SOON_DAYS } from "@/lib/bills/schedule";

/**
 * The in-app reminder (roadmap Phase 14): how many bill periods are overdue,
 * due today or due soon, in the household's timezone. It sends nothing; in-app
 * notifications come with roadmap Phase 17 (D12).
 */
export async function BillsReminder({ householdId }: { householdId: string }) {
  const view = await getBills(householdId);
  const base = `/households/${householdId}/bills`;
  const viewButton = (
    <Button variant="outline" asChild>
      <Link href={base}>View bills</Link>
    </Button>
  );

  if (!view.ok) {
    return (
      <div className="space-y-3">
        <p className="type-secondary">
          Bills can&apos;t be shown right now. Open them to try again.
        </p>
        <div>{viewButton}</div>
      </div>
    );
  }
  if (view.bills.bills.length === 0) {
    return (
      <div className="space-y-3">
        <p className="type-secondary">
          No bills yet. Add the ones that repeat, like rent or electricity.
        </p>
        <div>
          <Button variant="outline" asChild>
            <Link href={`${base}/new`}>
              <PlusIcon aria-hidden="true" data-icon="inline-start" />
              Add a bill
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const counts = boardCounts(billBoard(view.bills));
  const plural = (n: number) => (n === 1 ? "1 bill" : `${n} bills`);
  return (
    <div className="space-y-3">
      {counts.overdue + counts.dueToday + counts.dueSoon === 0 ? (
        <p className="type-secondary">
          Nothing is overdue or due in the next {DUE_SOON_DAYS} days.
        </p>
      ) : (
        <ul
          className="flex flex-wrap gap-2"
          aria-label="Bills that need attention"
        >
          {counts.overdue > 0 ? (
            <li>
              <StatusBadge status="danger">
                {plural(counts.overdue)} overdue
              </StatusBadge>
            </li>
          ) : null}
          {counts.dueToday > 0 ? (
            <li>
              <StatusBadge status="warning">
                {plural(counts.dueToday)} due today
              </StatusBadge>
            </li>
          ) : null}
          {counts.dueSoon > 0 ? (
            <li>
              <StatusBadge status="info">
                {plural(counts.dueSoon)} due in the next {DUE_SOON_DAYS} days
              </StatusBadge>
            </li>
          ) : null}
        </ul>
      )}
      <div>{viewButton}</div>
    </div>
  );
}

export function BillsReminderSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading bills"
      className="space-y-3"
    >
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-10 w-28" />
    </div>
  );
}
