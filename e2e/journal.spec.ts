// The household journal in a real browser (roadmap Phase 13): the story of a
// household told newest first under "Today", in the app's words, with D9's
// wording and notice for payments and no payment notes; filters in the URL;
// links to the expense; older activity in pages without repeats; empty,
// invalid and non-member states; keyboard use; and a 360px phone. Each test
// gets its own household; throwaway users and households are removed
// afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  adminClient,
  signedInClient,
  type TypedClient,
} from "../supabase/tests/support/local-supabase";

const admin = adminClient();
const password = `e2e-${randomUUID()}`;
const NOTICE = "Recorded in the app — no money is moved.";
const NOTE = "Private note about the electricity";

type User = { id: string; email: string; client: TypedClient };
let olive: User, pat: User, outsider: User;

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

function heading(page: Page, name: string | RegExp, level = 1) {
  return page.getByRole("heading", { level, name }).locator("visible=true");
}

/** The entries on the page, in order: each one's title. */
async function titles(page: Page): Promise<string[]> {
  const items = page.locator("main ol > li").locator("visible=true");
  return items.evaluateAll((lis) =>
    lis.map((li) => li.querySelector("p")?.textContent ?? ""),
  );
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function newHome(owner: User, label: string) {
  const name = `E2E ${label} ${randomUUID().slice(0, 6)}`;
  const created = await owner.client.rpc("create_household", {
    household_name: name,
    currency: "INR",
    time_zone: "Asia/Kolkata",
  });
  if (created.error) throw created.error;
  return { id: created.data, name };
}

async function join(owner: User, householdId: string, member: User) {
  const bytes = randomBytes(32);
  const invite = await owner.client.from("invitations").insert({
    household_id: householdId,
    token_hash: createHash("sha256").update(bytes).digest("hex"),
  });
  if (invite.error) throw invite.error;
  const joined = await member.client.rpc("accept_invite", {
    token: bytes.toString("base64url"),
  });
  if (joined.error) throw joined.error;
}

function shares(total: number, people: User[]) {
  const each = Math.floor(total / people.length);
  return people.map((u, i) => ({
    user_id: u.id,
    share_minor: i === 0 ? total - each * (people.length - 1) : each,
    percentage_bp: null,
  }));
}

/**
 * Olive's household with Pat: Olive adds Electricity (₹900, split equally),
 * Pat records paying ₹300 of it with a note, then Olive corrects the amount
 * to ₹1,200.
 */
async function storyHome() {
  const home = await newHome(olive, "Journal");
  await join(olive, home.id, pat);
  const expense = await olive.client.rpc("create_expense", {
    target_household_id: home.id,
    title: "Electricity",
    amount: 90000,
    expense_category: "utilities",
    spent_on: "2026-11-10",
    payer_id: olive.id,
    method: "equal",
    shares: shares(90000, [olive, pat]),
  });
  if (expense.error) throw expense.error;
  const paid = await pat.client.rpc("record_settlement", {
    target_household_id: home.id,
    payer_id: pat.id,
    recipient_id: olive.id,
    amount: 30000,
    paid_on: "2026-11-12",
    memo: NOTE,
  });
  if (paid.error) throw paid.error;
  const edit = await olive.client.rpc("update_expense", {
    target_expense_id: expense.data,
    title: "Electricity",
    amount: 120000,
    expense_category: "utilities",
    spent_on: "2026-11-10",
    payer_id: olive.id,
    method: "equal",
    shares: shares(120000, [olive, pat]),
  });
  if (edit.error) throw edit.error;
  return { ...home, expenseId: expense.data };
}

test.beforeAll(async () => {
  olive = await createUser("Olive");
  pat = await createUser("Pat");
  outsider = await createUser("Xena");
});

test.afterAll(async () => {
  const ids = [olive, pat, outsider].filter(Boolean).map((u) => u.id);
  // Deleting a household cascades to everything in it, its journal too (D14).
  await admin.from("households").delete().in("created_by", ids);
  await admin.from("profiles").delete().in("id", ids);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
});

test("the journal tells the household's story, newest first, and links to it", async ({
  page,
}) => {
  const home = await storyHome();
  await signIn(page, pat);
  await page.goto(`/households/${home.id}`);
  await page.getByRole("link", { name: "View journal" }).click();
  await expect(heading(page, "Household journal")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/households/${home.id}/journal$`));
  await expect(
    page
      .getByText(`What's happened in ${home.name}, newest first`)
      .locator("visible=true"),
  ).toBeVisible();

  await expect(heading(page, "Today", 2)).toBeVisible();
  expect(await titles(page)).toEqual([
    "Olive edited an expense",
    "You recorded a payment of ₹300.00 to Olive",
    "Olive added an expense",
    "You joined the household",
    "Olive created an invite link",
    `Olive created the household “${home.name}”`,
  ]);

  const items = page.locator("main ol > li").locator("visible=true");
  // D6: what the edit changed, old and new.
  await expect(items.nth(0)).toContainText("Electricity — ₹1,200.00");
  // The arrow is hidden from screen readers, which hear "to" instead.
  await expect(items.nth(0)).toContainText("Amount: ₹900.00 →to ₹1,200.00");
  await expect(items.nth(0).locator("time")).toHaveAttribute(
    "datetime",
    /^\d{4}-\d{2}-\d{2}T/,
  );
  // D9's wording and notice; the note itself stays on the payment's page.
  await expect(items.nth(1)).toContainText("Paid on 12 Nov 2026");
  await expect(visible(page, NOTICE)).toBeVisible();
  expect(await page.content()).not.toContain(NOTE);
  await expect(items.nth(2)).toContainText("Electricity — ₹900.00");
  await expect(items.nth(2)).toContainText("Paid by Olive");
  await expect(items.nth(3)).toContainText("Invited by Olive");
  // Each entry says its kind in words, not only with an icon's colour.
  await expect(items.nth(0)).toContainText("Expense");
  await expect(items.nth(1)).toContainText("Payment");
  await expect(items.nth(3)).toContainText("Household");

  // The journal belongs to Household in the main navigation.
  const nav = page.locator('nav[aria-label="Main"]').locator("visible=true");
  await expect(nav.getByRole("link", { name: "Household" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Open the expense from its entry.
  await page
    .getByRole("link", { name: "View expense: Electricity" })
    .first()
    .click();
  await expect(heading(page, "Electricity")).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/households/${home.id}/expenses/${home.expenseId}$`),
  );
});

test("filters keep their place in the URL and show only their kind of activity", async ({
  page,
}) => {
  const home = await storyHome();
  await signIn(page, pat);
  await page.goto(`/households/${home.id}/journal`);
  await expect(heading(page, "Household journal")).toBeVisible();
  const filters = page.getByRole("navigation", { name: "Show in the journal" });
  await expect(
    filters.getByRole("link", { name: "All activity" }),
  ).toHaveAttribute("aria-current", "page");

  // By keyboard: focus a filter and press Enter.
  await filters.getByRole("link", { name: "Expenses" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\?show=expenses$/);
  await expect(filters.getByRole("link", { name: "Expenses" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect
    .poll(() => titles(page))
    .toEqual(["Olive edited an expense", "Olive added an expense"]);
  await expect(visible(page, NOTICE)).toHaveCount(0);
  await expect(visible(page, "That's all the expense activity.")).toBeVisible();

  await filters.getByRole("link", { name: "Settlements" }).click();
  await page.waitForURL(/\?show=settlements$/);
  await expect
    .poll(() => titles(page))
    .toEqual(["You recorded a payment of ₹300.00 to Olive"]);
  await expect(visible(page, NOTICE)).toBeVisible();
  await page.getByRole("link", { name: /^View payment: / }).click();
  await expect(heading(page, "Payment from you to Olive")).toBeVisible();
  await page.goBack();

  await page.goto(`/households/${home.id}/journal?show=household`);
  await expect
    .poll(() => titles(page))
    .toEqual([
      "You joined the household",
      "Olive created an invite link",
      `Olive created the household “${home.name}”`,
    ]);
  await page.getByRole("link", { name: "See members" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/households/${home.id}#members$`));
  await expect(heading(page, "Members", 2)).toBeInViewport();
});

test("older activity loads in pages, without repeats", async ({ page }) => {
  const home = await newHome(olive, "Pages");
  // 30 expenses: with the household's creation, 31 entries.
  for (let i = 1; i <= 30; i++) {
    const { error } = await olive.client.rpc("create_expense", {
      target_household_id: home.id,
      title: `Item ${String(i).padStart(2, "0")}`,
      amount: 1000 + i,
      expense_category: "other",
      spent_on: "2026-11-10",
      payer_id: olive.id,
      method: "equal",
      shares: shares(1000 + i, [olive]),
    });
    if (error) throw error;
  }
  await signIn(page, olive);
  await page.goto(`/households/${home.id}/journal`);
  await expect(heading(page, "Household journal")).toBeVisible();

  const items = page.locator("main ol > li").locator("visible=true");
  await expect(items).toHaveCount(25);
  const summaries = () =>
    items.evaluateAll((lis) =>
      lis.map((li) => li.querySelectorAll("p")[1]?.textContent ?? ""),
    );
  const first = await summaries();
  expect(first[0]).toContain("Item 30");
  expect(first[24]).toContain("Item 06");

  await page.getByRole("link", { name: "Show older activity" }).click();
  await page.waitForURL(/\?before=\d+\.[0-9a-f-]{36}$/);
  await expect(
    page
      .getByText(/^You're looking at older activity\./)
      .locator("visible=true"),
  ).toBeVisible();
  await expect(items).toHaveCount(6);
  const second = await summaries();
  expect(second.slice(0, 5).map((s) => s.slice(0, 7))).toEqual([
    "Item 05",
    "Item 04",
    "Item 03",
    "Item 02",
    "Item 01",
  ]);
  expect(await titles(page)).toContain(
    `You created the household “${home.name}”`,
  );
  expect(first.filter((s) => second.includes(s))).toEqual([]);
  await expect(visible(page, "That's the start of the journal.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Show older activity" }),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "Back to the latest" }).first().click();
  await page.waitForURL(new RegExp(`/households/${home.id}/journal$`));
  await expect(items).toHaveCount(25);
});

test("empty filters, invalid links and non-members", async ({ page }) => {
  const home = await newHome(olive, "Quiet");
  await signIn(page, olive);

  await page.goto(`/households/${home.id}/journal?show=settlements`);
  await expect(visible(page, "No payments recorded yet")).toBeVisible();
  await page.getByRole("link", { name: "Show all activity" }).click();
  await page.waitForURL(new RegExp(`/households/${home.id}/journal$`));
  await expect
    .poll(() => titles(page))
    .toEqual([`You created the household “${home.name}”`]);

  await page.goto(`/households/${home.id}/journal?show=budgets`);
  await expect(
    page.getByText(
      /That link asks for a part of the journal that doesn't exist/,
    ),
  ).toBeVisible();
  await page.goto(`/households/${home.id}/journal?before=yesterday`);
  await expect(
    page.getByText(/That link to older activity isn't valid/),
  ).toBeVisible();
  await page.getByRole("link", { name: "Show the latest activity" }).click();
  await page.waitForURL(new RegExp(`/households/${home.id}/journal$`));
  await expect(heading(page, "Today", 2)).toBeVisible();

  // Someone else sees the household's 404, and nothing from its journal.
  await page.context().clearCookies();
  await signIn(page, outsider);
  await page.goto(`/households/${home.id}/journal`);
  await expect(visible(page, /couldn't find that household/)).toBeVisible();
  expect(await page.content()).not.toContain(home.name);
});

test("the journal fits a 360px phone", async ({ page }) => {
  const home = await storyHome();
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page, pat);
  await page.goto(`/households/${home.id}/journal`);
  await expect(heading(page, "Household journal")).toBeVisible();
  await expect(
    visible(page, "You recorded a payment of ₹300.00 to Olive"),
  ).toBeVisible();
  await noHorizontalOverflow(page);
  // The bottom bar keeps five tabs; Household is the journal's.
  const bar = page.locator('nav[aria-label="Main"]').locator("visible=true");
  await expect(bar.getByRole("link")).toHaveCount(5);
  await expect(bar.getByRole("link", { name: "Household" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
