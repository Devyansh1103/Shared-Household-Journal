// Recurring bills in a real browser (roadmap Phase 14, D10): adding a bill
// with the form (and its month-end dates), finding it due, recording a period
// through the pre-filled expense form for a different amount, skipping and
// undoing, pausing, resuming and ending, who can change a bill, the Household
// page's reminder, the journal, a non-member, and a 360px phone. Each test
// gets its own household; throwaway users and households are removed
// afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { addDays } from "../src/lib/bills/schedule";
import { todayIn } from "../src/lib/expenses/dates";
import { formatDate } from "../src/lib/format";
import {
  adminClient,
  signedInClient,
  type TypedClient,
} from "../supabase/tests/support/local-supabase";

const admin = adminClient();
const password = `e2e-${randomUUID()}`;
const TZ = "Asia/Kolkata";

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

function heading(page: Page, name: string | RegExp, level = 1) {
  return page.getByRole("heading", { level, name }).locator("visible=true");
}

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

/** Olive's household with Pat and Quin. */
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
  for (const member of [pat, quin]) {
    const joined = await member.client.rpc("accept_invite", {
      token: bytes.toString("base64url"),
    });
    if (joined.error) throw joined.error;
  }
  return { id, name };
}

/** A bill Olive adds and pays, split equally between Olive and Pat. */
async function addBill(
  householdId: string,
  input: { title: string; unit?: "week" | "month"; firstDueOn: string },
) {
  const { data, error } = await olive.client.rpc("create_recurring_bill", {
    target_household_id: householdId,
    title: input.title,
    amount: 200000,
    bill_category: "utilities",
    bill_payer_id: olive.id,
    method: "equal",
    shares: [olive, pat].map((u) => ({
      user_id: u.id,
      share_minor: 100000,
      percentage_bp: null,
    })),
    repeat_unit: input.unit ?? "month",
    repeat_every: 1,
    first_due_on: input.firstDueOn,
  });
  if (error) throw error;
  return data;
}

test.beforeAll(async () => {
  olive = await createUser("Olive");
  pat = await createUser("Pat");
  quin = await createUser("Quin");
  outsider = await createUser("Xena");
});

test.afterAll(async () => {
  const ids = [olive, pat, quin, outsider].filter(Boolean).map((u) => u.id);
  // Deleting a household cascades to its bills, periods and expenses (D14).
  await admin.from("households").delete().in("created_by", ids);
  await admin.from("profiles").delete().in("id", ids);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
});

test("add a bill with the form, see its month-end dates, and find it due today", async ({
  page,
}) => {
  const home = await newHome("Add");
  const today = todayIn(TZ);
  await signIn(page, olive);
  await page.goto(`/households/${home.id}`);
  await expect(section(page, "Bills").getByText(/No bills yet/)).toBeVisible();
  await section(page, "Bills")
    .getByRole("link", { name: "Add a bill" })
    .click();
  await expect(heading(page, "Add a bill")).toBeVisible();

  await field(page, "What is it?").fill("Rent");
  await field(page, "Expected amount (INR)").fill("20000");
  await field(page, "Category").selectOption("rent");
  await expect(field(page, "How often is it due?")).toHaveValue("monthly");
  // D10: a bill on the 31st falls on the last day of shorter months.
  await field(page, "First due date").fill("2027-01-31");
  await expect(
    visible(
      page,
      "Due on 31 Jan 2027, 28 Feb 2027, 31 Mar 2027, 30 Apr 2027, and so on.",
    ),
  ).toBeVisible();
  await field(page, "How often is it due?").selectOption("quarterly");
  await expect(
    visible(
      page,
      "Due on 31 Jan 2027, 30 Apr 2027, 31 Jul 2027, 31 Oct 2027, and so on.",
    ),
  ).toBeVisible();
  await field(page, "How often is it due?").selectOption("monthly");

  // Validation, near each field.
  await field(page, "First due date").fill(addDays(today, -400));
  await field(page, "Expected amount (INR)").fill("0");
  await page.getByRole("button", { name: "Save bill" }).click();
  await expect(
    visible(page, "Choose a date within the past year."),
  ).toBeVisible();
  await expect(
    visible(page, "Enter an amount greater than zero."),
  ).toBeVisible();
  // What was chosen is still chosen, and what the dates follow from.
  await expect(field(page, "Category")).toHaveValue("rent");
  await expect(field(page, "How often is it due?")).toHaveValue("monthly");

  await field(page, "Expected amount (INR)").fill("20000");
  await field(page, "First due date").fill(today);
  await page.getByRole("button", { name: "Save bill" }).click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}\?created=1$/);
  await expect(heading(page, "Rent")).toBeVisible();
  await expect(page.getByText(/The bill is saved/)).toBeVisible();
  const periods = section(page, "Periods");
  await expect(periods.getByText(`Due ${formatDate(today)}`)).toBeVisible();
  await expect(periods.getByText("Due today", { exact: true })).toBeVisible();

  // On the bills page, and as the Household page's reminder.
  await page.goto(`/households/${home.id}/bills`);
  await expect(heading(page, "Bills")).toBeVisible();
  const due = section(page, "Due today");
  await expect(
    due.getByRole("link", { name: "Rent", exact: true }),
  ).toBeVisible();
  await expect(due).toContainText("₹20,000.00");
  await expect(due).toContainText("Usually paid by you");
  await page.goto(`/households/${home.id}`);
  await expect(
    section(page, "Bills").getByText("1 bill due today"),
  ).toBeVisible();
  // Nothing counts yet: a bill is a reminder, not an expense.
  await page.goto(`/households/${home.id}/expenses`);
  await expect(visible(page, "No expenses yet")).toBeVisible();
});

