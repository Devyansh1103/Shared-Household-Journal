// Settlements in a real browser (roadmap Phase 10, D9): recording a payment
// from a balance (prefilled, partial, reviewed), D9's warning when it's more
// than what's owed, voiding, the history, validation, what a non-member sees,
// and a small phone. Settlements can't be deleted, so each test gets its own
// household. Throwaway users and households are removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  adminClient,
  signedInClient,
  type TypedClient,
} from "../supabase/tests/support/local-supabase";

const admin = adminClient();
const password = `e2e-${randomUUID()}`;
/** Signed amounts in sentences carry an invisible WORD JOINER after the sign. */
const WJ = "⁠";
const NOTICE = "Recorded in the app — no money is moved.";

type User = { id: string; email: string; client: TypedClient };
let olive: User, pat: User, quin: User, outsider: User;

async function createUser(name: string): Promise<User> {
  const email = `e2e-${randomUUID().slice(0, 8)}-${name.toLowerCase()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
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

/** Next.js keeps the previous page mounted but hidden: match visible text only. */
function visible(page: Page, text: string | RegExp) {
  return page.getByText(text, { exact: true }).locator("visible=true");
}

function heading(page: Page, name: string, level = 1) {
  return page.getByRole("heading", { level, name }).locator("visible=true");
}

/** A visible form control by its label. */
function field(page: Page, label: string) {
  return page.getByLabel(label, { exact: true }).locator("visible=true");
}

function section(page: Page, name: string) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name }) })
    .locator("visible=true");
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/**
 * A household of Olive (owner), Pat and Quin with the brief's example: ₹900
 * paid by Olive, split three ways. Pat and Quin each owe Olive ₹300.
 */
async function newHome(): Promise<{ id: string; name: string }> {
  const name = `E2E Settle ${randomUUID().slice(0, 6)}`;
  const created = await olive.client.rpc("create_household", {
    household_name: name,
    currency: "INR",
    time_zone: "Asia/Kolkata",
  });
  if (created.error) throw created.error;
  const id = created.data;

  const bytes = randomBytes(32);
  const invite = await olive.client.from("invitations").insert({
    household_id: id,
    token_hash: createHash("sha256").update(bytes).digest("hex"),
  });
  if (invite.error) throw invite.error;
  for (const member of [pat, quin]) {
    const joined = await member.client.rpc("accept_invite", {
      token: bytes.toString("base64url"),
    });
    if (joined.error) throw joined.error;
  }

  const expense = await olive.client.rpc("create_expense", {
    target_household_id: id,
    title: "Electricity",
    amount: 90000,
    expense_category: "utilities",
    spent_on: "2026-11-10",
    payer_id: olive.id,
    method: "equal",
    shares: [olive, pat, quin].map((u) => ({
      user_id: u.id,
      share_minor: 30000,
      percentage_bp: null,
    })),
  });
  if (expense.error) throw expense.error;
  return { id, name };
}

test.beforeAll(async () => {
  olive = await createUser("Olive");
  pat = await createUser("Pat");
  quin = await createUser("Quin");
  outsider = await createUser("Xena");
});

test.afterAll(async () => {
  const ids = [olive, pat, quin, outsider].filter(Boolean).map((u) => u.id);
  // Deleting a household cascades to its settlements (D14).
  await admin.from("households").delete().in("created_by", ids);
  await admin.from("profiles").delete().in("id", ids);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
});

test("record a partial payment from a balance, check it, and see balances follow", async ({
  page,
}) => {
  const home = await newHome();
  await signIn(page, pat);
  await page.goto(`/households/${home.id}/balances`);
  await expect(heading(page, "Balances")).toBeVisible();

  const pairs = section(page, "Who owes whom");
  await expect(pairs.getByText(NOTICE)).toBeVisible();
  // Only Pat's own pair offers it (D9): not Quin's.
  await expect(
    pairs.getByRole("link", { name: "Record a payment from Quin" }),
  ).toHaveCount(0);
  await pairs.getByRole("link", { name: "Record a payment to Olive" }).click();
  await expect(heading(page, "Record a payment")).toBeVisible();

  // Prefilled from the balance: the whole of what's owed, which can change.
  await expect(field(page, "Who was the payment with?")).toHaveValue(olive.id);
  await expect(field(page, "You paid Olive")).toBeChecked();
  await expect(field(page, "Amount (INR)")).toHaveValue("300.00");
  await expect(visible(page, "Right now you owe Olive ₹300.00.")).toBeVisible();
  await expect(
    visible(page, "After this, you and Olive will be settled up."),
  ).toBeVisible();
  await expect(visible(page, NOTICE)).toBeVisible();

  // A partial payment (D9).
  await field(page, "Amount (INR)").fill("100");
  await expect(
    visible(page, "After this, you'll owe Olive ₹200.00."),
  ).toBeVisible();
  await field(page, "Note (optional)").fill("Cash");
  await page.getByRole("button", { name: "Review payment" }).click();

  // The check before recording: who, whom, how much, the currency and when.
  await expect(heading(page, "Check the payment", 2)).toBeVisible();
  await expect(visible(page, "You paid Olive ₹100.00.")).toBeVisible();
  const review = section(page, "Check the payment");
  await expect(review.locator("dl")).toContainText("Paid byYou");
  await expect(review.locator("dl")).toContainText("Paid toOlive");
  await expect(review.locator("dl")).toContainText("₹100.00 (INR)");
  await expect(review.locator("dl")).toContainText("Cash");
  await expect(review).toContainText(
    `Recording it updates the balances everyone in ${home.name} sees. The app can't check that the money was actually paid.`,
  );
  await noHorizontalOverflow(page);

  await page.getByRole("button", { name: "Record payment" }).click();
  await page.waitForURL(/\/settlements\/[0-9a-f-]{36}\?recorded=1/);
  await expect(heading(page, "Payment from you to Olive")).toBeVisible();
  await expect(visible(page, "Recorded")).toBeVisible();
  await expect(
    visible(page, "You recorded a payment of ₹100.00 to Olive."),
  ).toBeVisible();
  await expect(page.getByText(/The payment is recorded/)).toBeVisible();

  // Balances now include it: ₹300 owed, ₹100 paid back.
  await page.goto(`/households/${home.id}/balances`);
  await expect(visible(page, "You owe ₹200.00.")).toBeVisible();
  await expect(
    visible(
      page,
      `₹0.00 paid − ₹300.00 share + ₹100.00 paid back = -${WJ}₹200.00.`,
    ),
  ).toBeVisible();
  await expect(
    section(page, "Who owes whom").getByRole("link", { name: /You owe Olive/ }),
  ).toContainText("₹200.00");
  await noHorizontalOverflow(page);
});

