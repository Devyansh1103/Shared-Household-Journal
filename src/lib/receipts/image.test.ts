import { describe, expect, it } from "vitest";
import { imageProblemMessage, inspectReceiptImage, sniffType } from "./image";
import { RECEIPT_UPLOAD_MAX_BYTES } from "./limits";

// Minimal files with real headers: the inspector reads headers only.

function bytes(...parts: (number[] | string | Uint8Array)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string")
      for (const c of part) out.push(c.charCodeAt(0));
    else out.push(...part);
  }
  return Uint8Array.from(out);
}
const be32 = (n: number) => [
  (n >>> 24) & 255,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const le32 = (n: number) => [
  n & 255,
  (n >>> 8) & 255,
  (n >>> 16) & 255,
  (n >>> 24) & 255,
];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

const PNG_IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

function png(width: number, height: number, { end = true } = {}) {
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    be32(13),
    "IHDR",
    be32(width),
    be32(height),
    [8, 2, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 1, 0x49, 0x44, 0x41, 0x54, 0x00, 0, 0, 0, 0],
    end ? PNG_IEND : [],
  );
}

function jpeg(
  width: number,
  height: number,
  { end = true, frame = true } = {},
) {
  const app0 = [
    0xff,
    0xe0,
    ...be16(16),
    ..."JFIF\0".split("").map((c) => c.charCodeAt(0)),
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
  ];
  const sof = [
    0xff,
    0xc0,
    ...be16(17),
    8,
    ...be16(height),
    ...be16(width),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ];
  const sos = [
    0xff,
    0xda,
    ...be16(12),
    3,
    1,
    0,
    2,
    0x11,
    3,
    0x11,
    0,
    0x3f,
    0,
    0x12,
    0x34,
  ];
  return bytes(
    [0xff, 0xd8],
    app0,
    frame ? sof : [],
    sos,
    end ? [0xff, 0xd9] : [],
  );
}

function webpVp8x(width: number, height: number) {
  const body = bytes(
    "WEBP",
    "VP8X",
    le32(10),
    [0, 0, 0, 0],
    le24(width - 1),
    le24(height - 1),
  );
  return bytes("RIFF", le32(body.length), body);
}

function webpVp8(width: number, height: number) {
  const body = bytes(
    "WEBP",
    "VP8 ",
    le32(10),
    [0x10, 0x02, 0x00],
    [0x9d, 0x01, 0x2a],
    le16(width),
    le16(height),
  );
  return bytes("RIFF", le32(body.length), body);
}

function webpVp8l(width: number, height: number) {
  const w = width - 1;
  const h = height - 1;
  const bits = [
    w & 0xff,
    ((w >> 8) & 0x3f) | ((h & 0x03) << 6),
    (h >> 2) & 0xff,
    (h >> 10) & 0x0f,
  ];
  const body = bytes("WEBP", "VP8L", le32(10), [0x2f], bits, [0, 0, 0, 0, 0]);
  return bytes("RIFF", le32(body.length), body);
}

describe("sniffType", () => {
  it("knows each format by its signature, not its name", () => {
    expect(sniffType(jpeg(800, 1200))).toBe("image/jpeg");
    expect(sniffType(png(800, 1200))).toBe("image/png");
    expect(sniffType(webpVp8x(800, 1200))).toBe("image/webp");
    expect(sniffType(bytes("%PDF-1.7\n"))).toBe("application/pdf");
    expect(
      sniffType(bytes("hello, I'm a text file called receipt.jpg")),
    ).toBeNull();
    expect(sniffType(bytes("GIF89a"))).toBeNull();
    expect(sniffType(bytes("<svg xmlns"))).toBeNull();
    expect(sniffType(new Uint8Array())).toBeNull();
  });
});

describe("inspectReceiptImage", () => {
  it("accepts JPEG, PNG and WebP (all three WebP kinds) with their sizes", () => {
    expect(inspectReceiptImage(jpeg(1200, 3000))).toEqual({
      ok: true,
      image: { type: "image/jpeg", width: 1200, height: 3000 },
    });
    expect(inspectReceiptImage(png(800, 1600))).toEqual({
      ok: true,
      image: { type: "image/png", width: 800, height: 1600 },
    });
    for (const [file, name] of [
      [webpVp8x(1000, 2500), "VP8X"],
      [webpVp8(640, 960), "VP8"],
      [webpVp8l(300, 7000), "VP8L"],
    ] as const) {
      const result = inspectReceiptImage(file);
      expect(result.ok, name).toBe(true);
    }
    expect(inspectReceiptImage(webpVp8(640, 960))).toMatchObject({
      image: { width: 640, height: 960 },
    });
    expect(inspectReceiptImage(webpVp8l(300, 7000))).toMatchObject({
      image: { width: 300, height: 7000 },
    });
  });

  it("refuses other types, including PDF (the browser turns PDFs into images)", () => {
    expect(
      inspectReceiptImage(bytes("not an image, just text renamed to .png")),
    ).toEqual({
      ok: false,
      problem: "unsupported_type",
    });
    expect(inspectReceiptImage(bytes("%PDF-1.7\n%âãÏÓ\n"))).toEqual({
      ok: false,
      problem: "unsupported_type",
    });
  });

  it("refuses empty, oversized, cut-off and malformed files", () => {
    expect(inspectReceiptImage(new Uint8Array())).toEqual({
      ok: false,
      problem: "empty",
    });
    const big = new Uint8Array(RECEIPT_UPLOAD_MAX_BYTES + 1);
    big.set(jpeg(1000, 1000));
    expect(inspectReceiptImage(big)).toEqual({
      ok: false,
      problem: "too_large",
    });
    expect(inspectReceiptImage(png(800, 800, { end: false }))).toEqual({
      ok: false,
      problem: "corrupt",
    });
    expect(inspectReceiptImage(jpeg(800, 800, { end: false }))).toEqual({
      ok: false,
      problem: "corrupt",
    });
    expect(inspectReceiptImage(jpeg(800, 800, { frame: false }))).toEqual({
      ok: false,
      problem: "corrupt",
    });
    const cut = webpVp8x(800, 800).slice(0, 28);
    expect(inspectReceiptImage(cut)).toEqual({ ok: false, problem: "corrupt" });
    // A WebP whose declared size doesn't match the file.
    const lying = webpVp8x(800, 800);
    lying[4] = 99;
    expect(inspectReceiptImage(lying)).toEqual({
      ok: false,
      problem: "corrupt",
    });
    expect(inspectReceiptImage(png(0, 800))).toEqual({
      ok: false,
      problem: "corrupt",
    });
  });

  it("refuses images too small to read or too large to process", () => {
    expect(inspectReceiptImage(jpeg(150, 1000))).toEqual({
      ok: false,
      problem: "too_small",
    });
    expect(inspectReceiptImage(png(1000, 199))).toEqual({
      ok: false,
      problem: "too_small",
    });
    expect(inspectReceiptImage(jpeg(8001, 1000))).toEqual({
      ok: false,
      problem: "too_big",
    });
    expect(inspectReceiptImage(png(200, 8000))).toMatchObject({ ok: true });
  });

  it("explains every problem in plain words", () => {
    for (const problem of [
      "empty",
      "too_large",
      "unsupported_type",
      "corrupt",
      "too_small",
      "too_big",
      "pdf_pages",
      "pdf_locked",
    ] as const) {
      expect(imageProblemMessage(problem)).toMatch(/\.$/);
    }
  });
});
