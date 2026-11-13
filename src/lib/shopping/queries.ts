import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getHousehold, type Household } from "@/lib/households/queries";
import { createClient } from "@/lib/supabase/server";
import type { ShoppingItem } from "./list";

// Data access for the shopping list (roadmap Phase 15). Reads run as the
// signed-in member under RLS, after getHousehold (404 for non-members); every
// row is also checked to be this household's before it's shown. Writes go
// through the shopping functions.

/** Everything still needed is shown; of what's been bought, the latest. */
export const PENDING_LIMIT = 500;
export const PURCHASED_LIMIT = 100;

const COLUMNS =
  "id, household_id, name, quantity, note, assignee_id, added_by, purchased_at, purchased_by, removed_at, created_at, updated_at";

type Row = {
  id: string;
  household_id: string;
  name: string;
  quantity: string | null;
  note: string | null;
  assignee_id: string | null;
  added_by: string;
  purchased_at: string | null;
  purchased_by: string | null;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
};

function toItem(row: Row): ShoppingItem {
  return {
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    quantity: row.quantity,
    note: row.note,
    assigneeId: row.assignee_id,
    addedBy: row.added_by,
    purchasedAt: row.purchased_at,
    purchasedBy: row.purchased_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ShoppingListView =
  | {
      ok: true;
      items: ShoppingItem[];
      /** More was bought than is shown. */
      purchasedTruncated: boolean;
      pendingTruncated: boolean;
    }
  | { ok: false; reason: "not_verified" };

/** The items on the list (not removed): all still needed, the latest bought. */
export async function getShoppingList(
  householdId: string,
): Promise<ShoppingListView> {
  const household = await getHousehold(householdId);
  const supabase = await createClient();
  const [pending, purchased] = await Promise.all([
    supabase
      .from("shopping_items")
      .select(COLUMNS)
      .eq("household_id", household.id)
      .is("removed_at", null)
      .is("purchased_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(PENDING_LIMIT + 1),
    supabase
      .from("shopping_items")
      .select(COLUMNS)
      .eq("household_id", household.id)
      .is("removed_at", null)
      .not("purchased_at", "is", null)
      .order("purchased_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(PURCHASED_LIMIT + 1),
  ]);
  if (pending.error || purchased.error) {
    throw new Error("Could not load the shopping list.");
  }
  const rows = [
    ...pending.data.slice(0, PENDING_LIMIT),
    ...purchased.data.slice(0, PURCHASED_LIMIT),
  ];
  if (
    rows.some(
      (row) => row.household_id !== household.id || row.removed_at !== null,
    )
  ) {
    // The reason only: no names or ids in logs.
    console.error("Shopping list failed verification: foreign_or_removed");
    return { ok: false, reason: "not_verified" };
  }
  return {
    ok: true,
    items: rows.map(toItem),
    pendingTruncated: pending.data.length > PENDING_LIMIT,
    purchasedTruncated: purchased.data.length > PURCHASED_LIMIT,
  };
}

export type ItemView =
  | { state: "active"; item: ShoppingItem }
  | { state: "removed"; item: ShoppingItem };

/** One item of the household, or a 404 (also for other households' ids). */
export async function getShoppingItem(
  householdId: string,
  itemId: string,
): Promise<{ household: Household; view: ItemView }> {
  const household = await getHousehold(householdId);
  if (!z.uuid().safeParse(itemId).success) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shopping_items")
    .select(COLUMNS)
    .eq("id", itemId)
    .eq("household_id", household.id)
    .maybeSingle();
  if (error) throw new Error("Could not load the item.");
  if (!data || data.household_id !== household.id) notFound();
  return {
    household,
    view: {
      state: data.removed_at === null ? "active" : "removed",
      item: toItem(data),
    },
  };
}

/** How many items are still needed, and how many of them are yours. */
export async function getShoppingCounts(
  householdId: string,
): Promise<{ pending: number; mine: number }> {
  const household = await getHousehold(householdId);
  const supabase = await createClient();
  const base = () =>
    supabase
      .from("shopping_items")
      .select("id", { count: "exact", head: true })
      .eq("household_id", household.id)
      .is("removed_at", null)
      .is("purchased_at", null);
  const [all, mine] = await Promise.all([
    base(),
    base().eq("assignee_id", household.myUserId),
  ]);
  if (all.error || mine.error) throw new Error("Could not load the list.");
  return { pending: all.count ?? 0, mine: mine.count ?? 0 };
}
