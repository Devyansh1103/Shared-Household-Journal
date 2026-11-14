// The boundary around OCR (roadmap Phase 19). The app talks to an OcrEngine
// and gets back plain lines with confidences, checked here; it never sees an
// engine's own result format. Today the only engine is Tesseract.js running in
// the person's browser (D15 as amended: nothing is sent to an OCR service).
// Replacing it means writing another engine, not changing the review.

import { z } from "zod";
import type { OcrLine } from "./extract";

// This module runs in the browser, whose Content Security Policy allows no
// eval: tell Zod not to probe for it (its faster, eval-based parsers).
z.config({ jitless: true });

export type OcrErrorKind =
  | "timeout"
  | "unavailable"
  | "rate_limited"
  | "cancelled"
  | "malformed"
  | "failed";

export class OcrError extends Error {
  constructor(readonly kind: OcrErrorKind) {
    super(`OCR ${kind}`);
    this.name = "OcrError";
  }
}

export type OcrResult = { engine: string; lines: OcrLine[] };

export type OcrOptions = {
  signal: AbortSignal;
  /** 0 to 1, as the engine reports progress. */
  onProgress?: (fraction: number) => void;
};

export interface OcrEngine {
  readonly name: string;
  /** Reads the image; may throw an OcrError, or anything else. */
  recognize(image: Blob, options: OcrOptions): Promise<unknown>;
}

const resultSchema = z.object({
  engine: z.string().min(1).max(40),
  lines: z
    .array(
      z.object({
        text: z.string().max(1000),
        confidence: z.number().min(0).max(100).nullable(),
      }),
    )
    .max(3000),
});

/** How long to wait before giving up on one receipt. */
export const OCR_TIMEOUT_MS = 120_000;

/**
 * Runs an engine with a time limit and cancellation, and checks what it
 * returns. Every failure comes back as an OcrError with a kind, so the page
 * can say what happened. It never retries: the person decides.
 */
export async function runOcr(
  engine: OcrEngine,
  image: Blob,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    onProgress?: (fraction: number) => void;
  } = {},
): Promise<OcrResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? OCR_TIMEOUT_MS);
  const cancel = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });

  const stopped = new Promise<never>((_, reject) => {
    const fail = () => reject(new OcrError(timedOut ? "timeout" : "cancelled"));
    if (controller.signal.aborted) fail();
    else controller.signal.addEventListener("abort", fail, { once: true });
  });

  try {
    // Cancelled before it started: don't start.
    if (controller.signal.aborted) throw new OcrError("cancelled");
    const raw = await Promise.race([
      engine.recognize(image, {
        signal: controller.signal,
        onProgress: options.onProgress,
      }),
      stopped,
    ]);
    const parsed = resultSchema.safeParse(raw);
    if (!parsed.success) throw new OcrError("malformed");
    return parsed.data;
  } catch (error) {
    if (error instanceof OcrError) throw error;
    throw new OcrError("failed");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
    // A late rejection from `stopped` is expected once the race is decided.
    stopped.catch(() => {});
  }
}

/** What a person reads for each failure; each one leaves manual entry open. */
export function ocrErrorMessage(kind: OcrErrorKind): string {
  switch (kind) {
    case "timeout":
      return "Reading the receipt took too long. Try again, or fill in the details yourself.";
    case "unavailable":
      return "Receipt reading couldn't start in this browser. Fill in the details yourself, or try another browser.";
    case "rate_limited":
      return "Receipt reading is busy right now. Try again in a minute, or fill in the details yourself.";
    case "cancelled":
      return "Reading stopped. Read the receipt again, or fill in the details yourself.";
    case "malformed":
    case "failed":
      return "The receipt couldn't be read. Try a clearer photo, or fill in the details yourself.";
  }
}
