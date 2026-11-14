// Receipts in a real browser (roadmap Phase 19, D31): scanning a receipt
// (a photo and a one-page PDF), reading it on the device with the real OCR
// engine, checking the pre-filled expense form and creating the expense;
// what members, outsiders and signed-out visitors can see; attaching,
// removing and discarding; refused files; and the browser reporting no
// Content Security Policy violation (the OCR worker compiles WebAssembly).
//
// The receipts are made by the test: simple printed text rendered in the
// browser, so the OCR has a fair chance. This checks that the pipeline works
// end to end; it isn't a measure of accuracy on real, crumpled receipts.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  adminClient,
  signedInClient,
  type TypedClient,
} from "../supabase/tests/support/local-supabase";

const admin = adminClient();
const password = `e2e-${randomUUID()}`;
const TZ = "Asia/Kolkata";

type User = { id: string; email: string; client: TypedClient };
let olive: User, pat: User, xena: User;
let H: string;
const created: string[] = [];

async function createUser(name: string): Promise<User> {
  const email = `e2e-${randomUUID().slice(0, 8)}-${name.toLowerCase()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  created.push(data.user.id);
  return {
    id: data.user.id,
    email,
    client: await signedInClient(email, password),
  };
}

async function signIn(page: Page, user: User) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/home");
}

function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text()))
      violations.push(message.text());
  });
  return violations;
}

function visible(page: Page, text: string | RegExp) {
  return page.getByText(text, { exact: true }).locator("visible=true");
}

function field(page: Page, label: string) {
  return page.getByLabel(label, { exact: true }).locator("visible=true");
}

const RECEIPT_LINES = [
  "FRESH MART",
  "Date 13 Nov 2026",
  "",
  "Milk            90.00",
  "Bread           40.00",
  "",
  "TOTAL          130.00",
  "Paid by CASH",
];

function receiptHtml(lines: string[], extraPages = 0) {
  const block = `<pre style="font: 30px/1.6 'Courier New', monospace; color: #000; margin: 0; padding: 40px">${lines.join("\n")}</pre>`;
  const breaks = Array.from(
    { length: extraPages },
    () => `<div style="break-before: page">${block}</div>`,
  ).join("");
  return `<!doctype html><html><body style="margin: 0; background: #fff">${block}${breaks}</body></html>`;
}

/** A receipt photo, rendered by the browser (PNG). */
async function receiptPng(
  browser: Browser,
  lines = RECEIPT_LINES,
): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.setContent(receiptHtml(lines));
  const png = await page.screenshot({ fullPage: true });
  await page.close();
  return png;
}

/** A receipt PDF, printed by the browser. */
async function receiptPdf(browser: Browser, extraPages = 0): Promise<Buffer> {
  const page = await browser.newPage();
  await page.setContent(receiptHtml(RECEIPT_LINES, extraPages));
  const pdf = await page.pdf({
    width: "170mm",
    height: "200mm",
    printBackground: true,
  });
  await page.close();
  return pdf;
}

async function chooseFile(
  page: Page,
  name: string,
  mimeType: string,
  buffer: Buffer,
) {
  await page
    .locator('input[type=file][aria-label="Receipt file"]')
    .setInputFiles({ name, mimeType, buffer });
}

async function receiptsOf(householdId: string) {
  const { data } = await admin
    .from("receipts")
    .select("id, status, expense_id, uploaded_by")
    .eq("household_id", householdId);
  return data ?? [];
}

test.beforeAll(async () => {
  olive = await createUser("Olive");
  pat = await createUser("Pat");
  xena = await createUser("Xena");
  const home = await olive.client.rpc("create_household", {
    household_name: `Receipts ${randomUUID().slice(0, 6)}`,
    currency: "INR",
    time_zone: TZ,
  });
  if (home.error) throw home.error;
  H = home.data;
  const bytes = randomBytes(32);
  const invite = await olive.client.from("invitations").insert({
    household_id: H,
    token_hash: createHash("sha256").update(bytes).digest("hex"),
  });
  if (invite.error) throw invite.error;
  const joined = await pat.client.rpc("accept_invite", {
    token: bytes.toString("base64url"),
  });
  if (joined.error) throw joined.error;
});

test.afterAll(async () => {
  const { data } = await admin
    .from("receipts")
    .select("storage_path, household_id")
    .in("uploaded_by", created);
  const paths = (data ?? []).map((r) => r.storage_path);
  if (paths.length) await admin.storage.from("receipts").remove(paths);
  await admin.from("households").delete().in("created_by", created);
  await admin.from("profiles").delete().in("id", created);
  for (const id of created) await admin.auth.admin.deleteUser(id);
});

test("scan a photo: read on the device, check the form, create the expense with its receipt", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const csp = watchCsp(page);
  const before = await receiptsOf(H);
  await signIn(page, olive);
  await page.goto(`/households/${H}/expenses`);
  await page.getByRole("link", { name: "Scan a receipt" }).first().click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Scan a receipt" }),
  ).toBeVisible();

  await chooseFile(
    page,
    "fresh-mart.png",
    "image/png",
    await receiptPng(browser),
  );
  await expect(visible(page, "fresh-mart.png")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Preview of the chosen receipt" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Read receipt" }).click();

  // Real OCR, in the browser: the first run loads the engine and the model.
  await expect(
    page.getByRole("heading", { name: "Check and save the expense" }),
  ).toBeVisible({
    timeout: 120_000,
  });
  await expect(
    page.getByRole("heading", { name: "Read from the receipt" }),
  ).toBeVisible();
  await expect(field(page, "Amount (INR)")).toHaveValue("130.00");
  await expect(field(page, "What was it for?")).toHaveValue(/FRESH MART/i);
  await expect(field(page, "Date")).toHaveValue("2026-11-13");
  // Nothing is decided for the person: the category is theirs to choose.
  await expect(field(page, "Category")).toHaveValue("");
  // The receipt is stored, waiting, and no expense exists yet.
  const waiting = (await receiptsOf(H)).filter(
    (r) => !before.some((b) => b.id === r.id),
  );
  expect(waiting).toEqual([
    expect.objectContaining({
      status: "uploaded",
      expense_id: null,
      uploaded_by: olive.id,
    }),
  ]);
  // The address names it, so a reload comes back to it.
  expect(page.url()).toContain(`receipt=${waiting[0].id}`);

  // The person corrects what they like, then confirms.
  await field(page, "What was it for?").fill("Fresh Mart groceries");
  await field(page, "Category").selectOption("groceries");
  await page.getByRole("button", { name: "Create expense" }).dblclick();
  await page.waitForURL(/\/expenses\/[0-9a-f-]{36}\?created=1&receipt=1/);
  await expect(
    visible(page, "The expense is saved, with its receipt attached."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Fresh Mart groceries" }),
  ).toBeVisible();
  const image = page.getByRole("img", {
    name: "Receipt for Fresh Mart groceries",
  });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  // One expense, one attached receipt, despite the double click.
  const expenseId = /expenses\/([0-9a-f-]{36})/.exec(page.url())![1];
  const after = (await receiptsOf(H)).filter((r) => r.id === waiting[0].id);
  expect(after).toEqual([
    expect.objectContaining({ status: "attached", expense_id: expenseId }),
  ]);
  const { count } = await admin
    .from("expenses")
    .select("id", { count: "exact", head: true })
    .eq("household_id", H)
    .eq("description", "Fresh Mart groceries");
  expect(count).toBe(1);
  const { data: expense } = await admin
    .from("expenses")
    .select("amount_minor, category")
    .eq("id", expenseId)
    .single();
  expect(expense).toEqual({ amount_minor: 13000, category: "groceries" });
  expect(csp).toEqual([]);
});

test("a one-page PDF is read too; longer PDFs and wrong files are refused before upload", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const csp = watchCsp(page);
  await signIn(page, pat);
  await page.goto(`/households/${H}/expenses/scan`);
  // A full page load: let React attach its handlers before choosing a file.
  await page.waitForLoadState("networkidle");

  const before = (await receiptsOf(H)).length;
  // Said as soon as it's chosen, from the file's bytes (not its name or type).
  await chooseFile(
    page,
    "notes.jpg",
    "image/jpeg",
    Buffer.from("this is a text file, not a photo"),
  );
  await expect(
    page.getByRole("img", { name: "Preview of the chosen receipt" }),
  ).toHaveCount(0);
  await expect(
    visible(
      page,
      "That isn't a receipt we can read. Choose a JPEG, PNG or WebP photo, or a PDF.",
    ),
  ).toBeVisible();

  await chooseFile(
    page,
    "huge.jpg",
    "image/jpeg",
    Buffer.alloc(11 * 1024 * 1024, 0xff),
  );
  await expect(
    visible(
      page,
      "That file is too large. Choose a receipt photo or PDF under 10 MB.",
    ),
  ).toBeVisible();

  await chooseFile(
    page,
    "two-pages.pdf",
    "application/pdf",
    await receiptPdf(browser, 1),
  );
  await page.getByRole("button", { name: "Read receipt" }).click();
  await expect(
    visible(
      page,
      "Only single-page PDF receipts can be read. Save the page with the receipt on its own.",
    ),
  ).toBeVisible();
  expect((await receiptsOf(H)).length).toBe(before);

  await chooseFile(
    page,
    "fresh-mart.pdf",
    "application/pdf",
    await receiptPdf(browser),
  );
  await expect(visible(page, /PDF \(the first page is read\)/)).toBeVisible();
  await page.getByRole("button", { name: "Read receipt" }).click();
  await expect(
    page.getByRole("heading", { name: "Check and save the expense" }),
  ).toBeVisible({
    timeout: 120_000,
  });
  await expect(field(page, "Amount (INR)")).toHaveValue("130.00");

  // Changed their mind: discard it. No expense, no receipt left.
  await page.getByRole("button", { name: "Discard receipt" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Discard receipt" })
    .click();
  // Deleting the file and the row: a few round trips, slow on a busy test machine.
  await expect(visible(page, "The receipt is discarded.")).toBeVisible({
    timeout: 15_000,
  });
  expect((await receiptsOf(H)).length).toBe(before);
  expect(csp).toEqual([]);
});

test("members see a receipt, outsiders and signed-out visitors don't; it can be removed and added", async ({
  page,
  browser,
  playwright,
}) => {
  test.setTimeout(120_000);
  const csp = watchCsp(page);
  // An expense Olive added, with no receipt yet.
  const expenseId = (
    await olive.client.rpc("create_expense", {
      target_household_id: H,
      title: "Hardware store",
      amount: 52000,
      expense_category: "household_supplies",
      spent_on: "2026-11-12",
      payer_id: olive.id,
      method: "equal",
      shares: [olive, pat].map((u) => ({
        user_id: u.id,
        share_minor: 26000,
        percentage_bp: null,
      })),
    })
  ).data as string;

  await signIn(page, olive);
  await page.goto(`/households/${H}/expenses/${expenseId}`);
  await page.waitForLoadState("networkidle");
  await expect(visible(page, "No receipt is attached.")).toBeVisible();
  await page.getByRole("button", { name: "Add a receipt" }).click();
  await chooseFile(
    page,
    "hardware.png",
    "image/png",
    await receiptPng(browser, ["HARDWARE STORE", "TOTAL 520.00"]),
  );
  await page.getByRole("button", { name: "Attach receipt" }).click();
  await expect(visible(page, "The receipt is attached.")).toBeVisible({
    timeout: 30_000,
  });
  const image = page.getByRole("img", { name: "Receipt for Hardware store" });
  await expect(image).toBeVisible();
  const [receipt] = (await receiptsOf(H)).filter(
    (r) => r.expense_id === expenseId && r.status === "attached",
  );
  // Attaching reads nothing: the expense is as it was.
  const { data: unchanged } = await admin
    .from("expenses")
    .select("amount_minor, description")
    .eq("id", expenseId)
    .single();
  expect(unchanged).toEqual({
    amount_minor: 52000,
    description: "Hardware store",
  });

  // Pat, a member, sees it.
  const patPage = await (await browser.newContext()).newPage();
  await signIn(patPage, pat);
  await patPage.goto(`/households/${H}/expenses/${expenseId}`);
  await expect(
    patPage.getByRole("img", { name: "Receipt for Hardware store" }),
  ).toBeVisible();
  const asPat = await patPage.request.get(`/api/receipts/${receipt.id}`);
  expect(asPat.status()).toBe(200);
  expect(asPat.headers()["content-type"]).toBe("image/jpeg");
  expect(asPat.headers()["cache-control"]).toContain("no-store");
  const download = await patPage.request.get(
    `/api/receipts/${receipt.id}?download=1`,
  );
  expect(download.headers()["content-disposition"]).toBe(
    'attachment; filename="receipt.jpg"',
  );
  // Pat didn't add or pay it: no remove button.
  await expect(
    patPage.getByRole("button", { name: "Remove receipt" }),
  ).toHaveCount(0);
  await patPage.context().close();

  // Xena, from another household, gets nothing; nor does someone signed out.
  const xenaPage = await (await browser.newContext()).newPage();
  await signIn(xenaPage, xena);
  expect(
    (await xenaPage.request.get(`/api/receipts/${receipt.id}`)).status(),
  ).toBe(404);
  await xenaPage.goto(`/households/${H}/expenses/${expenseId}`);
  await expect(visible(xenaPage, /^We couldn't find that/)).toBeVisible();
  // Nor can Xena upload into Olive's household.
  const intrusion = await xenaPage.evaluate(async (householdId) => {
    const body = new FormData();
    body.append(
      "file",
      new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }),
      "x.jpg",
    );
    body.append("requestKey", crypto.randomUUID());
    return (
      await fetch(`/api/households/${householdId}/receipts`, {
        method: "POST",
        body,
      })
    ).status;
  }, H);
  expect([404, 422]).toContain(intrusion);
  await xenaPage.context().close();

  const signedOut = await playwright.request.newContext({
    baseURL: "http://localhost:3100",
  });
  expect((await signedOut.get(`/api/receipts/${receipt.id}`)).status()).toBe(
    401,
  );
  // No Origin header: refused before anything else.
  expect(
    (
      await signedOut.post(`/api/households/${H}/receipts`, {
        multipart: { requestKey: randomUUID() },
      })
    ).status(),
  ).toBe(403);
  await signedOut.dispose();

  // Olive removes it: the expense stays exactly as it was.
  await page.getByRole("button", { name: "Remove receipt" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove receipt" })
    .click();
  await expect(
    visible(page, "The receipt is removed. The expense hasn't changed."),
  ).toBeVisible();
  await expect(
    visible(page, /^No receipt\. Olive removed one on/),
  ).toBeVisible();
  const { data: still } = await admin
    .from("expenses")
    .select("amount_minor, description, deleted_at")
    .eq("id", expenseId)
    .single();
  expect(still).toEqual({
    amount_minor: 52000,
    description: "Hardware store",
    deleted_at: null,
  });
  const { data: storedFile } = await admin
    .from("receipts")
    .select("status")
    .eq("id", receipt.id)
    .single();
  expect(storedFile).toEqual({ status: "removed" });
  expect((await page.request.get(`/api/receipts/${receipt.id}`)).status()).toBe(
    404,
  );
  expect(csp).toEqual([]);
});

test("the scan page fits a phone, and the OCR worker alone may compile WebAssembly", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page, pat);
  await page.goto(`/households/${H}/expenses/scan`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Scan a receipt" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const pagePolicy = (await request.get("/sign-in")).headers()[
    "content-security-policy"
  ];
  expect(pagePolicy).not.toContain("wasm-unsafe-eval");
  const worker = await request.get("/vendor/tesseract/worker.min.js");
  expect(worker.status()).toBe(200);
  expect(worker.headers()["content-security-policy"]).toContain(
    "script-src 'self' 'wasm-unsafe-eval'",
  );
  // The model and engine come from this site, never a CDN.
  expect(
    (await request.get("/vendor/tesseract/lang/eng.traineddata.gz")).status(),
  ).toBe(200);
  expect((await request.get("/vendor/pdfjs/pdf.worker.min.mjs")).status()).toBe(
    200,
  );
});
