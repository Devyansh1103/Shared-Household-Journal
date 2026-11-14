# Receipts and on-device reading (roadmap Phase 19)

Scan a receipt to fill in an expense: choose or photograph it, the app reads it **on the person's
own device**, and they check every detail in the usual expense form before anything is saved. The
receipt stays attached to the expense for the household to see. Reading is a suggestion; the
expense is the person's.

Decisions (owner, 2026-11-14):

- **D15 amended:** OCR is approved **on the device only** (Tesseract.js in the browser). Still no
  household data goes to any external OCR or AI service; manual entry always stays available.
- **D31 (receipts):** every active member can view a receipt attached to a household expense;
  the expense's creator, its payer or the owner (D6) can attach, replace or remove it; removing a
  receipt never changes the expense. An upload not yet on an expense is visible only to its
  uploader and is cleared after 24 hours. Line items read from a receipt are shown for reference
  and **not stored**. JPEG, PNG, WebP and single-page PDF receipts are accepted.

## The workflow

| Stage      | What happens                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Choose  | `/households/[id]/expenses/scan` (from Expenses or the household page, "Scan a receipt"). Choose a file, drop it, or (on phones) take a photo. The file's first bytes are checked at once: a preview only for a real image, and a wrong type or size said straight away.                                                                                                                                              |
| 2. Prepare | In the browser ([src/lib/receipts/prepare.ts](../src/lib/receipts/prepare.ts)): a PDF must have one page and is drawn to an image with pdf.js; photos are turned upright; the longest side is scaled to at most 3,000 px; everything is re-encoded as a JPEG on white, under 4 MiB. Re-encoding drops the photo's metadata (location, device).                                                                        |
| 3. Upload  | `POST /api/households/[id]/receipts` with one request key per chosen file (a double click or a retry stores it once). The server checks it again from its bytes (below), starts a receipt (`create_receipt`), stores the file in the private bucket as the signed-in person, and confirms it (`mark_receipt_uploaded`). The address then names the receipt, so a reload comes back to it.                             |
| 4. Read    | On the device ([src/lib/receipts/tesseract.ts](../src/lib/receipts/tesseract.ts)), with a progress bar and "Stop and fill in myself", from a **lossless copy** of the prepared image (the JPEG is for keeping: in a check, JPEG artefacts turned two GST lines into unreadable text that the lossless copy reads correctly). The lines read go through [src/lib/receipts/extract.ts](../src/lib/receipts/extract.ts). |
| 5. Review  | The receipt image, "Read from the receipt" (each value; hard-to-read ones marked "Hard to read" or "Check" in words), warnings, and the items (editable, reference only). Beside it, the **usual expense form**, pre-filled with the shop's name, the total and the date only. Category, payer and split are always chosen by the person. "Ignore what was read and fill in myself" clears the suggestions.           |
| 6. Confirm | "Create expense" sends the form to `createExpenseFromReceipt`, which runs every check `createExpense` does, then `create_expense_with_receipt` records the expense (through `create_expense`: membership, D6, the split, the journal, notifications) and attaches the receipt **in one transaction**.                                                                                                                 |
| 7. Done    | The expense page: "The expense is saved, with its receipt attached." and a Receipt section.                                                                                                                                                                                                                                                                                                                           |

If reading fails, is stopped, times out (2 minutes) or the browser can't run it, the same form is
there to fill in by hand, with "Read the receipt again". Reading is never repeated automatically.
"Discard receipt" deletes the upload without creating anything.

On an expense's page, D6 people can **add**, **replace** or **remove** a receipt. Everyone who can
see the expense can view it full size or download it. The page notes who attached it and when, or
who removed the last one.

## Files

| Rule                         | Value                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chosen file (browser)        | JPEG, PNG, WebP or a single-page PDF, up to 10 MB, recognised by its first bytes, not its name or type                                                                                                                                |
| Stored file (server, bucket) | JPEG, PNG or WebP (the app always sends JPEG), at most 4 MiB, each side 200–8,000 px                                                                                                                                                  |
| Server checks                | Signature (magic bytes), complete file (PNG `IEND`, JPEG end marker, WebP RIFF size), dimensions from the header. Images are never decoded on the server, so a crafted file can't make it do much work; nothing uploaded is ever run. |
| Refused                      | Other types (GIF, SVG, HEIC as is, text…), empty, cut-off or malformed files, multi-page or password-protected PDFs, images too small to read                                                                                         |

The limits live in [src/lib/receipts/limits.ts](../src/lib/receipts/limits.ts); the 4 MiB cap keeps
uploads under Vercel's request limit (about 4.5 MB). Messages for every refusal are in
[src/lib/receipts/image.ts](../src/lib/receipts/image.ts).

## Storage

