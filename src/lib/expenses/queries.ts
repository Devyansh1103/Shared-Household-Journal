import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { SplitMethod } from "@/domain/money/split";
import { createClient } from "@/lib/supabase/server";
import {
  getHousehold,
  listMembersInJoinOrder,
  type Household,
} from "@/lib/households/queries";
import type { ExpenseCategory } from "./categories";
import {
  expenseHistoryArgs,
  HISTORY_PAGE_SIZE,
  type HistoryFilters,
} from "./history";
import {
  checkHistory,
  parseHistoryPayload,
  type HistoryPage,
} from "./history-payload";

// Data access for expenses. Reads run as the signed-in user under RLS; the
// household is checked first through getHousehold (404 for non-members).

export type ExpenseHistoryView =
  | { ok: true; history: HistoryPage }
  | {
      ok: false;
      /** The figures didn't pass their checks, so none are shown. */
      reason: "not_verified";
    };

export type ExpenseShare = {
  userId: string;
  name: string;
  shareMinor: number;
  percentageBp: number | null;
};

export type ExpenseDetail = {
  id: string;
  description: string;
  amountMinor: number;
  category: ExpenseCategory;
  expenseDate: string;
  splitMethod: SplitMethod;
  paidBy: string;
  payerName: string;
  createdBy: string;
  creatorName: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedByName: string | null;
  shares: ExpenseShare[];
  /** D6: the creator, the payer or the owner. */
  canChange: boolean;
  /** D7: the owner, for a deleted expense. */
  canRestore: boolean;
  /** Everyone involved is still a member, so it can be edited or restored. */
  everyoneActive: boolean;
};

/** "Name (left)" for people who are no longer active members (D13). */
function nameFor(
  name: string | null | undefined,
  userId: string,
  activeIds: Set<string>,
): string {
  const base = name ?? "Former member";
  return activeIds.has(userId) ? base : `${base} (left)`;
}

/**
 * One page of the household's expense history (roadmap Phase 12): searched,
 * filtered, sorted and paged by public.expense_history as the signed-in
 * member, under RLS, then checked (checkHistory) before anything is shown.
 * Non-members get the household's 404 (getHousehold).
 */
export async function getExpenseHistory(
  householdId: string,
  filters: HistoryFilters,
): Promise<ExpenseHistoryView> {
  const household = await getHousehold(householdId);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "expense_history",
    expenseHistoryArgs(household.id, filters),
  );
  if (error) {
    // Membership ended after getHousehold: the same answer as for anyone else.
    if (error.code === "42501") notFound();
    throw new Error("Could not load the expenses.");
  }

  const history = parseHistoryPayload(data);
  const check = history
    ? checkHistory(history, {
        householdId: household.id,
        filters,
        pageSize: HISTORY_PAGE_SIZE,
      })
    : ({ ok: false, code: "malformed" } as const);
  if (!history || !check.ok) {
    // The reason only: no figures, names or ids in logs.
    console.error(
      `Expense history failed verification: ${check.ok ? "malformed" : check.code}`,
    );
    return { ok: false, reason: "not_verified" };
  }
  return { ok: true, history };
}

/** One expense of the household, or a 404 (also for other households' ids). */
export async function getExpense(
  householdId: string,
  expenseId: string,
): Promise<{ household: Household; expense: ExpenseDetail }> {
  const household = await getHousehold(householdId);
  if (!z.uuid().safeParse(expenseId).success) notFound();
  const supabase = await createClient();

  const [members, result] = await Promise.all([
    listMembersInJoinOrder(household.id),
    supabase
      .from("expenses")
      .select(
        `id, description, amount_minor, category, expense_date, split_method,
         paid_by, created_by, created_at, updated_at, deleted_at, deleted_by,
         payer:profiles!expenses_paid_by_fkey(display_name),
         creator:profiles!expenses_created_by_fkey(display_name),
         deleter:profiles!expenses_deleted_by_fkey(display_name),
         expense_splits(user_id, share_minor, percentage_bp, profiles(display_name))`,
      )
      .eq("id", expenseId)
      .eq("household_id", household.id)
      .maybeSingle(),
  ]);
  if (result.error) throw new Error("Could not load the expense.");
  const row = result.data;
  if (!row) notFound();

  const activeIds = new Set(members.map((m) => m.userId));
  // Shares are listed in join order, the order the split engine used.
  const joinOrder = new Map(members.map((m, i) => [m.userId, i]));
  const me = household.myUserId;
  const isOwner = household.myRole === "owner";

  const shares = row.expense_splits
    .map((split) => ({
      userId: split.user_id,
      name: nameFor(split.profiles?.display_name, split.user_id, activeIds),
      shareMinor: split.share_minor,
      percentageBp: split.percentage_bp,
    }))
    .sort((a, b) => {
      const byJoin =
        (joinOrder.get(a.userId) ?? Infinity) -
        (joinOrder.get(b.userId) ?? Infinity);
      if (byJoin) return byJoin;
      // Former members: a fixed order by id (code points, not collation).
      return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
    });

  const everyoneActive =
    activeIds.has(row.paid_by) && shares.every((s) => activeIds.has(s.userId));

  return {
    household,
    expense: {
      id: row.id,
      description: row.description,
      amountMinor: row.amount_minor,
      category: row.category,
      expenseDate: row.expense_date,
      splitMethod: row.split_method,
      paidBy: row.paid_by,
      payerName: nameFor(row.payer?.display_name, row.paid_by, activeIds),
      createdBy: row.created_by,
      creatorName: nameFor(
        row.creator?.display_name,
        row.created_by,
        activeIds,
      ),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      deletedByName: row.deleted_by
        ? nameFor(row.deleter?.display_name, row.deleted_by, activeIds)
        : null,
      shares,
      canChange:
        !row.deleted_at &&
        (row.created_by === me || row.paid_by === me || isOwner),
      canRestore: Boolean(row.deleted_at) && isOwner,
      everyoneActive,
    },
  };
}
