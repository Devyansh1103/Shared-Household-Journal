import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { imageProblemMessage } from "@/lib/receipts/image";
import { RECEIPT_UPLOAD_MAX_BYTES } from "@/lib/receipts/limits";
import { storeReceipt } from "@/lib/receipts/server";
import { householdErrorMessage } from "@/lib/households/errors";

// Uploads a receipt image for review (roadmap Phase 19, D31). Signed in, a
// member of the household (checked by create_receipt), same origin only, a
// JPEG, PNG or WebP of at most 4 MiB, checked from its bytes. The browser has
// already turned PDFs into images and shrunk photos (src/lib/receipts/prepare.ts).
//
// A Route Handler rather than a Server Action because it takes a file, and
// Server Actions allow 1 MB bodies by default. Server Actions compare Origin
// and Host themselves; this handler does the same before anything else.

const NO_STORE = { "Cache-Control": "private, no-store" };

function answer(status: number, body: Record<string, string>) {
  return Response.json(body, { status, headers: NO_STORE });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/households/[householdId]/receipts">,
) {
  if (!sameOrigin(request))
    return answer(403, {
      error: "forbidden",
      message: "Reload the page and try again.",
    });
  const user = await getCurrentUser();
  if (!user)
    return answer(401, {
      error: "signed_out",
      message: "Sign in again to upload a receipt.",
    });

  const { householdId } = await ctx.params;
  if (!z.uuid().safeParse(householdId).success) {
    return answer(404, {
      error: "not_found",
      message: "We couldn't find that household.",
    });
  }
  // Refuse big bodies before reading them (multipart adds a little).
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > RECEIPT_UPLOAD_MAX_BYTES + 64 * 1024) {
    return answer(413, {
      error: "too_large",
      message: imageProblemMessage("too_large"),
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return answer(400, {
      error: "bad_request",
      message: "The upload didn't arrive whole. Try again.",
    });
  }
  const file = form.get("file");
  const requestKey = z.uuid().safeParse(form.get("requestKey"));
  if (!(file instanceof File) || !requestKey.success) {
    return answer(400, {
      error: "bad_request",
      message: "Reload the page and try again.",
    });
  }
  if (file.size > RECEIPT_UPLOAD_MAX_BYTES) {
    return answer(413, {
      error: "too_large",
      message: imageProblemMessage("too_large"),
    });
  }

  const result = await storeReceipt(
    householdId,
    new Uint8Array(await file.arrayBuffer()),
    requestKey.data,
  );
  if (result.ok) return answer(201, { receiptId: result.receiptId });
  if (result.problem !== "database") {
    return answer(result.status, {
      error: result.problem,
      message: imageProblemMessage(result.problem),
    });
  }
  if (result.code === "storage") {
    return answer(502, {
      error: "storage",
      message: "The receipt couldn't be stored. Try again.",
    });
  }
  return answer(result.status, {
    error: result.code ?? "failed",
    message:
      result.code === "42501"
        ? "We couldn't find that household."
        : householdErrorMessage(result.code),
  });
}
