// Expense lifecycle in a real browser: add, view, edit, delete and restore,
// plus the split preview and what a non-member sees. Throwaway users and
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

type User = { id: string; email: string; client: TypedClient };
let owner: User, member: User, outsider: User;
let householdId: string;
let householdName: string;

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
  return page.getByText(text).locator("visible=true");
}

/** A visible form control by its label (see `visible`). */
function field(page: Page, label: string) {
  return page.getByLabel(label, { exact: true }).locator("visible=true");
}

test.beforeAll(async () => {
  owner = await createUser("Olive");
  member = await createUser("Pat");
  outsider = await createUser("Xena");

  householdName = `E2E Flat ${randomUUID().slice(0, 6)}`;
  const created = await owner.client.rpc("create_household", {
    household_name: householdName,
    currency: "INR",
    time_zone: "Asia/Kolkata",
  });
  if (created.error) throw created.error;
  householdId = created.data;

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
});

test.afterAll(async () => {
  const ids = [owner, member, outsider].filter(Boolean).map((u) => u.id);
  await admin.from("households").delete().in("created_by", ids);
  await admin.from("profiles").delete().in("id", ids);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
});

test("add, view, edit, delete and restore an expense", async ({ page }) => {
  const title = `Electricity ${randomUUID().slice(0, 6)}`;
  await signIn(page, owner);

  // Empty state with a working action.
  await page.goto(`/households/${householdId}/expenses`);
  await page.getByRole("link", { name: "Add expense" }).first().click();
  await page.waitForURL("**/expenses/new");

  // Validation stays on the page and explains itself.
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(visible(page, "Describe the expense")).toBeVisible();
  await expect(visible(page, "Enter an amount.")).toBeVisible();

  await field(page, "What was it for?").fill(title);
  await field(page, "Amount (INR)").fill("100.01");
  await field(page, "Category").selectOption("utilities");

  // Live preview: ₹100.01 between two people, the first joiner gets the extra paisa.
  await expect(visible(page, "Split equally between 2 people.")).toBeVisible();
  await expect(visible(page, "₹50.01")).toBeVisible();
  await expect(visible(page, "₹50.00")).toBeVisible();

  await page.getByRole("button", { name: "Save expense" }).click();
  await page.waitForURL(/\/expenses\/[0-9a-f-]{36}\?created=1/);
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
  await expect(visible(page, "₹100.01").first()).toBeVisible();
  await expect(visible(page, "Split equally")).toBeVisible();

  // Edit to a custom split.
  await page.getByRole("link", { name: "Edit expense" }).click();
  // The URL changes before the page streams in: wait for its heading.
  await expect(
    page.getByRole("heading", { level: 1, name: "Edit expense" }),
  ).toBeVisible();
  await field(page, "Amount (INR)").fill("90");
  await field(page, "Custom amounts").check();
  await field(page, "Olive's amount").fill("30");
  await field(page, "Pat's amount").fill("50");
  await expect(visible(page, "₹10.00 still to assign.")).toBeVisible();
  await field(page, "Pat's amount").fill("60");
  await expect(visible(page, "The amounts add up to the total.")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(/\?updated=1/);
  await expect(visible(page, "Your changes are saved.")).toBeVisible();
  await expect(visible(page, "Split by custom amounts")).toBeVisible();
  await expect(visible(page, "₹90.00").first()).toBeVisible();

  // The list shows it.
  await page
    .getByRole("link", { name: "Expenses" })
    .locator("visible=true")
    .first()
    .click();
  await expect(
    page
      .getByRole("heading", { level: 1, name: "Expenses" })
      .locator("visible=true"),
  ).toBeVisible();
  const row = page
    .getByRole("link", { name: new RegExp(title) })
    .locator("visible=true");
  await expect(row).toBeVisible();

  // Delete, with a confirmation that names the safe choice.
  await row.click();
  await expect(
    page
      .getByRole("heading", { level: 1, name: title })
      .locator("visible=true"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete expense" })
    .locator("visible=true")
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("button", { name: "Keep expense" }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Delete expense" }).click();
  await page.waitForURL(/\/expenses\?deleted=1/);
  await expect(
    page.getByRole("heading", { name: "Deleted expenses" }),
  ).toBeVisible();

  // The owner restores it.
  await page
    .getByRole("link", { name: new RegExp(title) })
    .locator("visible=true")
    .click();
  const restore = page
    .getByRole("button", { name: "Restore expense" })
    .locator("visible=true");
  await expect(restore).toBeVisible();
  await restore.click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Restore expense" })
    .click();
  await expect(page.locator("[data-sonner-toast]")).toContainText("restored");
  await expect(
    page
      .getByRole("button", { name: "Delete expense" })
      .locator("visible=true"),
  ).toBeVisible();
});

test("a non-member can't see the household's expenses", async ({ page }) => {
  const { data } = await owner.client.rpc("create_expense", {
    target_household_id: householdId,
    title: "Private groceries",
    amount: 5000,
    expense_category: "groceries",
    spent_on: "2026-11-10",
    payer_id: owner.id,
    method: "custom",
    shares: [{ user_id: owner.id, share_minor: 5000, percentage_bp: null }],
  });
  await signIn(page, outsider);

  await page.goto(`/households/${householdId}/expenses`);
  await expect(visible(page, /couldn't find/)).toBeVisible();
  await page.goto(`/households/${householdId}/expenses/${data}`);
  await expect(visible(page, /couldn't find/)).toBeVisible();
  expect(await page.content()).not.toContain("Private groceries");
  expect(await page.content()).not.toContain(householdName);
});