test("D9's warning when it's more than what's owed, then voiding it", async ({
  page,
}) => {
  const home = await newHome();
  await signIn(page, pat);
  await page.goto(`/households/${home.id}/settlements/new?with=${olive.id}`);
  await expect(heading(page, "Record a payment")).toBeVisible();

  await field(page, "Amount (INR)").fill("500");
  await expect(
    visible(
      page,
      "That's more than you owe Olive right now (₹300.00). After this, Olive will owe you ₹200.00.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review payment" }).click();
  await expect(heading(page, "Check the payment", 2)).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "That's more than you owe" }),
  ).toBeVisible();
  // Warned, but allowed (D9, D8).
  await page.getByRole("button", { name: "Record anyway" }).click();
  await page.waitForURL(/\?recorded=1/);
  await expect(heading(page, "Payment from you to Olive")).toBeVisible();
  const detail = page.url().split("?")[0];

  await page.goto(`/households/${home.id}/balances`);
  await expect(visible(page, "You should get back ₹200.00.")).toBeVisible();

  // Void it: it stays listed, stops counting, and the balances go back.
  await page.goto(detail);
  await expect(heading(page, "Payment from you to Olive")).toBeVisible();
  await page.getByRole("button", { name: "Void payment" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Void this ₹500.00 payment?");
  await dialog.getByRole("button", { name: "Void payment" }).click();
  await expect(
    page.getByText(
      "The payment is voided. It no longer counts towards balances.",
    ),
  ).toBeVisible();
  await expect(visible(page, "Voided")).toBeVisible();
  await expect(page.getByText(/^Voided by you on/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Void payment" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: "Record it again" }),
  ).toBeVisible();

  await page.goto(`/households/${home.id}/balances`);
  await expect(visible(page, "You owe ₹300.00.")).toBeVisible();

  await page.goto(`/households/${home.id}/settlements`);
  await expect(heading(page, "Settlements")).toBeVisible();
  const voided = section(page, "Voided payments");
  await expect(
    voided.getByRole("link", { name: /Payment from you to Olive/ }),
  ).toContainText("₹500.00");
  await expect(
    visible(
      page,
      "No recorded payments count right now. Voided ones are listed below.",
    ),
  ).toBeVisible();
});

test("validation, an empty history, and changing the details", async ({
  page,
}) => {
  const home = await newHome();
  await signIn(page, pat);
  await page.goto(`/households/${home.id}/settlements`);
  await expect(heading(page, "Settlements")).toBeVisible();
  await expect(visible(page, "No payments recorded yet")).toBeVisible();
  await expect(visible(page, NOTICE)).toBeVisible();
  await page.getByRole("link", { name: "Record a payment" }).first().click();
  await expect(heading(page, "Record a payment")).toBeVisible();

  // Two other people, so nobody is chosen for you.
  await field(page, "Amount (INR)").fill("");
  await page.getByRole("button", { name: "Review payment" }).click();
  await expect(visible(page, "Choose who the payment was with.")).toBeVisible();
  await expect(visible(page, "Enter an amount.")).toBeVisible();

  await field(page, "Who was the payment with?").selectOption(quin.id);
  await expect(
    visible(page, "Right now you and Quin are settled up."),
  ).toBeVisible();
  await field(page, "Quin paid you").check();
  for (const [amount, message] of [
    ["0", "Enter an amount greater than zero."],
    ["12.345", "Use at most 2 decimal places."],
    ["12,50", "Use a dot for decimals and commas only between thousands."],
  ]) {
    await field(page, "Amount (INR)").fill(amount);
    await page.getByRole("button", { name: "Review payment" }).click();
    await expect(visible(page, message)).toBeVisible();
  }

  await field(page, "Amount (INR)").fill("10");
  await page.getByRole("button", { name: "Review payment" }).click();
  await expect(visible(page, "Quin paid you ₹10.00.")).toBeVisible();
  await page.getByRole("button", { name: "Change details" }).click();
  // Back to the form with everything kept.
  await expect(field(page, "Amount (INR)")).toHaveValue("10");
  await expect(field(page, "Quin paid you")).toBeChecked();
});

test("a non-member sees no settlements or figures", async ({ page }) => {
  const home = await newHome();
  const recorded = await pat.client.rpc("record_settlement", {
    target_household_id: home.id,
    payer_id: pat.id,
    recipient_id: olive.id,
    amount: 30000,
    paid_on: "2026-11-12",
    memo: "Private note",
  });
  if (recorded.error) throw recorded.error;

  await signIn(page, outsider);
  await page.goto(`/households/${home.id}/settlements`);
  await expect(visible(page, /couldn't find that household/)).toBeVisible();
  expect(await page.content()).not.toContain("Private note");

  await page.goto(`/households/${home.id}/settlements/${recorded.data}`);
  await expect(visible(page, /couldn't find/)).toBeVisible();
  expect(await page.content()).not.toContain("₹300.00");
  expect(await page.content()).not.toContain("Private note");
});

test("the history fits a 360px phone", async ({ page }) => {
  const home = await newHome();
  const recorded = await olive.client.rpc("record_settlement", {
    target_household_id: home.id,
    payer_id: quin.id,
    recipient_id: olive.id,
    amount: 30000,
    paid_on: "2026-11-12",
    memo: "A long note that has to wrap or be cut off on a small screen without pushing the page sideways",
  });
  if (recorded.error) throw recorded.error;

  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page, pat);
  await page.goto(`/households/${home.id}/settlements`);
  await expect(heading(page, "Settlements")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Payment from Quin to Olive/ }),
  ).toContainText("₹300.00");
  await noHorizontalOverflow(page);
  // Settlements belong to Balances in the bottom bar.
  const bar = page.locator('nav[aria-label="Main"]').locator("visible=true");
  await expect(bar.getByRole("link", { name: "Balances" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByRole("link", { name: /Payment from Quin to Olive/ }).click();
  await expect(heading(page, "Payment from Quin to Olive")).toBeVisible();
  await expect(
    visible(page, "Olive recorded a payment of ₹300.00 from Quin."),
  ).toBeVisible();
  // Pat isn't in it and isn't the owner: no void (D9).
  await expect(page.getByRole("button", { name: "Void payment" })).toHaveCount(
    0,
  );
  await noHorizontalOverflow(page);
});
