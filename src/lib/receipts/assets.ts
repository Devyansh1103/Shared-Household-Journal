// Where the browser loads the OCR and PDF files from: this site only. They're
// copied out of node_modules by scripts/copy-vendor-assets.mjs before every
// build and dev server (public/vendor is not committed), so nothing is ever
// fetched from a CDN, and their versions are exactly the installed packages'.

export const VENDOR = {
  tesseractWorker: "/vendor/tesseract/worker.min.js",
  /** A directory: Tesseract.js picks the core build the browser supports. */
  tesseractCore: "/vendor/tesseract/core",
  /** A directory holding eng.traineddata.gz (4.0.0 "best int" model). */
  tesseractLang: "/vendor/tesseract/lang",
  pdfWorker: "/vendor/pdfjs/pdf.worker.min.mjs",
  pdfStandardFonts: "/vendor/pdfjs/standard_fonts/",
  pdfWasm: "/vendor/pdfjs/wasm/",
} as const;
