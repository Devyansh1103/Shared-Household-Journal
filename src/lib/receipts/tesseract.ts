// The OCR engine: Tesseract.js, in the person's browser (roadmap Phase 19,
// D15 as amended). The image never leaves the device for reading; the worker,
// the engine and the English model come from this site (VENDOR). Import only
// from client components.

import { VENDOR } from "./assets";
import { OcrError, type OcrEngine } from "./ocr";

export const tesseractEngine: OcrEngine = {
  name: "tesseract",
  async recognize(image, { signal, onProgress }) {
    let Tesseract: typeof import("tesseract.js");
    try {
      Tesseract = await import("tesseract.js");
    } catch {
      throw new OcrError("unavailable");
    }
    if (signal.aborted) throw new OcrError("cancelled");

    let worker: Awaited<ReturnType<typeof Tesseract.createWorker>>;
    try {
      worker = await Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
        workerPath: VENDOR.tesseractWorker,
        corePath: VENDOR.tesseractCore,
        langPath: VENDOR.tesseractLang,
        workerBlobURL: false,
        gzip: true,
        logger: (message) => {
          if (message.status === "recognizing text")
            onProgress?.(message.progress);
        },
      });
    } catch {
      throw new OcrError("unavailable");
    }

    const stop = () => void worker.terminate().catch(() => {});
    signal.addEventListener("abort", stop, { once: true });
    try {
      await worker.setParameters({
        // A single column of text in different sizes: a receipt.
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_COLUMN,
        preserve_interword_spaces: "1",
      });
      const { data } = await worker.recognize(image, {}, { blocks: true });
      const lines = (data.blocks ?? []).flatMap((block) =>
        block.paragraphs.flatMap((paragraph) =>
          paragraph.lines.map((line) => ({
            text: line.text.replace(/\s+$/, ""),
            confidence: Number.isFinite(line.confidence)
              ? line.confidence
              : null,
          })),
        ),
      );
      return { engine: "tesseract", lines };
    } finally {
      signal.removeEventListener("abort", stop);
      await worker.terminate().catch(() => {});
    }
  },
};
