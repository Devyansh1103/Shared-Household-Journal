// Balances in a real browser: the overview, one person's explanation and the
// expenses behind it, how balances follow a deleted expense, what a non-member
// sees, and the five-tab bottom bar on a small phone. Throwaway users and
// households are created for each run and removed afterwards.

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

type User = { id: string; email: string; client: TypedClient };
let olive: User, pat: User, quin: User, outsider: User;
let householdId: string;
let expenseId: string;
let title: string;

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

/**
 * Next.js keeps the previous page mounted but hidden: match visible text only.
 * Whole-text matches, since some sentences repeat inside longer ones.
 */
function visible(page: Page, text: string | RegExp) {
  return page.getByText(text, { exact: true }).locator("visible=true");
}

function heading(page: Page, name: string, level = 1) {
  return page.getByRole("heading", { level, name }).locator("visible=true");
}

/** A page section (h2) by its heading. */
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

test.beforeAll(async () => {
  olive = await createUser("Olive");
  pat = await createUser("Pat");
  quin = await createUser("Quin");
  outsider = await createUser("Xena");

  const created = await olive.client.rpc("create_household", {
    household_name: `E2E Balances ${randomUUID().slice(0, 6)}`,
    currency: "INR",
    time_zone: "Asia/Kolkata",
  });
  if (created.error) throw created.error;
  householdId = created.data;

  const bytes = randomBytes(32);
  const invite = await olive.client.from("invitations").insert({
    household_id: householdId,
    token_hash: createHash("sha256").update(bytes).digest("hex"),
  });
  if (invite.error) throw invite.error;
  for (const member of [pat, quin]) {
    const joined = await member.client.rpc("accept_invite", {
      token: bytes.toString("base64url"),
    });
    if (joined.error) throw joined.error;
  }
});

test.beforeEach(async () => {
  // Each test starts from one ₹900 expense paid by Olive, split three ways.
  await admin.from("expenses").delete().eq("household_id", householdId);
  title = `Electricity ${randomUUID().slice(0, 6)}`;
  const { data, error } = await olive.client.rpc("create_expense", {
    target_household_id: householdId,
    title,
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
  if (error) throw error;
  expenseId = data;
});

test.afterAll(async () => {
  const ids = [olive, pat, quin, outsider].filter(Boolean).map((u) => u.id);
  await admin.from("households").delete().in("created_by", ids);
  await admin.from("profiles").delete().in("id", ids);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
});

test("the overview says who owes whom, with the figures behind it", async ({
  page,
}) => {
  await signIn(page, pat);
  await page.goto(`/households/${householdId}`);
  await page
    .getByRole("link", { name: "Balances", exact: true })
    .locator("visible=true")
    .first()
    .click();
  await expect(heading(page, "Balances")).toBeVisible();
  await noHorizontalOverflow(page);

  // Your balance, in words as well as figures.
  await expect(visible(page, "You owe ₹300.00.")).toBeVisible();
  await expect(
    visible(page, `₹0.00 paid − ₹300.00 share = -${WJ}₹300.00.`),
  ).toBeVisible();

  const pairs = section(page, "Who owes whom");
  await expect(
    pairs.getByRole("link", { name: /You owe Olive/ }),
  ).toContainText("₹300.00");
  await expect(
    pairs.getByRole("link", { name: /Quin owes Olive/ }),
  ).toContainText("₹300.00");

  const everyone = section(page, "Everyone's balance");
  const oliveRow = everyone.getByRole("link", { name: /^Olive/ });
  await expect(oliveRow).toContainText("+₹600.00");
  await expect(oliveRow).toContainText("Owed");
  const patRow = everyone.getByRole("link", { name: /Pat \(you\)/ });
  await expect(patRow).toContainText("-₹300.00");
  await expect(patRow).toContainText("Owes");

  const totals = section(page, "How the numbers add up");
  await expect(totals).toContainText("₹900.00");
  await expect(totals).toContainText("₹0.00");

  // A pair opens the right person's page with that pair expanded.
  await pairs.getByRole("link", { name: /You owe Olive/ }).click();
  await expect(heading(page, "Your balance")).toBeVisible();
  const withOlive = page.locator(`[id="with-${olive.id}"]`);
  await expect(withOlive).toHaveAttribute("open", "");
  await expect(withOlive).toContainText(
    "Olive paid ₹900.00; your share is ₹300.00.",
  );
  await expect(
    visible(
      page,
      `₹0.00 paid − ₹300.00 share = -${WJ}₹300.00, so you owe ₹300.00.`,
    ),
  ).toBeVisible();

  const behind = section(page, "Expenses behind your balance");
  await expect(behind).toContainText(
    `It comes to -${WJ}₹300.00, your balance.`,
  );
  await noHorizontalOverflow(page);

  // Each line links to its expense.
  await behind.getByRole("link", { name: title }).click();
  await expect(heading(page, title)).toBeVisible();
});

test("someone else's balance is explained from their side", async ({
  page,
}) => {
  await signIn(page, pat);
  await page.goto(`/households/${householdId}/balances/${olive.id}`);
  await expect(heading(page, "Olive's balance")).toBeVisible();
  await expect(visible(page, "Olive should get back ₹600.00.")).toBeVisible();
  await expect(
    visible(page, "Olive paid ₹900.00 for 1 expense."),
  ).toBeVisible();
  await expect(
    visible(
      page,
      `₹900.00 paid − ₹300.00 share = +${WJ}₹600.00, so Olive should get back ₹600.00.`,
    ),
  ).toBeVisible();

  const between = section(page, "Between Olive and others");
  // Not expanded until asked; then it lists the expense behind the pair.
  const withPat = page.locator(`[id="with-${pat.id}"]`);
  await expect(withPat).not.toHaveAttribute("open", "");
  await withPat.locator("summary").click();
  await expect(withPat).toContainText(
    "Olive paid ₹900.00; your share is ₹300.00.",
  );
  await expect(between.getByText("You owe Olive")).toBeVisible();
});

test("a deleted expense stops counting", async ({ page }) => {
  await olive.client.rpc("delete_expense", { target_expense_id: expenseId });
  await signIn(page, pat);
  await page.goto(`/households/${householdId}/balances`);
  await expect(heading(page, "Balances")).toBeVisible();
  await expect(visible(page, "No balances yet")).toBeVisible();
  await expect(page.getByText("₹300.00")).toHaveCount(0);
});

test("a non-member sees no balances or figures", async ({ page }) => {
  await signIn(page, outsider);
  await page.goto(`/households/${householdId}/balances`);
  await expect(visible(page, /couldn't find that household/)).toBeVisible();
  expect(await page.content()).not.toContain("₹300.00");

  await page.goto(`/households/${householdId}/balances/${olive.id}`);
  await expect(visible(page, /couldn't find/)).toBeVisible();
  expect(await page.content()).not.toContain("₹600.00");
  expect(await page.content()).not.toContain(title);
});

test("the bottom bar fits five labelled tabs on a 360px phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page, pat);
  await page.goto(`/households/${householdId}/balances`);
  await expect(heading(page, "Balances")).toBeVisible();

  const bar = page.locator('nav[aria-label="Main"]').locator("visible=true");
  await expect(bar.getByRole("link")).toHaveCount(5);
  await expect(bar.getByRole("link", { name: "Balances" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const cutOff = await bar
    .locator("a span")
    .evaluateAll((spans) =>
      spans
        .filter((s) => s.scrollWidth > s.clientWidth)
        .map((s) => s.textContent),
    );
  expect(cutOff).toEqual([]);
  await noHorizontalOverflow(page);
});
