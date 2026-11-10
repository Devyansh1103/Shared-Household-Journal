import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { SplitMethod } from "@/domain/money/split";
import { createClient } from "@/lib/supabase/server";
import {
  getHousehold,
  listMembers,
  type Household,
} from "@/lib/households/queries";
import type { ExpenseCategory } from "./categories";

// Data access for expenses. Reads run as the signed-in user under RLS; the
// household is checked first through getHousehold (404 for non-members).

export type ExpenseListItem = {
  id: string;
  description: string;
  amountMinor: number;
  category: ExpenseCategory;
  expenseDate: string;
  payerName: string;
  deletedAt: string | null;
};

export type ExpenseList = {
  active: ExpenseListItem[];
  deleted: ExpenseListItem[];
  /** More active expenses exist than are shown (pagination is Phase 12). */
  truncated: boolean;
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

export const LIST_LIMIT = 100;
const DELETED_LIMIT = 20;

/** "Name (left)" for people who are no longer active members (D13). */
function nameFor(
  name: string | null | undefined,
  userId: string,
  activeIds: Set<string>,
): string {
  const base = name ?? "Former member";
  return activeIds.has(userId) ? base : `${base} (left)`;
}

const LIST_COLUMNS =
  "id, description, amount_minor, category, expense_date, paid_by, deleted_at, payer:profiles!expenses_paid_by_fkey(display_name)";

export async function listExpenses(householdId: string): Promise<ExpenseList> {
  const household = await getHousehold(householdId);
  const supabase = await createClient();

  const [members, active, deleted] = await Promise.all([
    listMembers(household.id),
    supabase
      .from("expenses")
      .select(LIST_COLUMNS)
      .eq("household_id", household.id)
      .is("deleted_at", null)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT + 1),
    supabase
      .from("expenses")
      .select(LIST_COLUMNS)
      .eq("household_id", household.id)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(DELETED_LIMIT),
  ]);
  if (active.error || deleted.error) {
    throw new Error("Could not load the expenses.");
  }

  const activeIds = new Set(members.map((m) => m.userId));
  const toItem = (row: (typeof active.data)[number]): ExpenseListItem => ({
    id: row.id,
    description: row.description,
    amountMinor: row.amount_minor,
    category: row.category,
    expenseDate: row.expense_date,
    payerName: nameFor(row.payer?.display_name, row.paid_by, activeIds),
    deletedAt: row.deleted_at,
  });

  return {
    active: active.data.slice(0, LIST_LIMIT).map(toItem),
    deleted: deleted.data.map(toItem),
    truncated: active.data.length > LIST_LIMIT,
  };
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
    listMembers(household.id),
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
    .sort(
      (a, b) =>
        (joinOrder.get(a.userId) ?? Infinity) -
          (joinOrder.get(b.userId) ?? Infinity) ||
        a.userId.localeCompare(b.userId),
    );

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

/** Active members in the order they joined (ADR-004's order for leftovers). */
export async function membersInJoinOrder(householdId: string) {
  const members = await listMembers(householdId);
  return [...members].sort(
    (a, b) =>
      a.joinedAt.localeCompare(b.joinedAt) || a.userId.localeCompare(b.userId),
  );
}
