import "server-only";
import { createClient } from "@/lib/supabase/server";

// Reads for receipts (roadmap Phase 19, D31), under RLS as the signed-in
// person: an attached receipt (and the record of a removed one) for every
// active member; an upload waiting for review only for its uploader. Never
// the storage path: the browser reaches images through /api/receipts/[id].

export type ExpenseReceipt = {
  attached: { id: string; attachedByName: string; attachedAt: string } | null;
  /** The latest removal, shown when nothing is attached. */
  lastRemoved: { removedByName: string; removedAt: string } | null;
};

export async function getExpenseReceipt(
  expenseId: string,
): Promise<ExpenseReceipt> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("receipts")
    .select(
      "id, status, attached_at, removed_at, attacher:profiles!receipts_attached_by_fkey(display_name), remover:profiles!receipts_removed_by_fkey(display_name)",
    )
    .eq("expense_id", expenseId)
    .in("status", ["attached", "removed"])
    .order("attached_at", { ascending: false });
  if (error) throw new Error("Could not load the receipt.");

  const attached = data.find((r) => r.status === "attached");
  const removed = data
    .filter((r) => r.status === "removed" && r.removed_at)
    .sort((a, b) => (a.removed_at! < b.removed_at! ? 1 : -1))[0];
  return {
    attached: attached
      ? {
          id: attached.id,
          attachedByName: attached.attacher?.display_name ?? "Former member",
          attachedAt: attached.attached_at!,
        }
      : null,
    lastRemoved:
      !attached && removed
        ? {
            removedByName: removed.remover?.display_name ?? "Former member",
            removedAt: removed.removed_at!,
          }
        : null,
  };
}

/** Your own upload waiting for review in this household, if it still is. */
export async function getMyWaitingReceipt(
  householdId: string,
  receiptId: string,
): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from("receipts")
    .select("id")
    .eq("id", receiptId)
    .eq("household_id", householdId)
    .eq("uploaded_by", auth.user.id)
    .eq("status", "uploaded")
    .maybeSingle();
  return data;
}
