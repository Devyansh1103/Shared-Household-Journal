// "Needs attention" (D30, decided 2026-11-13): what's due or near a limit
// right now, worked out from the same reads as the Bills, Chores and Budgets
// pages every time it's shown. These aren't notifications: there's no event
// (no scheduler, ADR-010), nothing is stored, nothing is read or unread, and
// each goes away once it's dealt with. Pure.

import { formatMoney } from "@/lib/format";
import type { HouseholdBills } from "@/lib/bills/payload";
import { dueLabel } from "@/lib/bills/schedule";
import type { Chore } from "@/lib/chores/board";
import { budgetFigures, formatPermille } from "@/lib/budgets/figures";
import type { HouseholdBudgets } from "@/lib/budgets/payload";
import { budgetName } from "@/lib/budgets/words";

export type Reminder = {
  key: string;
  householdId: string;
  householdName: string;
  kind: "bill" | "chore" | "budget";
  /** Overdue and over budget are "danger"; due today and near a limit "warning". */
  tone: "danger" | "warning";
  /** The status in words, beside its icon: never colour alone. */
  label: string;
  title: string;
  detail: string;
  href: string;
};

export type HouseholdReminderData = {
  household: { id: string; name: string; currencyCode: string };
  /** The household's date (D11), from the database. */
  today: string;
  bills: HouseholdBills | null;
  /** Open chores of the household. */
  chores: Chore[] | null;
  /** The current week's, month's and quarter's budgets. */
  budgets: HouseholdBudgets[];
};

const RANK: Record<Reminder["tone"], number> = { danger: 0, warning: 1 };

export function householdReminders(
  data: HouseholdReminderData,
  viewerId: string,
): Reminder[] {
  const { household, today } = data;
  const base = `/households/${household.id}`;
  const money = (minor: bigint) => formatMoney(minor, household.currencyCode);
  const reminders: Reminder[] = [];
  const common = { householdId: household.id, householdName: household.name };

  if (data.bills) {
    const bills = new Map(data.bills.bills.map((b) => [b.id, b]));
    for (const period of data.bills.open) {
      if (period.dueOn > today) continue; // recorded early: not due yet
      const bill = bills.get(period.billId);
      if (!bill) continue;
      const overdue = period.dueOn < today;
      reminders.push({
        ...common,
        key: `bill|${bill.id}|${period.dueOn}`,
        kind: "bill",
        tone: overdue ? "danger" : "warning",
        label: overdue ? "Overdue" : "Due today",
        title: bill.description,
        detail: `${dueLabel(period.dueOn, today)} · ${money(period.expectedMinor)} expected`,
        href: `${base}/bills/${bill.id}`,
      });
    }
  }

  for (const chore of data.chores ?? []) {
    if (
      chore.completedAt !== null ||
      chore.dueOn === null ||
      chore.dueOn > today
    ) {
      continue;
    }
    // Yours, or nobody's (anyone can pick those up, D28).
    if (chore.assigneeId !== null && chore.assigneeId !== viewerId) continue;
    const overdue = chore.dueOn < today;
    reminders.push({
      ...common,
      key: `chore|${chore.id}`,
      kind: "chore",
      tone: overdue ? "danger" : "warning",
      label: overdue ? "Overdue" : "Due today",
      title: chore.title,
      detail:
        chore.assigneeId === null
          ? `${dueLabel(chore.dueOn, today)} · assigned to nobody`
          : dueLabel(chore.dueOn, today),
      href: `${base}/chores`,
    });
  }

  for (const period of data.budgets) {
    for (const budget of period.budgets) {
      const figures = budgetFigures(budget.limitMinor, budget.spentMinor);
      if (figures.status !== "near_limit" && figures.status !== "exceeded")
        continue;
      const over = figures.status === "exceeded";
      reminders.push({
        ...common,
        key: `budget|${budget.id}|${period.periodStart}`,
        kind: "budget",
        tone: over ? "danger" : "warning",
        label: over ? "Over budget" : "Near limit",
        title: budgetName(budget.category, budget.period),
        detail: over
          ? `${money(figures.overMinor)} over the limit of ${money(figures.limitMinor)}`
          : `${figures.usedPermille !== null ? formatPermille(figures.usedPermille) : ""} used · ${money(figures.remainingMinor)} left`,
        href: `${base}/budgets${budget.period === "month" ? "" : `?period=${budget.period}`}`,
      });
    }
  }

  return reminders.sort(
    (a, b) =>
      RANK[a.tone] - RANK[b.tone] ||
      a.kind.localeCompare(b.kind) ||
      a.title.localeCompare(b.title, "en-IN"),
  );
}