Supabase Storage (already part of the stack, unused before this phase): one **private** bucket,
`receipts`, created by the migration, accepting only `image/jpeg`, `image/png` and `image/webp` up
to 4 MiB. A file's path is `<household id>/<receipt id>.<ext>`, fixed by a check on the row, so it
can't be chosen.

- **Every file operation runs as the signed-in person**, never with a service key. Storage policies
  on `storage.objects` allow a file to be stored, read or deleted only when its `receipts` row says
  so (`private.receipt_file_allowed`): stored once by its uploader while pending, never
  overwritten; read by the household's active members once attached (or by the uploader while
  waiting); deleted by the uploader while unused, by the person who removed it, or by the owner
  as the last member (deleting the household).
- **Images reach the browser only through `GET /api/receipts/[id]`**, which checks the session and
  the row on every request and streams the file: no storage path, public URL or signed URL is ever
  handed out, so access ends the moment membership does. `Cache-Control: private, no-store`; its
  own `Content-Security-Policy: … sandbox`; `nosniff`; `?download=1` saves it.
- **Files are deleted through the Storage API**, never with SQL (Storage blocks that). The file is
  deleted before its row whenever both go, so no unreachable file is left behind.
- **No scheduler** (ADR-010): uploads unused for 24 hours, and files whose deletion failed, are
  cleared the next time their uploader (or remover) uploads a receipt
  (`my_receipt_files_to_clear`, `forget_my_stale_receipts`).
- **Deleting a household** deletes its receipt files first (`household_receipt_files`, the owner
  as the last member), then the household; the rows cascade.

The table, functions and policies: [database.md](database.md#receipts-roadmap-phase-19).

## Reading (OCR)

| Option considered                         | Chosen? | Why                                                                                                                                          |
| ----------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Tesseract.js in the browser               | **Yes** | Keeps D15's rule (no data to an OCR service); free; no secret key; works offline once loaded. Moderate accuracy on receipts.                 |
| Tesseract on the server                   | No      | Heavy for serverless functions, and the image would still be processed off the device for no gain.                                           |
| Cloud receipt models / AI vision services | No      | Better structured results, but would send receipts to a third party, need a key, a privacy policy update and paid usage. Not approved (D15). |

- **Engine:** `tesseract.js` 7.0.0 with `tesseract.js-core` 7.0.0 (WebAssembly, LSTM only) and
  the English 4.0.0 "best int" model (`@tesseract.js-data/eng` 1.0.0). Page segmentation: a single
  column of text. PDFs: `pdfjs-dist` 6.4.299, fonts drawn as shapes, no XFA.
- **Everything loads from this site:** `scripts/copy-vendor-assets.mjs` copies the worker, the
  three engine builds (the browser picks one), the model and the PDF worker, fonts and image
  decoders from `node_modules` into `public/vendor` before every `dev` and `build` (it's not
  committed). The first scan downloads about 6.6 MB (a 3.7 MB engine, the 2.8 MB model, the
  worker); the model is then cached by the browser.
- **The CSP:** pages keep their policy (no WebAssembly, no eval). Only responses under
  `/vendor/` allow `'wasm-unsafe-eval'`, since a worker runs under its own script's policy
  ([next.config.ts](../next.config.ts)). Zod is told not to probe for `eval` in the browser.
- **The boundary** ([src/lib/receipts/ocr.ts](../src/lib/receipts/ocr.ts)): an `OcrEngine` returns
  lines with confidences, checked by `runOcr` (2-minute limit, cancellation, a malformed result
  refused); failures come back as `timeout`, `unavailable`, `rate_limited`, `cancelled`,
  `malformed` or `failed`, each with a message that leaves manual entry open. Another engine can
  be added without touching the review. No raw OCR text is stored or logged.

### What is read

From the lines, by [src/lib/receipts/extract.ts](../src/lib/receipts/extract.ts) (pure,
unit-tested): the shop's name (the first plain line near the top), date (day-first for `en-IN`,
D18; "ambiguous" when both orders work), time, total (the strongest wording: "grand total", "net
payable", "amount payable"… beats "total"; never "amount paid"), subtotal, each tax line (CGST,
SGST, IGST, VAT, cess; a tax summary only if there are none), discounts, charges (service charge,
delivery, round-off, signed), the currency shown (₹/Rs/INR, €, £, US$, and known ISO codes;
a bare `$` is ignored as ambiguous), the payment method (cash, card, UPI, other, only when one is
clear), the bill number, and items (a name and a price with its decimals, with a quantity and
unit price when printed). **Anything not clearly there stays empty.**

Money is read into integer minor units at the household currency's decimal places, with string
and BigInt arithmetic, never floating point. Indian grouping (`1,25,000.00`), `Rs.450`, decimal
commas (`12,50`) and bracketed negatives are understood; `1.250` (thousands or 1.25?), more
decimals than the currency has, and long digit runs (phone, GST numbers) are not read as money.

