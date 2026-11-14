// Receipt file rules (roadmap Phase 19, D31), shared by the browser and the
// server. The server checks everything again; the browser checks first so
// people hear about a problem before waiting for an upload.

/** What a person may choose: a photo straight from a phone camera, or a PDF. */
export const RECEIPT_PICK_MAX_BYTES = 10 * 1024 * 1024;

/**
 * What the server stores (and the receipts bucket allows). The browser
 * shrinks and re-encodes a photo below this first; it also stays under
 * Vercel's limit on a request body (about 4.5 MB).
 */
export const RECEIPT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** Smallest side that can still hold readable text. */
export const RECEIPT_MIN_SIDE = 200;

/** Largest side the server accepts (the database checks the same). */
export const RECEIPT_MAX_SIDE = 8000;

/** The browser scales the longest side down to this before uploading. */
export const RECEIPT_TARGET_LONG_SIDE = 3000;

/** Image types the server stores. PDFs are turned into a JPEG in the browser. */
export const RECEIPT_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ReceiptImageType = (typeof RECEIPT_IMAGE_TYPES)[number];

/** For the file picker: what a person may choose. */
export const RECEIPT_ACCEPT =
  "image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf";

/** Unused uploads are cleared after this long (D31). */
export const RECEIPT_UNUSED_HOURS = 24;
