import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { readReceiptFile } from "@/lib/receipts/server";

// A receipt's image, for people who may see it (roadmap Phase 19, D31): an
// attached receipt for the household's active members, an upload waiting for
// review for its uploader. Checked on every request, so access ends the
// moment membership does; the storage path and any signed URL never reach the
// browser. Never cached by browsers or proxies. `?download=1` saves it.

const NOT_FOUND = { error: "not_found" };

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/receipts/[receiptId]">,
) {
  const headers = { "Cache-Control": "private, no-store" };
  const user = await getCurrentUser();
  if (!user)
    return Response.json({ error: "signed_out" }, { status: 401, headers });

  const { receiptId } = await ctx.params;
  if (!z.uuid().safeParse(receiptId).success) {
    return Response.json(NOT_FOUND, { status: 404, headers });
  }
  // Someone else's receipt and one that doesn't exist get the same answer.
  const file = await readReceiptFile(receiptId);
  if (!file) return Response.json(NOT_FOUND, { status: 404, headers });

  const download = new URL(request.url).searchParams.get("download") === "1";
  const extension = file.contentType.split("/")[1].replace("jpeg", "jpg");
  return new Response(file.bytes, {
    headers: {
      ...headers,
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="receipt.${extension}"`,
      // An image, never a document: nothing in it can run.
      "Content-Security-Policy":
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
