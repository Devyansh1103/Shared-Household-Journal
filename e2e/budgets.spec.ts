// Budgets and analytics in a real browser (roadmap Phase 16): adding a
// budget with the form (a mistake keeps the choices), the figures and status
// in words, changing a limit, removing a budget, going back a month, the
// Household page's summary, the analytics filters and tables, the journal, a
// non-member, and a 360px phone. Each test gets its own household; throwaway
// users and households are removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { addDays, addMonths } from "../src/lib/bills/schedule";
import { periodStart } from "../src/lib/budgets/period";
import { todayIn } from "../src/lib/expenses/dates";
import {
  adminClient,
  signedInClient,
  type TypedClient,
} from "../supabase/tests/support/local-supabase";

const admin = adminClient();
const password = `e2e-${randomUUID()}`;
const TZ = "Asia/Kolkata";

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

function visible(page: Page, text: string | RegExp) {
  return page.getByText(text, { exact: true }).locator("visible=true");
}

function heading(page: Page, name: string | RegExp, level = 1) {
  return page.getByRole("heading", { level, name }).locator("visible=true");
}

function field(page: Page, label: string) {
  return page.getByLabel(label, { exact: true }).locator("visible=true");
}

function section(page: Page, name: string) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name, exact: true }) })
    .locator("visible=true");
}

