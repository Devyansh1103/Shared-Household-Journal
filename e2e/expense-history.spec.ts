// Expense history in a real browser (roadmap Phase 12): search, filters,
// sorting, clearing, pages that keep their filters, invalid ranges, deleted
// and empty results, what a non-member sees, and a small phone. One
// household is set up for the run; nothing in it changes during the tests.
// Throwaway users and households are removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { todayIn } from "../src/lib/expenses/dates";
import {
  adminClient,
  signedInClient,
  type TypedClient,
} from "../supabase/tests/support/local-supabase";

const admin = adminClient();
const password = `e2e-${randomUUID()}`;
const TIME_ZONE = "Asia/Kolkata";

type User = { id: string; email: string; client: TypedClient };
let olive: User, pat: User, outsider: User;
let householdId: string;
let base: string;
/** Makes this run's descriptions unique in the shared local database. */
const tag = randomUUID().slice(0, 6);
const named = (text: string) => `${text} ${tag}`;

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

/** Next.js keeps the previous page mounted but hidden: match visible only. */
function visible(page: Page, text: string | RegExp) {
  return page.getByText(text, { exact: true }).locator("visible=true");
}

function heading(page: Page, name: string, level = 1) {
  return page.getByRole("heading", { level, name }).locator("visible=true");
}

function field(page: Page, label: string) {
  return page.getByLabel(label, { exact: true }).locator("visible=true");
}

/** The expense rows, by their descriptions, in order. */
async function rowTitles(page: Page) {
  const list = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2 }) })
    .locator("ul")
    .locator("visible=true")
    .first();
  await expect(list).toBeVisible();
  return list.locator("li .type-card-title").allTextContents();
}

/** The rows, retried until they settle (results stream in after a change). */
function expectRows(page: Page) {
  return expect.poll(() => rowTitles(page));
}

