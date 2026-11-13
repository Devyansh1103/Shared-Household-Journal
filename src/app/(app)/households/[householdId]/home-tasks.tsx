import Link from "next/link";
import { io } from "next/cache";
import { ListChecksIcon, ShoppingBasketIcon } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getChoreCounts } from "@/lib/chores/queries";
import { todayIn } from "@/lib/expenses/dates";
import type { Household } from "@/lib/households/queries";
import { getShoppingCounts } from "@/lib/shopping/queries";

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** How much is on the shopping list (roadmap Phase 15). */
export async function ShoppingSummary({ household }: { household: Household }) {
  const counts = await getShoppingCounts(household.id);
  return (
    <div className="space-y-3">
      <p className="type-secondary">
        {counts.pending === 0
          ? "Nothing on the list right now."
          : `${plural(counts.pending, "item", "items")} still needed${counts.mine > 0 ? `, ${counts.mine} for you to get` : ""}.`}
      </p>
      <div>
        <Button variant="outline" asChild>
          <Link href={`/households/${household.id}/shopping`}>
            <ShoppingBasketIcon aria-hidden="true" data-icon="inline-start" />
            Shopping list
          </Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * What's left to do (roadmap Phase 15): overdue is worked out from the
 * household's date (D11). It sends nothing: in-app notifications are roadmap
 * Phase 17 (D12).
 */
export async function ChoresSummary({ household }: { household: Household }) {
  await io();
  const counts = await getChoreCounts(
    household.id,
    todayIn(household.timezone),
  );
  return (
    <div className="space-y-3">
      {counts.open === 0 ? (
        <p className="type-secondary">Nothing to do right now.</p>
      ) : (
        <>
          <p className="type-secondary">
            {plural(counts.open, "chore", "chores")} to do
            {counts.mine > 0 ? `, ${counts.mine} assigned to you` : ""}.
          </p>
          {counts.overdue > 0 ? (
            <p>
              <StatusBadge status="danger">
                {plural(counts.overdue, "chore", "chores")} overdue
              </StatusBadge>
            </p>
          ) : null}
        </>
      )}
      <div>
        <Button variant="outline" asChild>
          <Link href={`/households/${household.id}/chores`}>
            <ListChecksIcon aria-hidden="true" data-icon="inline-start" />
            Chores
          </Link>
        </Button>
      </div>
    </div>
  );
}

export function SummarySkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="space-y-3"
    >
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-10 w-32" />
    </div>
  );
}
