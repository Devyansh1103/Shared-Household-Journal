import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getHousehold, type Household } from "@/lib/households/queries";
import { createClient } from "@/lib/supabase/server";
import type { Chore } from "./board";

// Data access for chores (roadmap Phase 15). Reads run as the signed-in member
// under RLS, after getHousehold (404 for non-members); every row is also
// checked to be this household's before it's shown. Writes go through the
// chore functions.

/** Every open chore is shown; of the done ones, the latest. */
export const OPEN_LIMIT = 500;
export const COMPLETED_LIMIT = 50;

const COLUMNS =
  "id, household_id, title, description, assignee_id, due_on, priority, created_by, completed_at, completed_by, removed_at, created_at, updated_at";

type Row = {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  assignee_id: string | null;
  due_on: string | null;
  priority: Chore["priority"];
  created_by: string;
  completed_at: string | null;
  completed_by: string | null;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
};

function toChore(row: Row): Chore {
  return {
    id: row.id,
    householdId: row.household_id,
    title: row.title,
    description: row.description,
    assigneeId: row.assignee_id,
    dueOn: row.due_on,
    priority: row.priority,
    createdBy: row.created_by,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ChoresView =
  | {
      ok: true;
      chores: Chore[];
      openTruncated: boolean;
      completedTruncated: boolean;
    }
  | { ok: false; reason: "not_verified" };

/** The household's chores (not removed): every open one, the latest done. */
export async function getChores(householdId: string): Promise<ChoresView> {
  const household = await getHousehold(householdId);
  const supabase = await createClient();
  const [open, completed] = await Promise.all([
    supabase
      .from("chores")
      .select(COLUMNS)
      .eq("household_id", household.id)
      .is("removed_at", null)
      .is("completed_at", null)
      .order("due_on", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(OPEN_LIMIT + 1),
    supabase
      .from("chores")
      .select(COLUMNS)
      .eq("household_id", household.id)
      .is("removed_at", null)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(COMPLETED_LIMIT + 1),
  ]);
  if (open.error || completed.error) {
    throw new Error("Could not load the chores.");
  }
  const rows = [
    ...open.data.slice(0, OPEN_LIMIT),
    ...completed.data.slice(0, COMPLETED_LIMIT),
  ];
  if (
    rows.some(
      (row) => row.household_id !== household.id || row.removed_at !== null,
    )
  ) {
    console.error("Chores failed verification: foreign_or_removed");
    return { ok: false, reason: "not_verified" };
  }
  return {
    ok: true,
    chores: rows.map(toChore),
    openTruncated: open.data.length > OPEN_LIMIT,
    completedTruncated: completed.data.length > COMPLETED_LIMIT,
  };
}

export type ChoreView =
  { state: "active"; chore: Chore } | { state: "removed"; chore: Chore };

/** One chore of the household, or a 404 (also for other households' ids). */
export async function getChore(
  householdId: string,
  choreId: string,
): Promise<{ household: Household; view: ChoreView }> {
  const household = await getHousehold(householdId);
  if (!z.uuid().safeParse(choreId).success) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chores")
    .select(COLUMNS)
    .eq("id", choreId)
    .eq("household_id", household.id)
    .maybeSingle();
  if (error) throw new Error("Could not load the chore.");
  if (!data || data.household_id !== household.id) notFound();
  return {
    household,
    view: {
      state: data.removed_at === null ? "active" : "removed",
      chore: toChore(data),
    },
  };
}

/** Open chores: how many, how many are overdue, how many are yours. */
export async function getChoreCounts(
  householdId: string,
  today: string,
): Promise<{ open: number; overdue: number; mine: number }> {
  const household = await getHousehold(householdId);
  const supabase = await createClient();
  const base = () =>
    supabase
      .from("chores")
      .select("id", { count: "exact", head: true })
      .eq("household_id", household.id)
      .is("removed_at", null)
      .is("completed_at", null);
  const [open, overdue, mine] = await Promise.all([
    base(),
    base().lt("due_on", today),
    base().eq("assignee_id", household.myUserId),
  ]);
  if (open.error || overdue.error || mine.error) {
    throw new Error("Could not load the chores.");
  }
  return {
    open: open.count ?? 0,
    overdue: overdue.count ?? 0,
    mine: mine.count ?? 0,
  };
}
