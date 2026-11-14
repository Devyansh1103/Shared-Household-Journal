import { describe, expect, it } from "vitest";
import {
  OcrError,
  ocrErrorMessage,
  runOcr,
  type OcrEngine,
  type OcrErrorKind,
} from "./ocr";

// Fake engines stand in for a real one: no OCR runs in these tests, and a
// paid or network provider would never be called by them either.

const image = new Blob(["fake image"], { type: "image/jpeg" });

function engine(recognize: OcrEngine["recognize"]): OcrEngine {
  return { name: "fake", recognize };
}

async function kindOf(
  promise: Promise<unknown>,
): Promise<OcrErrorKind | "resolved"> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    if (error instanceof OcrError) return error.kind;
    throw error;
  }
}

describe("runOcr", () => {
  it("returns the engine's lines when they're well formed, and passes progress on", async () => {
    const progress: number[] = [];
    const result = await runOcr(
      engine(async (_image, { onProgress }) => {
        onProgress?.(0.5);
        onProgress?.(1);
        return {
          engine: "fake",
          lines: [
            { text: "Total 450.00", confidence: 91.5 },
            { text: "Shop", confidence: null },
          ],
        };
      }),
      image,
      { onProgress: (fraction) => progress.push(fraction) },
    );
    expect(result.lines).toEqual([
      { text: "Total 450.00", confidence: 91.5 },
      { text: "Shop", confidence: null },
    ]);
    expect(progress).toEqual([0.5, 1]);
  });

  it("refuses a malformed result rather than guessing at it", async () => {
    for (const bad of [
      null,
      "Total 450.00",
      { engine: "fake" },
      { engine: "fake", lines: [{ text: "x", confidence: 150 }] },
      { engine: "fake", lines: [{ text: 42, confidence: 90 }] },
      { engine: "", lines: [] },
    ]) {
      expect(
        await kindOf(
          runOcr(
            engine(async () => bad),
            image,
          ),
        ),
      ).toBe("malformed");
    }
  });

  it("gives up after the time limit, and tells the engine to stop", async () => {
    let stopped = false;
    const slow = engine(
      (_image, { signal }) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            stopped = true;
          });
          setTimeout(() => resolve({ engine: "fake", lines: [] }), 5_000);
        }),
    );
    expect(await kindOf(runOcr(slow, image, { timeoutMs: 20 }))).toBe(
      "timeout",
    );
    expect(stopped).toBe(true);
  });

  it("stops when the person cancels, even before it starts", async () => {
    const controller = new AbortController();
    const pending = runOcr(
      engine(() => new Promise(() => {})),
      image,
      { signal: controller.signal },
    );
    controller.abort();
    expect(await kindOf(pending)).toBe("cancelled");

    const already = new AbortController();
    already.abort();
    expect(
      await kindOf(
        runOcr(
          engine(async () => ({ engine: "fake", lines: [] })),
          image,
          { signal: already.signal },
        ),
      ),
    ).toBe("cancelled");
  });

  it("keeps an engine's own kind of failure (unavailable, rate limited), and calls the rest failed", async () => {
    for (const kind of ["unavailable", "rate_limited"] as const) {
      expect(
        await kindOf(
          runOcr(
            engine(async () => {
              throw new OcrError(kind);
            }),
            image,
          ),
        ),
      ).toBe(kind);
    }
    expect(
      await kindOf(
        runOcr(
          engine(async () => {
            throw new TypeError("network down");
          }),
          image,
        ),
      ),
    ).toBe("failed");
  });

  it("never retries by itself", async () => {
    let calls = 0;
    await kindOf(
      runOcr(
        engine(async () => {
          calls++;
          throw new OcrError("rate_limited");
        }),
        image,
      ),
    );
    expect(calls).toBe(1);
  });

  it("says what to do next for every failure, leaving manual entry open", () => {
    for (const kind of [
      "timeout",
      "unavailable",
      "rate_limited",
      "cancelled",
      "malformed",
      "failed",
    ] as const) {
      expect(ocrErrorMessage(kind)).toMatch(/yourself/);
    }
  });
});
