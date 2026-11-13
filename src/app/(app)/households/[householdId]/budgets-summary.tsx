import Link from "next/link";
import { ChartColumnIcon, PiggyBankIcon } from "lucide-react";
import { Amount } from "@/components/amount";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  budgetFigures,
  formatPermille,
  STATUS_LABELS,
  type BudgetStatus,
} from "@/lib/budgets/figures";
import { getBudgets } from "@/lib/budgets/queries";
import type { Household } from "@/lib/households/queries";

const BADGES: Record<
  BudgetStatus,
  "neutral" | "success" | "warning" | "danger"
> = {
  not_started: "neutral",
  on_track: "success",
  near_limit: "warning",
  exceeded: "danger",
};

/**
 * This month's budgets at a glance (roadmap Phase 16): the budget for
 * everything, and how many category budgets are near or over their limit.
 * Shown in the app only; nothing is sent (notifications are Phase 17, D12).
 */
export async function BudgetsSummary({ household }: { household: Household }) {
  const view = await getBudgets(household.id, "month", null);
  const base = `/households/${household.id}`;
  const links = (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" asChild>
        <Link href={`${base}/budgets`}>
          <PiggyBankIcon aria-hidden="true" data-icon="inline-start" />
          Budgets
        </Link>
      </Button>
      <Button variant="outline" asChild>
        <Link href={`${base}/analytics`}>
          <ChartColumnIcon aria-hidden="true" data-icon="inline-start" />
          Spending analytics
        </Link>
      </Button>
    </div>
  );
  if (!view.ok) {
    return (
      <div className="space-y-3">
        <p className="type-secondary">
          Budgets can&apos;t be shown right now. Open them to try again.
        </p>
        {links}
      </div>
    );
  }
  const { budgets, totalSpentMinor } = view.data;
  const overall = budgets.find((b) => b.category === null);
  const categories = budgets
    .filter((b) => b.category !== null)
    .map((b) => budgetFigures(b.limitMinor, b.spentMinor).status);
  const over = categories.filter((s) => s === "exceeded").length;
  const near = categories.filter((s) => s === "near_limit").length;
  const figures = overall
    ? budgetFigures(overall.limitMinor, overall.spentMinor)
    : null;

  return (
    <div className="space-y-3">
      {figures ? (
        <p className="flex flex-wrap items-center gap-2 type-body">
          <span>
            This month:{" "}
            <Amount
              minor={figures.spentMinor}
              currency={household.currencyCode}
            />{" "}
            of{" "}
            <Amount
              minor={figures.limitMinor}
              currency={household.currencyCode}
            />
            {figures.usedPermille !== null
              ? ` (${formatPermille(figures.usedPermille)})`
              : ""}
          </span>
          <StatusBadge status={BADGES[figures.status]}>
            {STATUS_LABELS[figures.status]}
          </StatusBadge>
        </p>
      ) : (
        <p className="type-secondary">
          Spent this month:{" "}
          <Amount minor={totalSpentMinor} currency={household.currencyCode} />.
          No monthly budget for everything yet.
        </p>
      )}
      {over + near > 0 ? (
        <ul
          className="flex flex-wrap gap-2"
          aria-label="Category budgets that need attention"
        >
          {over > 0 ? (
            <li>
              <StatusBadge status="danger">
                {over === 1
                  ? "1 category over budget"
                  : `${over} categories over budget`}
              </StatusBadge>
            </li>
          ) : null}
          {near > 0 ? (
            <li>
              <StatusBadge status="warning">
                {near === 1
                  ? "1 category near its limit"
                  : `${near} categories near their limits`}
              </StatusBadge>
            </li>
          ) : null}
        </ul>
      ) : null}
      {links}
    </div>
  );
}