### Confidence and checks

- Tesseract reports a confidence per line (0–100). Below 70 a value is marked **"Hard to read"**;
  with no confidence it's marked **"Check"**. Nothing invents a percentage, and every value is
  presented as read, not checked.
- Warnings (never refusals): nothing read; no total, date or shop name; an ambiguous, future or
  over-a-year-old date (a future date isn't filled in); another currency (D1: no conversion, so
  enter the amount in the household's currency) or several; **subtotal + tax + charges −
  discounts ≠ total** (with "probably rounding" under one unit of the currency, and no warning
  when prices include tax); items that don't add up to the subtotal; hard-to-read fields by name;
  and hard-to-read **lines that became nothing**, so a tax or an item that couldn't be read isn't
  missing silently.
- The split engine and money rules are untouched: the confirmed form goes through the same
  validation and database checks as any expense.

## Duplicate prevention

- Uploading: one request key per chosen file (`create_receipt` returns the same receipt).
- Confirming: the expense form's request key (`create_expense`), and a receipt already attached
  returns its expense (`create_expense_with_receipt`); the submit button is disabled while
  pending. Two receipts with the same shop, date and total are **not** treated as duplicates:
  they can be real, separate purchases.

## Privacy and retention

- The image is read on the device. It's sent only to this app's server and stored in the
  household's private bucket; nothing goes to an OCR or AI service (D15).
- Re-encoding in the browser drops photo metadata (location, camera). The original file name
  isn't stored.
- Receipts are kept until removed, or until the household is deleted (O2); unused uploads are
  cleared after 24 hours (on the uploader's next upload). A removed receipt's file is deleted; its
  row stays as the record of who removed it and when.
- An account deletion (D14) keeps receipts on expenses (they're the household's records). Unused
  uploads of a deleted account aren't cleared by themselves; see
  [operations.md](operations.md#deleting-an-account-d14).
- Receipt files are **not** in database backups; see [backup-recovery.md](backup-recovery.md).
- Not claimed: virus scanning (images are never run or decoded on the server, and the browser
  decodes only the person's own file), or encryption beyond what the hosting provider applies.

## Limits, costs and scale

- **No per-scan cost and no rate limit to hit:** reading runs on the person's device. The costs are
  Supabase Storage (receipts are at most 4 MiB, usually far less) and Vercel bandwidth for the
  one-off OCR download per browser and for viewing receipts. Watch both in their dashboards; no
  usage figures exist yet.
- At most **10 receipts waiting for review** per person and household (`HJ037`), so uploads can't
  pile up.
- Reading takes seconds on a laptop and longer on older phones, and uses the device's memory;
  the first scan also downloads the engine.
- No new environment variables. Nothing to configure for OCR.

## Tests

- Unit: [image.test.ts](../src/lib/receipts/image.test.ts) (signatures, sizes, cut-off files),
  [extract.test.ts](../src/lib/receipts/extract.test.ts) (amounts, dates, a supermarket and a
  restaurant receipt, reconciliation, rounding, discounts, currencies, confidence, missing and
  partial values), [ocr.test.ts](../src/lib/receipts/ocr.test.ts) (mocked engines: success,
  malformed, timeout, cancelled, unavailable, rate-limited, failed, no retries),
  [review.test.ts](../src/lib/receipts/review.test.ts). No real or paid OCR in unit tests.
- Database: [receipts.test.ts](../supabase/tests/receipts.test.ts) (the bucket, Storage policies,
  every function, who sees what, confirming, failures, D6, discarding, clearing, deleting the
  household, direct writes), and receipts in the catalog and attack matrix of
  [authorization.test.ts](../supabase/tests/authorization.test.ts).
- Browser: [e2e/receipts.spec.ts](../e2e/receipts.spec.ts) runs the **real** engine on a receipt
  the test renders (a photo and a one-page PDF), checks the pre-filled values, creates the expense,
  and covers viewing, attaching, removing, discarding, refused files and the CSP. Those test
  receipts are clean printed text; this is no measure of accuracy on real receipts.

## Known limitations

- Accuracy on real receipts (thermal paper, creases, shadows, handwriting) hasn't been measured,
  and will often need corrections. English only; amounts in Hindi or other scripts aren't read.
- HEIC photos are accepted only where the browser converts them (iPhones usually do when taking a
  photo through the page).
- Multi-page PDFs are refused; only the first and only page is read.
- Receipts aren't journalled or notified; attaching one doesn't change the expense, so its
  journal and notifications are as before. The removal record is on the expense's page.
- One receipt per expense.
- Reading again after a reload (`?receipt=` in the address) has only the stored JPEG to read,
  which reads less well than the lossless copy used straight after uploading.
- Category suggestions are deliberately absent (D15; Phase 20 territory).