test("record a period through the pre-filled expense form, for what it actually came to", async ({
  page,
}) => {
  const home = await newHome("Record");
  const today = todayIn(TZ);
  await addBill(home.id, { title: "Electricity", firstDueOn: today });
  await signIn(page, pat);
  await page.goto(`/households/${home.id}/bills`);
  await section(page, "Due today")
    .getByRole("link", { name: `Record Electricity due ${formatDate(today)}` })
    .click();
  await expect(heading(page, "Record Electricity")).toBeVisible();

  // Pre-filled from the bill: the expense form, as when adding an expense.
  await expect(field(page, "What was it for?")).toHaveValue("Electricity");
  await expect(field(page, "Amount (INR)")).toHaveValue("2000.00");
  await expect(field(page, "Category")).toHaveValue("utilities");
  await expect(field(page, "Paid by")).toHaveValue(olive.id);
  // Pat paid this time. A typo comes back with an error, and the choices are
  // still there (a select used to fall back to its default, silently).
  const quinsTick = page
    .getByRole("checkbox", { name: "Quin" })
    .locator("visible=true");
  await field(page, "Paid by").selectOption(pat.id);
  await field(page, "Category").selectOption("other");
  await quinsTick.check();
  await field(page, "Amount (INR)").fill("2150.505");
  await page.getByRole("button", { name: "Record bill" }).click();
  await expect(visible(page, "Use at most 2 decimal places.")).toBeVisible();
  await expect(field(page, "Paid by")).toHaveValue(pat.id);
  await expect(field(page, "Category")).toHaveValue("other");
  await expect(quinsTick).toBeChecked();
  await expect(field(page, "Amount (INR)")).toHaveValue("2150.505");
  await quinsTick.uncheck();
  await field(page, "Category").selectOption("utilities");
  await field(page, "Amount (INR)").fill("2150.50");
  await expect(visible(page, "Split equally between 2 people.")).toBeVisible();
  await page.getByRole("button", { name: "Record bill" }).click();
  await page.waitForURL(new RegExp(`\\?recorded=${today}$`));
  await expect(page.getByText(/is recorded as an expense/)).toBeVisible();

  const periods = section(page, "Periods");
  await expect(
    periods.getByText("Paid on time", { exact: true }),
  ).toBeVisible();
  await expect(periods).toContainText("₹2,150.50");
  // The expected amount stays what the bill says.
  await expect(periods).toContainText("Expected ₹2,000.00");
  await periods
    .getByRole("link", {
      name: `View expense for the period due ${formatDate(today)}`,
    })
    .click();
  await expect(heading(page, "Electricity")).toBeVisible();
  await expect(visible(page, "₹2,150.50")).toBeVisible();
  await expect(page.locator("dl").locator("visible=true")).toContainText(
    "Paid byPat",
  );

  // It counts now, once; the bills page lists it as paid.
  await page.goto(`/households/${home.id}/bills`);
  await expect(section(page, "Paid recently")).toContainText("₹2,150.50");
  await expect(section(page, "Due today")).toHaveCount(0);
});

