import Link from "next/link";
import { PencilIcon } from "lucide-react";
import { cn } from "cn";
import { Amount } from "@/components/amount";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  barPercent,
  budgetFigures,
  formatPermille,
  STATUS_LABELS,
  type BudgetStatus,
} from "@/lib/budgets/figures";
import type { BudgetRow } from "@/lib/budgets/payload";
import { PERIOD_ADJECTIVES } from "@/lib/budgets/period";
import { budgetName, budgetSubject } from "@/lib/budgets/words";
import type { Household } from "@/lib/households/queries";
import { archiveBudget } from "./actions";

/** Status in words with an icon: colour is never the only signal. */
const BADGES: Record<
  BudgetStatus,
  "neutral" | "success" | "warning" | "danger"
> = {
  not_started: "neutral",
  on_track: "success",
  near_limit: "warning",
  exceeded: "danger",
};

/** Fills for the bar (a graphic, beside the figures in words). */
const FILLS: Record<BudgetStatus, string> = {
  not_started: "bg-primary",
  on_track: "bg-primary",
  near_limit: "bg-warning-fill",
  exceeded: "bg-destructive",
};

/**
 * One budget for one period: the limit, what's spent, what's left (or how
 * far over), how much is used, and a bar. The bar is decorative: the same
 * figures are in words next to it.
 */
export function BudgetCard({
  budget,
  household,
  editable,
  expensesHref,
}: {
  budget: BudgetRow;
  household: Household;
  /** The current period, and the budget isn't removed. */
  editable: boolean;
  expensesHref: string;
}) {
  const figures = budgetFigures(budget.limitMinor, budget.spentMinor);
  const currency = household.currencyCode;
  const name = budgetName(budget.category, budget.period);

  return (
    <article className="flex h-full flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="type-card-title">{budgetSubject(budget.category)}</h3>
          <p className="type-secondary">
            {PERIOD_ADJECTIVES[budget.period]} budget
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={BADGES[figures.status]}>
            {STATUS_LABELS[figures.status]}
          </StatusBadge>
          {budget.archived ? (
            <StatusBadge status="neutral">Removed since</StatusBadge>
          ) : null}
        </div>
      </div>

      <p className="type-body">
        <Amount minor={figures.spentMinor} currency={currency} /> spent of{" "}
        <Amount minor={figures.limitMinor} currency={currency} />
      </p>

      <div
        aria-hidden="true"
        className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", FILLS[figures.status])}
          style={{ width: `${barPercent(figures)}%` }}
        />
      </div>

      <p className="type-secondary">
        {figures.usedPermille !== null
          ? `${formatPermille(figures.usedPermille)} used · `
          : ""}
        {figures.overMinor > BigInt(0) ? (
          <span className="font-medium text-destructive">
            <Amount minor={figures.overMinor} currency={currency} /> over the
            limit
          </span>
        ) : (
          <>
            <Amount minor={figures.remainingMinor} currency={currency} /> left
          </>
        )}
      </p>

      <p className="type-help">
        <Link
          href={expensesHref}
          className="rounded-sm text-primary underline underline-offset-4"
        >
          {budget.expenseCount === 1
            ? "See the 1 expense"
            : `See the ${budget.expenseCount} expenses`}
        </Link>
      </p>

      {editable ? (
        <div className="mt-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link
              href={`/households/${household.id}/budgets/${budget.id}/edit`}
              aria-label={`Change limit: ${name}`}
            >
              <PencilIcon aria-hidden="true" data-icon="inline-start" />
              Change limit
            </Link>
          </Button>
          <ConfirmActionDialog
            triggerLabel="Remove"
            triggerAriaLabel={`Remove: ${name}`}
            triggerVariant="ghost"
            title={`Remove the ${name.toLowerCase()}?`}
            description="It stops covering this period and later ones. Periods that have already ended keep it, and the household journal keeps a record. No expense changes."
            confirmLabel="Remove budget"
            cancelLabel="Keep budget"
            pendingLabel="Removing…"
            destructive
            action={archiveBudget}
            fields={{ householdId: household.id, budgetId: budget.id }}
          />
        </div>
      ) : null}
    </article>
  );
}