async function openFilters(page: Page) {
  const details = page
    .locator("details:has(summary)")
    .locator("visible=true")
    .first();
  if ((await details.getAttribute("open")) === null) {
    await details.locator("summary").click();
  }
  await expect(details).toHaveAttribute("open", "");
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function addExpense(
  creator: User,
  title: string,
  amount: number,
  category: "utilities" | "groceries" | "rent" | "transport" | "other",
  date: string,
  payer: User,
) {
  const { data, error } = await creator.client.rpc("create_expense", {
    target_household_id: householdId,
    title,
    amount,
    expense_category: category,
    spent_on: date,
    payer_id: payer.id,
    method: "custom",
    shares: [{ user_id: payer.id, share_minor: amount, percentage_bp: null }],
  });
  if (error) throw error;
  return data;
}

test.beforeAll(async () => {
  olive = await createUser("Olive");
  pat = await createUser("Pat");
  outsider = await createUser("Xena");

  const created = await olive.client.rpc("create_household", {
    household_name: `E2E History ${tag}`,
    currency: "INR",
    time_zone: TIME_ZONE,
  });
  if (created.error) throw created.error;
  householdId = created.data;
  base = `/households/${householdId}/expenses`;
  const bytes = randomBytes(32);
  const invite = await olive.client.from("invitations").insert({
    household_id: householdId,
    token_hash: createHash("sha256").update(bytes).digest("hex"),
  });
  if (invite.error) throw invite.error;
  const joined = await pat.client.rpc("accept_invite", {
    token: bytes.toString("base64url"),
  });
  if (joined.error) throw joined.error;

  // Today in the household's timezone, as the app works it out (D11), and
  // the first day of the month before.
  const today = todayIn(TIME_ZONE);
  const [year, month] = today.split("-").map(Number);
  const lastMonth = new Date(Date.UTC(year, month - 2, 1))
    .toISOString()
    .slice(0, 10);
  await addExpense(
    olive,
    named("Electricity bill"),
    240000,
    "utilities",
    today,
    olive,
  );
  await addExpense(pat, named("Groceries run"), 85050, "groceries", today, pat);
  await addExpense(olive, named("Rent"), 3000000, "rent", lastMonth, olive);
  await addExpense(pat, named("Taxi"), 65000, "transport", lastMonth, pat);
  // 26 more, so there are two pages of 25: 30 counted in all.
  for (let i = 10; i < 36; i++) {
    await addExpense(
      olive,
      named(`Item ${i}`),
      1000 + i,
      "other",
      lastMonth,
      olive,
    );
  }
  const old = await addExpense(
    olive,
    named("Old phone"),
    500000,
    "other",
    lastMonth,
    olive,
  );
  const deleted = await olive.client.rpc("delete_expense", {
    target_expense_id: old,
  });
  if (deleted.error) throw deleted.error;
});

test.afterAll(async () => {
  const ids = [olive, pat, outsider].filter(Boolean).map((u) => u.id);
  await admin.from("households").delete().in("created_by", ids);
  await admin.from("profiles").delete().in("id", ids);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
});

test("search, a category, a new order and clearing, all in the URL", async ({
  page,
}) => {
  await signIn(page, pat);
  await page.goto(base);
  await expect(heading(page, "Expense history")).toBeVisible();
  // Everything counted, with its summary.
  await expect(heading(page, "All counted spending", 2)).toBeVisible();
  await expect(
    visible(page, "Showing 1–25 of 30, newest first."),
  ).toBeVisible();

  // Search ignores capitals and spaces at the ends.
  await field(page, "Search").fill("  ELECTRICITY ");
  await field(page, "Search").press("Enter");
  await page.waitForURL(/[?&]q=ELECTRICITY(&|$)/);
  await expectRows(page).toEqual([named("Electricity bill")]);
  const chip = page.getByRole("link", {
    name: "Remove filter: Search: “ELECTRICITY”",
  });
  await expect(chip).toBeVisible();
  await expect(heading(page, "What matches", 2)).toBeVisible();
  await expect(visible(page, "Showing 1–1 of 1, newest first.")).toBeVisible();

  // Removing the chip removes just the search, from the box too, so the
  // next change doesn't send it again.
  await chip.click();
  await page.waitForURL((url) => url.search === "");
  await expect(
    visible(page, "Showing 1–25 of 30, newest first."),
  ).toBeVisible();
  await expect(field(page, "Search")).toHaveValue("");

  // A category.
  await openFilters(page);
  await field(page, "Groceries").check();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.waitForURL(/category=groceries/);
  await expectRows(page).toEqual([named("Groceries run")]);
  await expect(
    page.getByRole("link", { name: "Remove filter: Groceries" }),
  ).toBeVisible();

  // A new order applies straight away and keeps the category.
  await field(page, "Sort").selectOption("highest");
  await page.waitForURL(/sort=highest/);
  expect(page.url()).toContain("category=groceries");

  // Clear all.
  await page.getByRole("link", { name: "Clear all" }).first().click();
  await page.waitForURL((url) => url.search === "");
  await field(page, "Sort").selectOption("highest");
  await page.waitForURL(/sort=highest/);
  await expect.poll(async () => (await rowTitles(page))[0]).toBe(named("Rent"));
  await noHorizontalOverflow(page);
});

test("date presets, and a range that can't be right", async ({ page }) => {
  await signIn(page, pat);
  await page.goto(`${base}?range=month`);
  await expect(heading(page, "Expense history")).toBeVisible();
  // Both from today; Groceries was added later, so it's newer.
  await expectRows(page).toEqual([
    named("Groceries run"),
    named("Electricity bill"),
  ]);
  await expect(
    page.getByRole("link", { name: /^Remove filter: This month \(/ }),
  ).toBeVisible();

  await page.goto(`${base}?range=last-month&q=${tag}&sort=highest`);
  await expect.poll(async () => (await rowTitles(page))[0]).toBe(named("Rent"));

  // The maximum below the minimum: explained, and no figures shown.
  await page.goto(`${base}?min=500&max=100`);
  await expect(
    visible(page, "The maximum can't be less than the minimum."),
  ).toBeVisible();
  await expect(
    page
      .getByText(/Some of these filters can't be used/)
      .locator("visible=true"),
  ).toBeVisible();
  await expect(page.getByText("Showing 1–")).toHaveCount(0);
  // Fixed, it works: ₹500 to ₹1,000, both ends included.
  await field(page, "Maximum").fill("1000");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.waitForURL(/max=1000/);
  await expectRows(page).toEqual([named("Groceries run"), named("Taxi")]);
});

test("pages keep the search and the order", async ({ page }) => {
  await signIn(page, pat);
  await page.goto(`${base}?q=${tag}&sort=oldest`);
  await expect(visible(page, "Page 1 of 2")).toBeVisible();
  await expect.poll(async () => (await rowTitles(page)).length).toBe(25);
  const first = await rowTitles(page);

  await page.getByRole("link", { name: "Next page" }).click();
  await page.waitForURL(/page=2/);
  await expect(visible(page, "Page 2 of 2")).toBeVisible();
  expect(page.url()).toContain(`q=${tag}`);
  expect(page.url()).toContain("sort=oldest");
  await expect.poll(async () => (await rowTitles(page)).length).toBe(5);
  const second = await rowTitles(page);
  // No expense on both pages, none missing.
  expect(new Set([...first, ...second]).size).toBe(30);
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();

  await page.getByRole("link", { name: "First page" }).click();
  await page.waitForURL((url) => !url.search.includes("page="));
  await expectRows(page).toEqual(first);

  // A page that no longer exists after a change shows the last one.
  await page.goto(`${base}?q=${tag}&page=7`);
  await expect(
    visible(page, "There are only 2 pages, so this is the last one."),
  ).toBeVisible();
});

test("deleted expenses are one filter away, and an empty result says so", async ({
  page,
}) => {
  await signIn(page, olive);
  await page.goto(`${base}?status=deleted`);
  await expect(heading(page, "Deleted expenses", 2)).toBeVisible();
  await expectRows(page).toEqual([named("Old phone")]);
  await expect(visible(page, "Deleted")).toBeVisible();

  await page.goto(`${base}?q=nothing-matches-this`);
  await expect(visible(page, "No expenses match")).toBeVisible();
  await page.getByRole("link", { name: "Clear all filters" }).click();
  await page.waitForURL((url) => url.search === "");
  await expect(
    visible(page, "Showing 1–25 of 30, newest first."),
  ).toBeVisible();
});

test("a non-member sees no history at all", async ({ page }) => {
  await signIn(page, outsider);
  for (const path of [
    base,
    `${base}?q=Electricity`,
    `${base}?status=deleted`,
  ]) {
    await page.goto(path);
    await expect(visible(page, /couldn't find that household/)).toBeVisible();
    expect(await page.content()).not.toContain(tag);
  }
});

test("the history and its filters fit a 360px phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page, pat);
  await page.goto(`${base}?range=last-month&category=rent&category=transport`);
  await expect(heading(page, "Expense history")).toBeVisible();
  await openFilters(page);
  await expect(field(page, "Rent")).toBeChecked();
  await noHorizontalOverflow(page);
  const bar = page.locator('nav[aria-label="Main"]').locator("visible=true");
  await expect(bar.getByRole("link", { name: "Expenses" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