test("skip and undo a period, pause, resume and end a bill", async ({
  page,
}) => {
  const home = await newHome("Lifecycle");
  const today = todayIn(TZ);
  const first = addDays(today, -7);
  const bill = await addBill(home.id, {
    title: "Milk",
    unit: "week",
    firstDueOn: first,
  });
  await signIn(page, olive);
  await page.goto(`/households/${home.id}/bills/${bill}`);
  await expect(heading(page, "Milk")).toBeVisible();
  const periods = section(page, "Periods");
  await expect(periods.getByText("Overdue", { exact: true })).toBeVisible();

  await page
    .getByRole("button", { name: `Skip the period due ${formatDate(first)}` })
    .click();
  let dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Nothing is recorded");
  await dialog.getByRole("button", { name: "Skip period" }).click();
  await expect(periods.getByText("Skipped", { exact: true })).toBeVisible();
  await expect(periods.getByText(/Skipped by you on/)).toBeVisible();

  await page
    .getByRole("button", {
      name: `Undo skip of the period due ${formatDate(first)}`,
    })
    .click();
  dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Undo skip" }).click();
  await expect(periods.getByText("Overdue", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Pause bill" }).click();
  dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Pause bill" }).click();
  await expect(visible(page, "Paused")).toBeVisible();
  // While paused nothing new comes, but what has come stays open.
  await expect(periods.getByText("Upcoming", { exact: true })).toHaveCount(0);
  await expect(periods.getByText("Overdue", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Resume bill" }).click();
  dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Resume bill" }).click();
  await expect(visible(page, "Active")).toBeVisible();
  await expect(periods.getByText("Upcoming", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "End bill" }).click();
  dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("No period after today will come");
  await dialog.getByRole("button", { name: "End bill" }).click();
  await expect(visible(page, "Ended")).toBeVisible();
  await expect(periods.getByText("Upcoming", { exact: true })).toHaveCount(0);

  // Each change is in the household journal, under Bills.
  await page.goto(`/households/${home.id}/journal?show=bills`);
  await expect(heading(page, "Household journal")).toBeVisible();
  for (const title of [
    "You ended a bill",
    "You resumed a bill",
    "You paused a bill",
    "You undid skipping a bill period",
    "You skipped a bill period",
    "You added a bill",
  ]) {
    await expect(visible(page, title)).toBeVisible();
  }
});

test("only the right people can change a bill; anyone can record; outsiders see nothing", async ({
  page,
}) => {
  const home = await newHome("Access");
  const today = todayIn(TZ);
  const bill = await addBill(home.id, { title: "Internet", firstDueOn: today });
  // Quin didn't add it, doesn't pay it and isn't the owner (D27, proposed).
  await signIn(page, quin);
  await page.goto(`/households/${home.id}/bills/${bill}`);
  await expect(heading(page, "Internet")).toBeVisible();
  await expect(
    page.getByText(/Anyone in the household can record a period/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause bill" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Skip the period/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", {
      name: `Record the period due ${formatDate(today)}`,
    }),
  ).toBeVisible();
  await page.goto(`/households/${home.id}/bills/${bill}/edit`);
  await expect(visible(page, "You can't edit this bill")).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, outsider);
  await page.goto(`/households/${home.id}/bills`);
  await expect(visible(page, /couldn't find that household/)).toBeVisible();
  // The bill's own 404: the same answer as for a bill that doesn't exist.
  await page.goto(`/households/${home.id}/bills/${bill}`);
  await expect(visible(page, /couldn't find that bill/)).toBeVisible();
  expect(await page.content()).not.toContain("Internet");
  await page.goto(`/households/${home.id}/bills/${randomUUID()}`);
  await expect(visible(page, /couldn't find that bill/)).toBeVisible();
});

test("the bills page fits a 360px phone", async ({ page }) => {
  const home = await newHome("Phone");
  const today = todayIn(TZ);
  await addBill(home.id, {
    title:
      "A bill with a long name that has to wrap or be cut short on a phone",
    firstDueOn: addDays(today, -1),
  });
  await addBill(home.id, { title: "Water", firstDueOn: addDays(today, 3) });
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page, pat);
  await page.goto(`/households/${home.id}/bills`);
  await expect(heading(page, "Bills")).toBeVisible();
  await expect(section(page, "Overdue")).toBeVisible();
  await expect(section(page, "Due in the next 7 days")).toContainText("Water");
  await noHorizontalOverflow(page);
  const bar = page.locator('nav[aria-label="Main"]').locator("visible=true");
  await expect(bar.getByRole("link")).toHaveCount(5);
  await expect(bar.getByRole("link", { name: "Household" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
