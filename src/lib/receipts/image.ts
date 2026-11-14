// Checks a receipt file from its bytes, never from its name or the type the
// browser claims (roadmap Phase 19). Pure and dependency-free, so the browser
// and the server use the same rules. It reads only headers: it never decodes
// an image, so a crafted file can't make it do much work.

import {
  RECEIPT_MAX_SIDE,
  RECEIPT_MIN_SIDE,
  RECEIPT_UPLOAD_MAX_BYTES,
  type ReceiptImageType,
} from "./limits";

export type SniffedType = ReceiptImageType | "application/pdf";

export type ImageInfo = {
  type: ReceiptImageType;
  width: number;
  height: number;
};

export type ImageProblem =
  | "empty"
  | "too_large"
  | "unsupported_type"
  | "corrupt"
  | "too_small"
  | "too_big";

export type InspectResult =
  { ok: true; image: ImageInfo } | { ok: false; problem: ImageProblem };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

function startsWith(bytes: Uint8Array, prefix: number[], at = 0): boolean {
  if (bytes.length < at + prefix.length) return false;
  return prefix.every((value, index) => bytes[at + index] === value);
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  if (bytes.length < at + length) return "";
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

function u16be(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1];
}

function u32be(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] << 24) |
      (bytes[at + 1] << 16) |
      (bytes[at + 2] << 8) |
      bytes[at + 3]) >>>
    0
  );
}

function u32le(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] |
      (bytes[at + 1] << 8) |
      (bytes[at + 2] << 16) |
      (bytes[at + 3] << 24)) >>>
    0
  );
}

function u24le(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
}

/** What the file really is, from its first bytes; null for anything else. */
export function sniffType(bytes: Uint8Array): SniffedType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP")
    return "image/webp";
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

type Size = { width: number; height: number } | null;

function pngSize(bytes: Uint8Array): Size {
  // IHDR is always the first chunk: length 13, then width and height.
  if (
    bytes.length < 33 ||
    u32be(bytes, 8) !== 13 ||
    ascii(bytes, 12, 4) !== "IHDR"
  )
    return null;
  if (!startsWith(bytes, PNG_IEND, bytes.length - PNG_IEND.length)) return null;
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

// Start-of-frame markers that carry the image size (not DHT, JPG or DAC).
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegSize(bytes: Uint8Array): Size {
  // It must end with the end-of-image marker (ignoring zero padding).
  let end = bytes.length;
  while (end > 2 && bytes[end - 1] === 0x00) end--;
  if (bytes[end - 2] !== 0xff || bytes[end - 1] !== 0xd9) return null;

  let at = 2;
  while (at + 4 <= end) {
    if (bytes[at] !== 0xff) return null;
    let marker = bytes[at + 1];
    while (marker === 0xff && at + 2 < end) {
      at++;
      marker = bytes[at + 1];
    }
    at += 2;
    // Markers without a length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) return null; // no frame before the scan
    if (at + 2 > end) return null;
    const length = u16be(bytes, at);
    if (length < 2 || at + length > end) return null;
    if (SOF_MARKERS.has(marker)) {
      if (length < 7) return null;
      return { height: u16be(bytes, at + 3), width: u16be(bytes, at + 5) };
    }
    at += length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): Size {
  // The RIFF size covers everything after the first 8 bytes, exactly.
  if (bytes.length < 30 || u32le(bytes, 4) + 8 !== bytes.length) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8 ") {
    if (!startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) return null;
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const b1 = bytes[21];
    const b2 = bytes[22];
    const b3 = bytes[23];
    const b4 = bytes[24];
    return {
      width: 1 + (b1 | ((b2 & 0x3f) << 8)),
      height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
    };
  }
  if (chunk === "VP8X") {
    return { width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
  }
  return null;
}

/**
 * Whether these bytes are a receipt image the server may store: JPEG, PNG or
 * WebP by signature, complete (not cut off), within the size limit, and with
 * sides between RECEIPT_MIN_SIDE and RECEIPT_MAX_SIDE.
 */
export function inspectReceiptImage(
  bytes: Uint8Array,
  maxBytes: number = RECEIPT_UPLOAD_MAX_BYTES,
): InspectResult {
  if (bytes.length === 0) return { ok: false, problem: "empty" };
  if (bytes.length > maxBytes) return { ok: false, problem: "too_large" };

  const type = sniffType(bytes);
  if (type === null || type === "application/pdf") {
    return { ok: false, problem: "unsupported_type" };
  }
  const size =
    type === "image/png"
      ? pngSize(bytes)
      : type === "image/jpeg"
        ? jpegSize(bytes)
        : webpSize(bytes);
  if (!size || size.width === 0 || size.height === 0) {
    return { ok: false, problem: "corrupt" };
  }
  if (size.width < RECEIPT_MIN_SIDE || size.height < RECEIPT_MIN_SIDE) {
    return { ok: false, problem: "too_small" };
  }
  if (size.width > RECEIPT_MAX_SIDE || size.height > RECEIPT_MAX_SIDE) {
    return { ok: false, problem: "too_big" };
  }
  return { ok: true, image: { type, ...size } };
}

/** What a person reads for each problem. */
export function imageProblemMessage(
  problem: ImageProblem | "pdf_pages" | "pdf_locked",
): string {
  switch (problem) {
    case "empty":
      return "That file is empty. Choose the receipt again.";
    case "too_large":
      return "That file is too large. Choose a receipt photo or PDF under 10 MB.";
    case "unsupported_type":
      return "That isn't a receipt we can read. Choose a JPEG, PNG or WebP photo, or a PDF.";
    case "corrupt":
      return "That file seems damaged or incomplete. Take the photo again or choose another file.";
    case "too_small":
      return `That image is too small to read (under ${RECEIPT_MIN_SIDE} pixels on a side). Use a larger photo.`;
    case "too_big":
      return "That image is too large to process. Take the photo at a lower resolution.";
    case "pdf_pages":
      return "Only single-page PDF receipts can be read. Save the page with the receipt on its own.";
    case "pdf_locked":
      return "That PDF is password-protected. Save a copy without a password and try again.";
  }
}
