// Notifications and the Phase 17 polish in a real browser: the bell and its
// unread count, the notification centre (open, mark as read, mark all, the
// unread filter, older pages), Needs attention, the settings (a switched-off
// type stays off, and the ticks keep what was saved), the keyboard path
// through the shell and a dialog, reduced motion, phone widths, and the
// analytics overflow fixed in this phase. Throwaway users and households are
// removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { addDays } from "../src/lib/bills/schedule";
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
let olive: User, pat: User;

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

function bell(page: Page) {
  return page
    .getByRole("link", { name: /^Notifications/ })
    .locator("visible=true");
}

function section(page: Page, name: string) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name, exact: true }) })
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

/** Pat records an expense he paid, shared with Olive: Olive is notified. */
async function patSpends(householdId: string, title: string, amount = 50000) {
  const { data, error } = await pat.client.rpc("create_expense", {
    target_household_id: householdId,
    title,
    amount,
    expense_category: "groceries",
    spent_on: todayIn(TZ),
    payer_id: pat.id,
    method: "custom",
    shares: [olive, pat].map((u) => ({
      user_id: u.id,
      share_minor: amount / 2,
      percentage_bp: null,
    })),
  });
  if (error) throw error;
  return data;
}

async function readAll(user: User) {
  const { error } = await user.client.rpc("mark_notifications_read");
  if (error) throw error;
}

test.beforeAll(async () => {
  olive = await createUser("Olive");
  pat = await createUser("Pat");
});

test.afterAll(async () => {
  const ids = [olive, pat].filter(Boolean).map((u) => u.id);
  await admin.from("households").delete().in("created_by", ids);
  await admin.from("profiles").delete().in("id", ids);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
});

// One test at a time: they share Olive's inbox.
test.describe.configure({ mode: "serial" });

