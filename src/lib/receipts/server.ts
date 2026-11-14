import "server-only";
import { createClient } from "@/lib/supabase/server";
import { inspectReceiptImage, type ImageProblem } from "./image";

// Receipt files on the server (roadmap Phase 19, D31). Everything runs as the
// signed-in person: the database functions decide what may happen, and the
// receipts bucket's policies only let a file be stored, read or deleted when
// its row allows it. The app never uses a service key.

const BUCKET = "receipts";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type StoreResult =
  | { ok: true; receiptId: string }
  | {
      ok: false;
      status: number;
      problem: ImageProblem | "database";
      code?: string;
    };

/**
 * Deletes the signed-in person's files that are due to go (uploads unused for
 * a day, files of receipts they removed whose deletion failed), then forgets
 * those unused uploads. Best effort: there's no scheduler, so this runs
 * whenever they upload (D31).
 */
export async function clearMyReceiptFiles(supabase: Supabase): Promise<void> {
  const { data } = await supabase.rpc("my_receipt_files_to_clear");
  const paths = (data ?? []).map((row) => row.storage_path);
  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);
  await supabase.rpc("forget_my_stale_receipts");
}

/** Deletes stored files by path (as the signed-in person). */
export async function removeReceiptFiles(
  supabase: Supabase,
  paths: string[],
): Promise<boolean> {
  if (paths.length === 0) return true;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  return !error;
}

/**
 * Checks an uploaded file from its bytes and stores it as a receipt waiting
 * for review. A repeated request key returns the same receipt.
 */
export async function storeReceipt(
  householdId: string,
  bytes: Uint8Array,
  requestKey: string,
): Promise<StoreResult> {
  const checked = inspectReceiptImage(bytes);
  if (!checked.ok) {
    return {
      ok: false,
      status: checked.problem === "too_large" ? 413 : 422,
      problem: checked.problem,
    };
  }
  const { image } = checked;
  const supabase = await createClient();
  await clearMyReceiptFiles(supabase).catch(() => {});

  const created = await supabase.rpc("create_receipt", {
    target_household_id: householdId,
    content_type: image.type,
    byte_size: bytes.length,
    width: image.width,
    height: image.height,
    request_key: requestKey,
  });
  const row = created.data as {
    receipt_id: string;
    storage_path: string;
    status: string;
  } | null;
  if (created.error || !row) {
    const code = created.error?.code;
    return {
      ok: false,
      status: code === "42501" ? 404 : code === "HJ037" ? 429 : 400,
      problem: "database",
      code,
    };
  }
  if (row.status !== "pending") return { ok: true, receiptId: row.receipt_id };

  const stored = await supabase.storage
    .from(BUCKET)
    .upload(row.storage_path, bytes, {
      contentType: image.type,
      upsert: false,
    });
  // A retry may find the file already stored by the first attempt.
  const alreadyThere =
    stored.error && /exists|duplicate/i.test(stored.error.message);
  if (stored.error && !alreadyThere) {
    await supabase.rpc("discard_receipt", {
      target_receipt_id: row.receipt_id,
    });
    return { ok: false, status: 502, problem: "database", code: "storage" };
  }
  const marked = await supabase.rpc("mark_receipt_uploaded", {
    target_receipt_id: row.receipt_id,
  });
  if (marked.error) {
    await removeReceiptFiles(supabase, [row.storage_path]);
    await supabase.rpc("discard_receipt", {
      target_receipt_id: row.receipt_id,
    });
    return {
      ok: false,
      status: 502,
      problem: "database",
      code: marked.error.code,
    };
  }
  return { ok: true, receiptId: row.receipt_id };
}

export type ReceiptFile = { bytes: ArrayBuffer; contentType: string };

/**
 * A receipt's image, if the signed-in person may see it: attached to an
 * expense in a household they're in, or their own upload waiting for review.
 * Both the row (RLS) and the file (Storage policies) are checked.
 */
export async function readReceiptFile(
  receiptId: string,
): Promise<ReceiptFile | null> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("receipts")
    .select("storage_path, content_type, status")
    .eq("id", receiptId)
    .maybeSingle();
  if (!row || row.status === "removed") return null;
  const { data: file, error } = await supabase.storage
    .from(BUCKET)
    .download(row.storage_path);
  if (error || !file) return null;
  return { bytes: await file.arrayBuffer(), contentType: row.content_type };
}
