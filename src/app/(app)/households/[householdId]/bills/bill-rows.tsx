import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { Amount } from "@/components/amount";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BoardItem } from "@/lib/bills/board";
import type { DueKind } from "@/lib/bills/schedule";
import { categoryLabel } from "@/lib/expenses/categories";
import { formatDate } from "@/lib/format";

/** Status in words with an icon: colour is never the only signal. */
export const DUE_BADGES: Record<
  DueKind,
  { status: "danger" | "warning" | "info" | "neutral"; label: string }
> = {
  overdue: { status: "danger", label: "Overdue" },
  today: { status: "warning", label: "Due today" },
  soon: { status: "info", label: "Due soon" },
  later: { status: "neutral", label: "Upcoming" },
};

/** Periods of bills: what, when, how much is expected, who usually pays. */
export function PeriodRows({
  items,
  base,
  currency,
  payerName,
}: {
  items: BoardItem[];
  base: string;
  currency: string;
  payerName: (userId: string) => string;
}) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {items.map((item) => {
        const badge = DUE_BADGES[item.kind];
        const billHref = `${base}/${item.bill.id}`;
        return (
          <li
            key={`${item.bill.id}|${item.dueOn}`}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  href={billHref}
                  className="min-w-0 truncate rounded-sm type-card-title underline-offset-4 hover:underline"
                >
                  {item.bill.description}
                </Link>
                <StatusBadge status={badge.status}>{badge.label}</StatusBadge>
              </div>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 type-secondary">
                <span>
                  {item.label} · {formatDate(item.dueOn)}
                </span>
                <Badge variant="outline">
                  {categoryLabel(item.bill.category)}
                </Badge>
                <span className="min-w-0 truncate">
                  Usually paid by {payerName(item.bill.payerId)}
                </span>
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <span className="text-right">
                <span className="block type-help">Expected</span>
                <Amount minor={item.expectedMinor} currency={currency} />
              </span>
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={`${billHref}/record?due=${item.dueOn}`}
                  aria-label={`Record ${item.bill.description} due ${formatDate(item.dueOn)}`}
                >
                  Record
                </Link>
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Bills without a period to show: paused or ended. */
export function BillLinks({
  bills,
  base,
  label,
}: {
  bills: { id: string; description: string }[];
  base: string;
  label: string;
}) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {bills.map((bill) => (
        <li key={bill.id}>
          <Link
            href={`${base}/${bill.id}`}
            className="flex items-center gap-3 p-4 hover:bg-muted"
          >
            <span className="min-w-0 flex-1 truncate type-card-title">
              {bill.description}
            </span>
            <StatusBadge status="neutral">{label}</StatusBadge>
            <ChevronRightIcon
              aria-hidden="true"
              className="size-5 shrink-0 text-muted-foreground"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