function card(page: Page, name: string) {
  return page
    .locator("article")
    .filter({ has: page.getByRole("heading", { level: 3, name, exact: true }) })
    .locator("visible=true");
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Olive's household with Pat. */
async function newHome(label: string) {
  const name = `E2E ${label} ${randomUUID().slice(0, 6)}`;
  const created = await olive.client.rpc("create_household", {
    household_name: name,
    currency: "INR",
    time_zone: TZ,
  });
  if (created.error) throw created.error;
  const id = created.data;
  const bytes = randomBytes(32);
  const invite = await olive.client.from("invitations").insert({
    household_id: id,
    token_hash: createHash("sha256").update(bytes).digest("hex"),
  });
  if (invite.error) throw invite.error;
  const joined = await pat.client.rpc("accept_invite", {
    token: bytes.toString("base64url"),
  });
  if (joined.error) throw joined.error;
  return { id, name };
}

/** An expense Olive (or Pat) paid, split equally between them. */
async function addExpense(
  householdId: string,
  input: {
    amount: number;
    category: "groceries" | "dining" | "rent";
    date: string;
    payer?: User;
    title: string;
  },
) {
  const payer = input.payer ?? olive;
  const half = input.amount / 2;
  const { error } = await payer.client.rpc("create_expense", {
    target_household_id: householdId,
    title: input.title,
    amount: input.amount,
    expense_category: input.category,
    spent_on: input.date,
    payer_id: payer.id,
    method: "equal",
    shares: [olive, pat].map((u) => ({
      user_id: u.id,
      share_minor: half,
      percentage_bp: null,
    })),
  });
  if (error) throw error;
}

test.beforeAll(async () => {
  olive = await createUser("Olive");
  pat = await createUser("Pat");
  outsider = await createUser("Xena");
});

test.afterAll(async () => {
  const ids = [olive, pat, outsider].filter(Boolean).map((u) => u.id);
  await admin.from("households").delete().in("created_by", ids);
  await admin.from("profiles").delete().in("id", ids);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
});

test("add budgets, see them used, change a limit and remove one", async ({
  page,
}) => {
  const home = await newHome("Budgets");
  const today = todayIn(TZ);
  const monthStart = periodStart(today, "month");
  await addExpense(home.id, {
    amount: 700000,
    category: "groceries",
    date: monthStart,
    title: "Big shop",
  });
  await addExpense(home.id, {
    amount: 200000,
    category: "dining",
    date: today,
    payer: pat,
    title: "Dinner",
  });

  await signIn(page, pat);
  await page.goto(`/households/${home.id}`);
  await expect(section(page, "Budgets and spending")).toContainText(
    "No monthly budget for everything yet",
  );
  await section(page, "Budgets and spending")
    .getByRole("link", { name: "Budgets" })
    .click();
  await expect(heading(page, "Budgets")).toBeVisible();
  await expect(visible(page, "No monthly budgets yet")).toBeVisible();

  // Pat isn't the owner, and may add one (O3).
  await page.getByRole("link", { name: "Add a budget" }).first().click();
  await expect(heading(page, "Add a budget")).toBeVisible();
  await field(page, "What it covers").selectOption("groceries");
  await field(page, "Limit (INR)").fill("0");
  await page.getByRole("button", { name: "Add budget" }).click();
  await expect(
    visible(page, "Enter an amount greater than zero."),
  ).toBeVisible();
  // What was chosen is still chosen.
  await expect(field(page, "What it covers")).toHaveValue("groceries");
  await field(page, "Limit (INR)").fill("8,000");
  await page.getByRole("button", { name: "Add budget" }).click();
  await page.waitForURL(/\/budgets\?period=month&created=1$/);
  await expect(page.getByText("The budget is added.")).toBeVisible();

  const groceries = card(page, "Groceries");
  await expect(groceries).toContainText("₹7,000.00 spent of ₹8,000.00");
  await expect(groceries).toContainText("87.5% used · ₹1,000.00 left");
  await expect(groceries.getByText("Near limit")).toBeVisible();

  // A second one, for everything, then a duplicate is refused.
  await page.goto(`/households/${home.id}/budgets/new`);
  await field(page, "Limit (INR)").fill("5000");
  await page.getByRole("button", { name: "Add budget" }).click();
  await page.waitForURL(/created=1$/);
  const everything = card(page, "Everything");
  await expect(everything).toContainText("₹9,000.00 spent of ₹5,000.00");
  await expect(everything).toContainText("₹4,000.00 over the limit");
  await expect(everything.getByText("Over budget")).toBeVisible();
  await page.goto(`/households/${home.id}/budgets/new`);
  await field(page, "Limit (INR)").fill("6000");
  await page.getByRole("button", { name: "Add budget" }).click();
  await expect(
    page.getByText(/There's already a budget for that/),
  ).toBeVisible();

  // Change a limit.
  await page.goto(`/households/${home.id}/budgets`);
  await card(page, "Everything")
    .getByRole("link", { name: "Change limit: Monthly budget for everything" })
    .click();
  await expect(heading(page, "Change the limit")).toBeVisible();
  await expect(field(page, "Limit (INR)")).toHaveValue("5000.00");
  await field(page, "Limit (INR)").fill("12000");
  await page.getByRole("button", { name: "Save limit" }).click();
  await page.waitForURL(/updated=1$/);
  await expect(card(page, "Everything")).toContainText(
    "75% used · ₹3,000.00 left",
  );
  await expect(card(page, "Everything").getByText("On track")).toBeVisible();

  // The household page sums it up.
  await page.goto(`/households/${home.id}`);
  const summary = section(page, "Budgets and spending");
  await expect(summary).toContainText(
    "This month: ₹9,000.00 of ₹12,000.00 (75%)",
  );
  await expect(summary.getByText("1 category near its limit")).toBeVisible();

  // Remove one, after saying so.
  await page.goto(`/households/${home.id}/budgets`);
  await card(page, "Groceries")
    .getByRole("button", { name: "Remove: Monthly budget for groceries" })
    .click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Remove budget" }).click();
  await expect(page.getByText(/The budget is removed/)).toBeVisible();
  await expect(card(page, "Groceries")).toHaveCount(0);

  // Last month: nothing covered it, and nothing can be changed there.
  await page.getByRole("link", { name: /^Previous month/ }).click();
  await expect(page.getByText(/last month/)).toBeVisible();
  await expect(
    visible(page, "No monthly budgets covered this month"),
  ).toBeVisible();

  // Every change is in the journal.
  await page.goto(`/households/${home.id}/journal?show=budgets`);
  await expect(
    visible(page, "You set a monthly budget for groceries"),
  ).toBeVisible();
  await expect(
    visible(page, "You changed the monthly budget for everything"),
  ).toBeVisible();
  await expect(
    visible(page, "You removed the monthly budget for groceries"),
  ).toBeVisible();
});

test("analytics: totals, categories, people, filters", async ({ page }) => {
  const home = await newHome("Analytics");
  const today = todayIn(TZ);
  const last = addMonths(periodStart(today, "month"), -1);
  await addExpense(home.id, {
    amount: 300000,
    category: "groceries",
    date: last,
    title: "Big shop",
  });
  await addExpense(home.id, {
    amount: 100000,
    category: "dining",
    date: addDays(last, 3),
    payer: pat,
    title: "Dinner",
  });
  await addExpense(home.id, {
    amount: 50000,
    category: "rent",
    date: addMonths(last, -1),
    title: "Earlier",
  });

  await signIn(page, olive);
  await page.goto(`/households/${home.id}`);
  await section(page, "Budgets and spending")
    .getByRole("link", { name: "Spending analytics" })
    .click();
  await expect(heading(page, "Spending analytics")).toBeVisible();

  await field(page, "Dates").selectOption("last_month");
  await page.getByRole("button", { name: "Show" }).click();
  await page.waitForURL(/\?range=last_month$/);
  await expect(page.getByText(/^Showing: Last month/)).toBeVisible();
  const summary = section(page, "Summary");
  await expect(summary).toContainText("₹4,000.00");
  await expect(summary).toContainText("Average expense₹2,000.00");
  await expect(summary).toContainText("Big shop");
  // Compared with the month before: ₹500 then.
  await expect(summary).toContainText(
    "₹3,500.00 more (700% more) than ₹500.00.",
  );

  const categories = section(page, "By category").getByRole("table", {
    name: "Spending by category",
  });
  await expect(categories.getByRole("row")).toHaveCount(3);
  const groceriesRow = categories.getByRole("row", { name: /^Groceries/ });
  // The bar's cell is hidden from assistive technology: only the figures.
  await expect(groceriesRow.getByRole("cell")).toHaveText([
    "₹3,000.00",
    "75%",
    "1",
  ]);

  // Paid and share, kept apart: Olive paid 3000 but her share is 2000.
  const people = section(page, "By person");
  await expect(people.getByRole("row", { name: /^You/ })).toContainText(
    "₹3,000.00",
  );
  await expect(people.getByRole("row", { name: /^You/ })).toContainText(
    "₹2,000.00",
  );

  // Filtered by who paid: every figure follows.
  await field(page, "Paid by").selectOption(pat.id);
  await page.getByRole("button", { name: "Show" }).click();
  await page.waitForURL(new RegExp(`payer=${pat.id}$`));
  await expect(page.getByText(/^Showing: .* · paid by Pat$/)).toBeVisible();
  await expect(section(page, "Summary")).toContainText("₹1,000.00");
  await expect(
    section(page, "Largest expenses").getByRole("listitem"),
  ).toHaveCount(1);

  // Custom dates the wrong way round: said near the field, no figures.
  await page.goto(
    `/households/${home.id}/analytics?range=custom&from=2026-03-10&to=2026-03-01`,
  );
  await expect(
    visible(page, "The end date can't be before the start date."),
  ).toBeVisible();
  await expect(
    visible(page, "Fix the filters above to see the figures."),
  ).toBeVisible();

  // A range with nothing in it.
  await page.goto(
    `/households/${home.id}/analytics?range=custom&from=2020-01-01&to=2020-01-31`,
  );
  await expect(visible(page, "No expenses in this range")).toBeVisible();
  await expect(section(page, "Summary")).toContainText(
    "Nothing was recorded then, so there's nothing to compare with.",
  );
});

test("a non-member sees no budgets or analytics", async ({ page }) => {
  const home = await newHome("Private");
  const { data: budgetId } = await olive.client.rpc("create_budget", {
    target_household_id: home.id,
    budget_kind: "month",
    budget_limit: 100000,
  });
  await signIn(page, outsider);
  for (const path of ["budgets", "budgets/new", "analytics"]) {
    await page.goto(`/households/${home.id}/${path}`);
    await expect(visible(page, /couldn't find that household/)).toBeVisible();
  }
  await page.goto(`/households/${home.id}/budgets/${budgetId}/edit`);
  await expect(visible(page, /couldn't find that budget/)).toBeVisible();
});

test("budgets and analytics fit a 360px phone", async ({ page }) => {
  const home = await newHome("Phone");
  const today = todayIn(TZ);
  await addExpense(home.id, {
    amount: 123456,
    category: "groceries",
    date: today,
    title: "A long description for a grocery run",
  });
  await olive.client.rpc("create_budget", {
    target_household_id: home.id,
    budget_kind: "month",
    budget_limit: 100000,
    budget_category: "groceries",
  });
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page, pat);
  await page.goto(`/households/${home.id}/budgets`);
  await expect(card(page, "Groceries")).toBeVisible();
  await noHorizontalOverflow(page);
  await page.goto(`/households/${home.id}/analytics?range=last_12_months`);
  await expect(section(page, "Over time")).toBeVisible();
  await noHorizontalOverflow(page);
  const bar = page.locator('nav[aria-label="Main"]').locator("visible=true");
  await expect(bar.getByRole("link", { name: "Household" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
