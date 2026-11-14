// Gets a chosen receipt ready in the browser (roadmap Phase 19): checks what
// it really is, turns a one-page PDF into an image (pdf.js, from this site),
// turns photos upright, shrinks them so text stays readable but the upload
// stays under the server's limit, and re-encodes as JPEG on a white
// background. Re-encoding also drops the photo's metadata (location, device).
// Import only from client components.

import { VENDOR } from "./assets";
import { sniffType, type ImageProblem } from "./image";
import {
  RECEIPT_MIN_SIDE,
  RECEIPT_PICK_MAX_BYTES,
  RECEIPT_TARGET_LONG_SIDE,
  RECEIPT_UPLOAD_MAX_BYTES,
} from "./limits";

export type PrepareProblem = ImageProblem | "pdf_pages" | "pdf_locked";

export class PrepareError extends Error {
  constructor(readonly problem: PrepareProblem) {
    super(`Receipt ${problem}`);
    this.name = "PrepareError";
  }
}

export type PreparedReceipt = {
  /** A JPEG under RECEIPT_UPLOAD_MAX_BYTES: what's uploaded and kept. */
  blob: Blob;
  /**
   * The same picture, lossless (PNG), for reading. JPEG artefacts around
   * small print ("%", decimals) visibly hurt OCR, so reading never uses the
   * JPEG when the original pixels are at hand. Never uploaded.
   */
  ocrImage: Blob;
  width: number;
  height: number;
  fromPdf: boolean;
};

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new PrepareError("corrupt");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  return { canvas, context };
}

async function drawImage(file: File): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PrepareError("corrupt");
  }
  try {
    if (bitmap.width < RECEIPT_MIN_SIDE || bitmap.height < RECEIPT_MIN_SIDE) {
      throw new PrepareError("too_small");
    }
    const scale = Math.min(
      1,
      RECEIPT_TARGET_LONG_SIDE / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const { canvas, context } = canvasOf(width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

async function renderPdf(file: File): Promise<HTMLCanvasElement> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = VENDOR.pdfWorker;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    // No XFA forms and no fonts installed from the file: glyphs are drawn as
    // shapes. pdf.js never runs a PDF's own scripts unless asked to.
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: VENDOR.pdfStandardFonts,
    wasmUrl: VENDOR.pdfWasm,
  });
  let document;
  try {
    document = await task.promise;
  } catch (error) {
    await task.destroy();
    const name = error instanceof Error ? error.name : "";
    throw new PrepareError(
      name === "PasswordException" ? "pdf_locked" : "corrupt",
    );
  }
  try {
    if (document.numPages !== 1) throw new PrepareError("pdf_pages");
    const page = await document.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    // PDF points are small (72 per inch): scale up to a readable size.
    const scale = Math.min(
      6,
      RECEIPT_TARGET_LONG_SIDE / Math.max(natural.width, natural.height),
    );
    const viewport = page.getViewport({ scale });
    const { canvas, context } = canvasOf(
      Math.round(viewport.width),
      Math.round(viewport.height),
    );
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return canvas;
  } catch (error) {
    if (error instanceof PrepareError) throw error;
    throw new PrepareError("corrupt");
  } finally {
    await task.destroy();
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new PrepareError("corrupt"))),
      "image/jpeg",
      quality,
    ),
  );
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new PrepareError("corrupt"))),
      "image/png",
    ),
  );
}

async function encode(
  source: HTMLCanvasElement,
): Promise<{ blob: Blob; canvas: HTMLCanvasElement }> {
  let canvas = source;
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const quality of [0.9, 0.8, 0.7]) {
      const blob = await toJpeg(canvas, quality);
      if (blob.size <= RECEIPT_UPLOAD_MAX_BYTES) return { blob, canvas };
    }
    // Still too large: three quarters the size, and try again.
    const width = Math.round(canvas.width * 0.75);
    const height = Math.round(canvas.height * 0.75);
    if (width < RECEIPT_MIN_SIDE || height < RECEIPT_MIN_SIDE) break;
    const next = canvasOf(width, height);
    next.context.drawImage(canvas, 0, 0, width, height);
    canvas = next.canvas;
  }
  throw new PrepareError("too_large");
}

/** Checks and prepares a chosen file; throws a PrepareError saying why not. */
export async function prepareReceipt(file: File): Promise<PreparedReceipt> {
  if (file.size === 0) throw new PrepareError("empty");
  if (file.size > RECEIPT_PICK_MAX_BYTES) throw new PrepareError("too_large");
  const type = sniffType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (type === null) throw new PrepareError("unsupported_type");

  const fromPdf = type === "application/pdf";
  const drawn = fromPdf ? await renderPdf(file) : await drawImage(file);
  // Lossless first, from the drawn pixels, before any shrinking for size.
  const ocrImage = await toPng(drawn);
  const { blob, canvas } = await encode(drawn);
  return {
    blob,
    ocrImage,
    width: canvas.width,
    height: canvas.height,
    fromPdf,
  };
}