test("the bell counts what's unread; opening one goes to it and marks it read", async ({
  page,
}) => {
  const home = await newHome("Bell");
  await readAll(olive);
  const expense = await patSpends(home.id, "Weekly shop");
  await signIn(page, olive);

  await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");
  await bell(page).click();
  await page.waitForURL("**/notifications");
  await expect(
    page.getByRole("heading", { level: 1, name: "Notifications" }),
  ).toBeVisible();
  const item = page
    .getByRole("article", { name: "Pat added an expense" })
    .first();
  await expect(item).toContainText("New");
  await expect(item).toContainText("Weekly shop — ₹500.00");
  await expect(item).toContainText(home.name);

  // Opening it goes to the expense, and it's read from then on.
  await item.getByRole("button", { name: "Pat added an expense" }).click();
  await page.waitForURL(new RegExp(`/expenses/${expense}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: "Weekly shop" }),
  ).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName("Notifications");
  await page.goto("/notifications");
  await expect(
    page.getByRole("article", { name: "Pat added an expense" }).first(),
  ).not.toContainText("New");
});

test("mark one or all as read, and the unread filter", async ({ page }) => {
  const home = await newHome("Marking");
  await readAll(olive);
  await patSpends(home.id, "Bread");
  await patSpends(home.id, "Milk");
  await patSpends(home.id, "Eggs");
  await signIn(page, olive);
  await page.goto("/notifications?show=unread");
  const list = section(page, "Unread");
  await expect(list.getByRole("article")).toHaveCount(3);
  await expect(list).toContainText("3 unread.");

  // One, by its named button (WCAG 2.5.3: the visible words, then which).
  await list
    .getByRole("button", { name: "Mark as read: Pat added an expense" })
    .first()
    .click();
  await expect(page.getByText("Marked as read.")).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName("Notifications, 2 unread");
  await page.reload();
  await expect(section(page, "Unread").getByRole("article")).toHaveCount(2);

  await section(page, "Unread")
    .getByRole("button", { name: "Mark all as read" })
    .click();
  await expect(
    page.getByText("All notifications are marked as read."),
  ).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName("Notifications");
  await page.reload();
  await expect(visible(page, "No unread notifications")).toBeVisible();
  await page.getByRole("link", { name: "Show all notifications" }).click();
  await page.waitForURL(/\/notifications$/);
  await expect(
    page.getByRole("article", { name: "Pat added an expense" }),
  ).not.toHaveCount(0);
});

test("needs attention lists what's due, and goes once it's dealt with", async ({
  page,
}) => {
  const home = await newHome("Attention");
  const { data: chore, error } = await pat.client.rpc("create_chore", {
    target_household_id: home.id,
    chore_title: "Defrost the freezer",
    chore_assignee_id: olive.id,
    chore_due_on: addDays(todayIn(TZ), -2),
  });
  if (error) throw error;
  await signIn(page, olive);
  await page.goto("/notifications");
  const attention = section(page, "Needs attention");
  const row = attention
    .getByRole("listitem")
    .filter({ hasText: "Defrost the freezer" });
  await expect(row).toContainText("Overdue");
  await expect(row).toContainText("2 days overdue");
  await expect(row).toContainText(home.name);
  // It's also a notification: Pat assigned it to Olive.
  await expect(
    page.getByRole("article", { name: "Pat added a chore" }).first(),
  ).toBeVisible();

  await olive.client.rpc("complete_chore", { target_chore_id: chore! });
  await page.reload();
  await expect(
    section(page, "Needs attention").getByText("Defrost the freezer"),
  ).toHaveCount(0);
});

test("a type switched off stays off, and the ticks show what's saved", async ({
  page,
}) => {
  const home = await newHome("Settings");
  await readAll(olive);
  await signIn(page, olive);
  await page.goto("/profile");
  await page.getByRole("link", { name: "Notification settings" }).click();
  await page.waitForURL("**/profile/notifications");
  await expect(
    page
      .locator('nav[aria-label="Main"]')
      .locator("visible=true")
      .getByRole("link", { name: "Profile" }),
  ).toHaveAttribute("aria-current", "page");
  const form = page
    .locator("form")
    .filter({ has: page.getByText(home.name, { exact: true }) });
  const expenses = form.getByRole("checkbox", { name: "Expenses" });
  await expect(expenses).toBeChecked();
  await expenses.click();
  await form.getByRole("button", { name: `Save for ${home.name}` }).click();
  await expect(form.getByText(`Saved for ${home.name}.`)).toBeVisible();
  // Still unticked after the save (the form isn't reset to its old ticks).
  await expect(expenses).not.toBeChecked();
  await page.reload();
  await expect(
    page
      .locator("form")
      .filter({ has: page.getByText(home.name, { exact: true }) })
      .getByRole("checkbox", { name: "Expenses" }),
  ).not.toBeChecked();

  await patSpends(home.id, "Muted shop");
  await page.goto("/notifications");
  await expect(bell(page)).toHaveAccessibleName("Notifications");
  await expect(page.getByText("Muted shop — ₹500.00")).toHaveCount(0);
});

test("the keyboard reaches everything in order, and a dialog gives focus back", async ({
  page,
}) => {
  const home = await newHome("Keyboard");
  await patSpends(home.id, "Keyboard shop");
  await signIn(page, olive);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`/households/${home.id}/expenses`);
  // The first stop is the skip link, and it moves focus to the main content.
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  // Then the brand, then the bell, which opens with Enter.
  await page.goto(`/households/${home.id}`);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(bell(page)).toBeFocused();
  const outline = await bell(page).evaluate(
    (el) => getComputedStyle(el).boxShadow + getComputedStyle(el).outlineStyle,
  );
  expect(outline).not.toBe("nonenone");

  // A confirmation dialog: Escape closes it, focus goes back to its button.
  await page.goto(`/households/${home.id}/shopping`);
  await page
    .getByLabel("Item", { exact: true })
    .locator("visible=true")
    .fill("Soap");
  await page.getByRole("button", { name: "Add to the list" }).click();
  await expect(page.getByText("Added Soap to the list.")).toBeVisible();
  const remove = page.getByRole("button", { name: "Remove: Soap" });
  await remove.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  // The safe choice has focus first.
  await expect(dialog.getByRole("button", { name: "Keep item" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
});

test("reduced motion turns transitions off", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await signIn(page, olive);
  const duration = await bell(page).evaluate(
    (el) => getComputedStyle(el).transitionDuration,
  );
  expect(Number.parseFloat(duration)).toBeLessThan(0.01);
  await context.close();
});

test("notifications and analytics fit a phone, a tablet and a laptop", async ({
  page,
}) => {
  const home = await newHome("Widths");
  // A long name, as the largest expense: this pushed analytics wider than a
  // phone before roadmap Phase 17.
  await patSpends(
    home.id,
    "A very long description for the weekly grocery run and some household supplies",
    250000,
  );
  await signIn(page, olive);
  for (const [width, height] of [
    [320, 700],
    [390, 844],
    [768, 1024],
    [1366, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/notifications");
    await expect(
      page.getByRole("heading", { level: 1, name: "Notifications" }),
    ).toBeVisible();
    await expect(bell(page)).toBeVisible();
    await noHorizontalOverflow(page);
    await page.goto(`/households/${home.id}/analytics`);
    await expect(section(page, "Summary")).toBeVisible();
    await noHorizontalOverflow(page);
    await page.goto("/profile/notifications");
    await expect(
      page.getByRole("heading", { level: 1, name: "Notification settings" }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
  }
});
