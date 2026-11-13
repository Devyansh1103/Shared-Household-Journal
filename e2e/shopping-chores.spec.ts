// The shopping list and chores in a real browser (roadmap Phase 15): adding
// items one after another, a mistake that keeps what was chosen, buying and
// reopening, editing, removing with a confirmation, the filters in the URL;
// adding a chore with the form, overdue and due-today worked out from the
// household's date, My tasks, completing and reopening, who can change a
// chore (D28, proposed), reassigning; the Household page's counts, the
// journal's Shopping and Chores filters, a non-member, and a 360px phone.
// Each test gets its own household; throwaway users and households are
// removed afterwards.

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
    .filter({ has: page.getByRole("heading", { level: 2, name, exact: true }) })
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

async function addChore(
  user: User,
  householdId: string,
  input: {
    title: string;
    assignee?: User;
    dueOn?: string;
    priority?: "low" | "high";
  },
) {
  const { data, error } = await user.client.rpc("create_chore", {
    target_household_id: householdId,
    chore_title: input.title,
    ...(input.assignee ? { chore_assignee_id: input.assignee.id } : {}),
    ...(input.dueOn ? { chore_due_on: input.dueOn } : {}),
    ...(input.priority ? { chore_priority_level: input.priority } : {}),
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
  // Deleting a household cascades to its items, chores and journal (D14).
  await admin.from("households").delete().in("created_by", ids);
  await admin.from("profiles").delete().in("id", ids);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
});

test("add items one after another, buy one, put it back, edit and remove", async ({
  page,
}) => {
  const home = await newHome("Shopping");
  await signIn(page, olive);
  await page.goto(`/households/${home.id}`);
  const summary = section(page, "Shopping");
  await expect(
    summary.getByText("Nothing on the list right now."),
  ).toBeVisible();
  await summary.getByRole("link", { name: "Shopping list" }).click();
  await expect(heading(page, "Shopping list")).toBeVisible();
  await expect(visible(page, "The list is empty")).toBeVisible();

  // A mistake comes back near the field, and the choice of person stays.
  await field(page, "Quantity (optional)").fill("2 litres");
  await field(page, "Who's getting it? (optional)").selectOption(pat.id);
  await page.getByRole("button", { name: "Add to the list" }).click();
  await expect(visible(page, "Say what's needed, like “Milk”.")).toBeVisible();
  await expect(field(page, "Who's getting it? (optional)")).toHaveValue(pat.id);
  await expect(field(page, "Quantity (optional)")).toHaveValue("2 litres");

  await field(page, "Item").fill("Milk");
  await page.getByRole("button", { name: "Add to the list" }).click();
  await expect(
    visible(page, "Added Milk (2 litres) to the list."),
  ).toBeVisible();
  // The form is empty again, ready for the next item.
  await expect(field(page, "Item")).toHaveValue("");
  await expect(field(page, "Who's getting it? (optional)")).toHaveValue("");
  await field(page, "Item").fill("Bread");
  await page.getByRole("button", { name: "Add to the list" }).click();
  await expect(visible(page, "Added Bread to the list.")).toBeVisible();

  const needed = section(page, "Still needed");
  await expect(needed.getByRole("listitem")).toHaveCount(2);
  await expect(needed.getByRole("listitem").first()).toContainText("Milk");
  await expect(needed.getByRole("listitem").first()).toContainText(
    "For Pat to get · Added by you",
  );

  // Bought, then back on the list: named buttons (WCAG 2.5.3).
  await needed
    .getByRole("button", { name: "Mark bought: Milk (2 litres)" })
    .click();
  await expect(page.getByText("Milk is marked as bought.")).toBeVisible();
  await expect(needed.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("link", { name: "Bought", exact: true }).click();
  await page.waitForURL(/\?show=purchased$/);
  const bought = section(page, "Bought");
  await expect(bought.getByRole("listitem")).toHaveCount(1);
  await expect(bought).toContainText("bought by you");
  await bought
    .getByRole("button", { name: "Still needed: Milk (2 litres)" })
    .click();
  await expect(page.getByText("Milk is back on the list.")).toBeVisible();
  await expect(
    bought.getByText("Nothing bought matches this filter."),
  ).toBeVisible();

  // Edit it.
  await page.goto(`/households/${home.id}/shopping`);
  await section(page, "Still needed")
    .getByRole("link", { name: "Edit: Milk (2 litres)" })
    .click();
  await expect(heading(page, "Edit item")).toBeVisible();
  await expect(field(page, "Who's getting it? (optional)")).toHaveValue(pat.id);
  await field(page, "Item").fill("Oat milk");
  await field(page, "Note (optional)").fill("Unsweetened");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(/\/shopping\?updated=1$/);
  await expect(page.getByText("The item is saved.")).toBeVisible();
  await expect(section(page, "Still needed")).toContainText("Unsweetened");

  // Remove it, after saying so.
  await section(page, "Still needed")
    .getByRole("button", { name: "Remove: Bread" })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("heading", { name: "Remove Bread from the list?" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Remove item" }).click();
  await expect(page.getByText("Bread is off the list.")).toBeVisible();
  await expect(section(page, "Still needed").getByRole("listitem")).toHaveCount(
    1,
  );

  // The Household page counts what's left; the journal has every change.
  await page.goto(`/households/${home.id}`);
  await expect(section(page, "Shopping")).toContainText("1 item still needed.");
  await page.goto(`/households/${home.id}/journal?show=shopping`);
  await expect(
    page
      .getByRole("navigation", { name: "Show in the journal" })
      .getByRole("link", { name: "Shopping" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    visible(page, "You removed an item from the shopping list"),
  ).toBeVisible();
  await expect(
    visible(page, "You changed an item on the shopping list"),
  ).toBeVisible();
  await expect(
    visible(page, "You bought an item on the shopping list"),
  ).toBeVisible();
  await expect(
    visible(page, "You put an item back on the shopping list"),
  ).toBeVisible();
  await expect(
    visible(page, "You added an item to the shopping list"),
  ).toHaveCount(2);
  // Notes stay out of the journal.
  await expect(page.getByText("Unsweetened")).toHaveCount(0);
});

test("the list's filters live in the URL", async ({ page }) => {
  const home = await newHome("Filters");
  for (const [name, assignee] of [
    ["Rice", olive],
    ["Tea", pat],
    ["Salt", null],
  ] as const) {
    const { error } = await olive.client.rpc("add_shopping_item", {
      target_household_id: home.id,
      item_name: name,
      ...(assignee ? { item_assignee_id: assignee.id } : {}),
    });
    if (error) throw error;
  }
  await signIn(page, pat);
  const base = `/households/${home.id}/shopping`;
  const rows = () => section(page, "Still needed").getByRole("listitem");

  await page.goto(base);
  await expect(rows()).toHaveCount(3);
  const whose = page.getByRole("navigation", { name: "Whose items" });
  await whose.getByRole("link", { name: "Mine" }).click();
  await page.waitForURL(/\?who=me$/);
  await expect(whose.getByRole("link", { name: "Mine" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(rows()).toHaveCount(1);
  await expect(rows().first()).toContainText("Tea");
  await whose.getByRole("link", { name: "Olive" }).click();
  await page.waitForURL(new RegExp(`\\?who=${olive.id}$`));
  await expect(rows().first()).toContainText("Rice");
  await page.goto(`${base}?who=nobody&show=all`);
  await expect(rows()).toHaveCount(1);
  await expect(rows().first()).toContainText("Salt");
  // Something that isn't a person or a view is ignored.
  await page.goto(`${base}?who=someone&show=everything`);
  await expect(rows()).toHaveCount(3);
});

test("add a chore with the form and see it by when it's due", async ({
  page,
}) => {
  const home = await newHome("Chores");
  const today = todayIn(TZ);
  await addChore(olive, home.id, { title: "Water the plants", dueOn: today });
  await addChore(olive, home.id, {
    title: "Clean the fridge",
    dueOn: addDays(today, 5),
    priority: "low",
  });
  await signIn(page, pat);
  await page.goto(`/households/${home.id}`);
  await section(page, "Chores").getByRole("link", { name: "Chores" }).click();
  await expect(heading(page, "Chores")).toBeVisible();
  await page.getByRole("link", { name: "Add a chore" }).click();
  await expect(heading(page, "Add a chore")).toBeVisible();

  await field(page, "Who's doing it? (optional)").selectOption(quin.id);
  await field(page, "Priority").selectOption("high");
  await field(page, "Due date (optional)").fill(addDays(today, -1));
  await page.getByRole("button", { name: "Add chore" }).click();
  await expect(
    visible(page, "Say what needs doing, like “Take out the bins”."),
  ).toBeVisible();
  // What was chosen is still chosen.
  await expect(field(page, "Who's doing it? (optional)")).toHaveValue(quin.id);
  await expect(field(page, "Priority")).toHaveValue("high");
  await field(page, "What needs doing?").fill("Take out the bins");
  await field(page, "Details (optional)").fill("Blue bin first");
  await page.getByRole("button", { name: "Add chore" }).click();
  await page.waitForURL(/\/chores\?created=1$/);
  await expect(page.getByText("The chore is added.")).toBeVisible();

  // Overdue and due today, in words as well as colour.
  const overdue = section(page, "Overdue");
  await expect(overdue).toContainText("Take out the bins");
  await expect(
    overdue.getByRole("listitem").getByText("Overdue", { exact: true }),
  ).toBeVisible();
  await expect(overdue.getByText("High priority")).toBeVisible();
  await expect(overdue).toContainText(
    `For Quin · due ${formatDate(addDays(today, -1))} (1 day overdue) · added by you`,
  );
  await expect(section(page, "Due today")).toContainText("Water the plants");
  await expect(section(page, "Upcoming")).toContainText("Clean the fridge");
  await expect(
    section(page, "Upcoming").getByText("Low priority"),
  ).toBeVisible();
  await expect(
    page.getByText(/doesn't send reminders or notifications/),
  ).toBeVisible();

  // Pat added it, so Pat may complete it, then reopen it.
  await overdue
    .getByRole("button", { name: "Mark done: Take out the bins" })
    .click();
  await expect(page.getByText("Take out the bins is done.")).toBeVisible();
  await expect(section(page, "Overdue")).toHaveCount(0);
  await page.goto(`/households/${home.id}/chores?show=completed`);
  const done = section(page, "Done");
  await expect(done).toContainText("Done by you");
  await done
    .getByRole("button", { name: "Not done: Take out the bins" })
    .click();
  await expect(
    page.getByText("Take out the bins is back on the to-do list."),
  ).toBeVisible();

  // Priority filter.
  await page.goto(`/households/${home.id}/chores?priority=low`);
  await expect(page.getByText("Clean the fridge")).toBeVisible();
  await expect(page.getByText("Water the plants")).toHaveCount(0);
});

test("who can change a chore, My tasks, and reassigning", async ({ page }) => {
  const home = await newHome("Rights");
  const today = todayIn(TZ);
  await addChore(olive, home.id, { title: "Olive's laundry", assignee: olive });
  await addChore(olive, home.id, {
    title: "Hoover",
    assignee: quin,
    dueOn: today,
  });
  await addChore(olive, home.id, { title: "Descale the kettle" });

  // Pat neither added nor has Olive's laundry: no buttons, and why.
  await signIn(page, pat);
  await page.goto(`/households/${home.id}/chores`);
  const anyTime = section(page, "Any time");
  const laundry = anyTime
    .getByRole("listitem")
    .filter({ hasText: "Olive's laundry" });
  await expect(laundry.getByRole("button")).toHaveCount(0);
  await expect(laundry).toContainText(
    "Only Olive, the person who added it or the owner can change this chore.",
  );
  // Anyone can pick up a chore that's assigned to nobody.
  const kettle = anyTime
    .getByRole("listitem")
    .filter({ hasText: "Descale the kettle" });
  await expect(
    kettle.getByRole("button", { name: "Mark done: Descale the kettle" }),
  ).toBeVisible();
  await expect(kettle.getByRole("link", { name: /^Edit/ })).toHaveCount(0);
  // The edit page says so too (the database refuses anyway).
  const { data: rows } = await admin
    .from("chores")
    .select("id, title")
    .eq("household_id", home.id);
  const laundryId = rows!.find((r) => r.title === "Olive's laundry")!.id;
  await page.goto(`/households/${home.id}/chores/${laundryId}/edit`);
  await expect(visible(page, "You can't edit this chore")).toBeVisible();

  // Quin sees Hoover under My tasks.
  await page.context().clearCookies();
  await signIn(page, quin);
  await page.goto(`/households/${home.id}/chores`);
  await expect(section(page, "My tasks")).toContainText("Hoover");
  await expect(
    section(page, "My tasks").getByText("Due today", { exact: true }),
  ).toBeVisible();

  // Olive, the owner, reassigns it to Pat.
  await page.context().clearCookies();
  await signIn(page, olive);
  await page.goto(`/households/${home.id}/chores`);
  await page.getByRole("link", { name: "Edit: Hoover" }).click();
  await expect(heading(page, "Edit chore")).toBeVisible();
  await field(page, "Who's doing it? (optional)").selectOption(pat.id);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(/\/chores\?updated=1$/);
  await expect(section(page, "Due today")).toContainText("For Pat");

  await page.goto(`/households/${home.id}/journal?show=chores`);
  await expect(visible(page, "You changed a chore")).toBeVisible();
  const change = page
    .getByRole("listitem")
    .filter({ hasText: /^Assigned to:/ })
    .locator("visible=true");
  await expect(change).toContainText("Quin");
  await expect(change).toContainText("Pat");
});

test("a non-member sees neither the list nor the chores", async ({ page }) => {
  const home = await newHome("Private");
  const item = await olive.client.rpc("add_shopping_item", {
    target_household_id: home.id,
    item_name: "Secret snacks",
  });
  const chore = await addChore(olive, home.id, { title: "Secret chore" });
  await signIn(page, outsider);
  for (const path of ["shopping", "chores", "chores/new"]) {
    await page.goto(`/households/${home.id}/${path}`);
    await expect(visible(page, /couldn't find that household/)).toBeVisible();
  }
  await page.goto(`/households/${home.id}/shopping/${item.data}/edit`);
  await expect(visible(page, /couldn't find that item/)).toBeVisible();
  await page.goto(`/households/${home.id}/chores/${chore}/edit`);
  await expect(visible(page, /couldn't find that chore/)).toBeVisible();
  expect(await page.content()).not.toContain("Secret");
});

test("the list and the chores fit a 360px phone", async ({ page }) => {
  const home = await newHome("Phone");
  const today = todayIn(TZ);
  await olive.client.rpc("add_shopping_item", {
    target_household_id: home.id,
    item_name:
      "A very long item name that keeps going to test wrapping on a phone",
    item_quantity: "a really big bag",
    item_assignee_id: pat.id,
  });
  await addChore(olive, home.id, {
    title:
      "A chore with a long title that should wrap neatly on a small screen",
    assignee: pat,
    dueOn: addDays(today, -3),
    priority: "high",
  });
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page, pat);
  await page.goto(`/households/${home.id}/shopping`);
  await expect(heading(page, "Shopping list")).toBeVisible();
  await noHorizontalOverflow(page);
  await page.goto(`/households/${home.id}/chores`);
  await expect(section(page, "My tasks")).toBeVisible();
  await noHorizontalOverflow(page);
  // The bottom bar keeps Household current here.
  const bar = page.locator('nav[aria-label="Main"]').locator("visible=true");
  await expect(bar.getByRole("link")).toHaveCount(5);
  await expect(bar.getByRole("link", { name: "Household" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
