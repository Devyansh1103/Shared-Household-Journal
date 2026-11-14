// Copies the browser files for receipt reading (roadmap Phase 19) from
// node_modules into public/vendor, so the app serves them itself and never
// loads code or models from a CDN (src/lib/receipts/assets.ts). Runs before
// `npm run dev` and `npm run build`. public/vendor isn't committed: its
// contents always match the installed, locked package versions.

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modules = path.join(root, "node_modules");
const out = path.join(root, "public", "vendor");

/** [from (in node_modules), to (in public/vendor)] */
const files = [
  ["tesseract.js/dist/worker.min.js", "tesseract/worker.min.js"],
  // Tesseract.js picks one of these by what the browser supports.
  [
    "tesseract.js-core/tesseract-core-lstm.wasm.js",
    "tesseract/core/tesseract-core-lstm.wasm.js",
  ],
  [
    "tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
    "tesseract/core/tesseract-core-simd-lstm.wasm.js",
  ],
  [
    "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
    "tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js",
  ],
  [
    "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
    "tesseract/lang/eng.traineddata.gz",
  ],
  ["pdfjs-dist/build/pdf.worker.min.mjs", "pdfjs/pdf.worker.min.mjs"],
  // Image decoders the PDF worker may need. Not quickjs: PDF scripts never run.
  ["pdfjs-dist/wasm/jbig2.wasm", "pdfjs/wasm/jbig2.wasm"],
  ["pdfjs-dist/wasm/openjpeg.wasm", "pdfjs/wasm/openjpeg.wasm"],
  ["pdfjs-dist/wasm/qcms_bg.wasm", "pdfjs/wasm/qcms_bg.wasm"],
];
const directories = [["pdfjs-dist/standard_fonts", "pdfjs/standard_fonts"]];

rmSync(out, { recursive: true, force: true });
for (const [from, to] of [...files, ...directories]) {
  const source = path.join(modules, from);
  if (!existsSync(source)) {
    console.error(`copy-vendor-assets: ${from} is missing. Run npm install.`);
    process.exit(1);
  }
  const target = path.join(out, to);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}
console.log(
  `copy-vendor-assets: ${files.length + directories.length} items in public/vendor`,
);
