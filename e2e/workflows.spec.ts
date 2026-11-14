// End-to-end workflows for the production-readiness review (roadmap Phase
// 18), in a real browser against a production build:
//
// A. Sign up in the app, confirm the email from the message Supabase sends
//    (caught by the local Mailpit), and arrive home signed in.
// B. Create a household in the app, create an invite link, and have someone
//    else join with it.
// D. Add an expense, see the balance, record the payment back, and see the
//    balances settle while the expense itself stays exactly as it was.
// G. Someone outside a household opens every page of it by URL: each says it
//    can't find it, and shows nothing of it.
// And the hardening: the security headers on every response, no
// X-Powered-By, session cookies that scripts can't read, the health check,
// and no Content Security Policy violations on any page these tests visit.
// (The other workflows, C and E–F, are covered by the module specs.)
//
// Throwaway users and households are removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  adminClient,
  mailpitUrl,
  signedInClient,
  type TypedClient,
} from "../supabase/tests/support/local-supabase";

const admin = adminClient();
const password = `e2e-${randomUUID()}`;
const run = randomUUID().slice(0, 6);
const TZ = "Asia/Kolkata";

type User = { id: string; email: string; name: string; client: TypedClient };
const created: string[] = [];
let olive: User, pat: User, xena: User;

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
    name,
    client: await signedInClient(email, password),
  };
}

/** Collects Content Security Policy violations the browser reports. */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  return violations;
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

async function confirmationPath(to: string): Promise<string> {
  const base = mailpitUrl();
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = (await fetch(
      `${base}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
    ).then((r) => r.json())) as { messages?: { ID: string }[] };
    for (const { ID } of search.messages ?? []) {
      const message = (await fetch(`${base}/api/v1/message/${ID}`).then((r) =>
        r.json(),
      )) as { HTML: string };
      const href = /href="([^"]*\/auth\/confirm\?[^"]*)"/.exec(
        message.HTML,
      )?.[1];
      if (!href) continue;
      // The link names the configured site URL; open it on this server.
      const url = new URL(href.replaceAll("&amp;", "&"));
      if (url.searchParams.get("type") === "email")
        return `${url.pathname}${url.search}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("No confirmation email arrived");
}

/** The session cookie (split into numbered chunks when it's long). */
async function sessionCookies(context: BrowserContext) {
  return (await context.cookies()).filter((c) =>
    /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(c.name),
  );
}

test.beforeAll(async () => {
  olive = await createUser(`Olive`);
  pat = await createUser(`Pat`);
  xena = await createUser(`Xena`);
});

test.afterAll(async () => {
  // Households cascade to everything in them (D14).
  await admin.from("households").delete().in("created_by", created);
  await admin.from("profiles").delete().in("id", created);
  for (const id of created) await admin.auth.admin.deleteUser(id);
});

test("A: sign up, confirm the email, and arrive home signed in", async ({
  page,
  context,
}) => {
  const csp = watchCsp(page);
  const name = `Sam ${run}`;
  const email = `e2e-${randomUUID().slice(0, 8)}-signup@example.com`;

  await page.goto("/sign-up");
  await expect(heading(page, "Create an account")).toBeVisible();
  await field(page, "Your name").fill(name);
  await field(page, "Email").fill(email);
  await field(page, "Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  // Wait for the answer: React resets the form once the action finishes.
  await expect(visible(page, "Use at least 8 characters.")).toBeVisible();
  await expect(field(page, "Your name")).toHaveValue(name);
  await field(page, "Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    visible(
      page,
      `We've sent a confirmation link to ${email}. Open it to finish creating your account.`,
    ),
  ).toBeVisible();
  // Not signed in until the email is confirmed.
  expect(await sessionCookies(context)).toEqual([]);

  const client = await signedInClient(email, password).catch(() => null);
  expect(client, "an unconfirmed account can't sign in").toBeNull();

  await page.goto(await confirmationPath(email));
  await page.waitForURL("**/home?confirmed=1");
  await expect(
    visible(page, "Your email is confirmed. Welcome aboard!"),
  ).toBeVisible();
  await expect(heading(page, `Welcome, ${name}`)).toBeVisible();
  await expect(visible(page, "You're not in a household yet")).toBeVisible();

  const confirmed = await signedInClient(email, password);
  const { data } = await confirmed.auth.getUser();
  created.push(data.user!.id);

  await page.goto("/profile");
  await expect(heading(page, "Your profile")).toBeVisible();
  await expect(field(page, "Your name")).toHaveValue(name);

  // No Supabase cookie, the session or a sign-up's code verifier, can be read
  // by scripts in the page.
  expect(await sessionCookies(context)).not.toHaveLength(0);
  const cookies = (await context.cookies()).filter((c) =>
    c.name.startsWith("sb-"),
  );
  for (const cookie of cookies) {
    expect(cookie, cookie.name).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
    });
  }
  expect(await page.evaluate(() => document.cookie)).not.toContain("sb-");

  // A used link doesn't work twice.
  await context.clearCookies();
  await page.goto(await confirmationPath(email));
  await page.waitForURL("**/sign-in?error=invalid_link");
  expect(csp).toEqual([]);
});

test("B: create a household, invite someone, and they join", async ({
  page,
  browser,
}) => {
  const csp = watchCsp(page);
  const name = `Flat ${run}`;
  await signIn(page, olive);
  await page.getByRole("link", { name: "Create a household" }).first().click();
  await expect(heading(page, "Create a household")).toBeVisible();
  await field(page, "Household name").fill(name);
  await field(page, "Currency").selectOption("INR");
  await field(page, "Timezone").selectOption(TZ);
  await page.getByRole("button", { name: "Create household" }).click();
  await page.waitForURL(/\/households\/[0-9a-f-]{36}\?created=1/);
  await expect(heading(page, name)).toBeVisible();
  const householdId = /households\/([0-9a-f-]{36})/.exec(page.url())![1];
  await expect(section(page, "Members")).toContainText("Just you so far.");

  await page.goto("/home");
  const card = page.getByRole("link", { name: new RegExp(name) });
  await expect(card).toContainText("Owner");
  await expect(card).toContainText("1 member");
  await card.click();
  await expect(heading(page, name)).toBeVisible();

  const invite = section(page, "Invite someone");
  await invite.getByRole("button", { name: "Create invite link" }).click();
  const linkField = invite.getByLabel("Invite link");
  await expect(linkField).toHaveValue(/\/invite\/[A-Za-z0-9_-]+$/);
  const link = new URL(await linkField.inputValue());

  // Pat, in their own browser, opens the link.
  const other = await browser.newContext();
  const patPage = await other.newPage();
  const patCsp = watchCsp(patPage);
  await patPage.goto(link.pathname);
  await expect(
    heading(patPage, "You've been invited to a household"),
  ).toBeVisible();
  // Signed out, the page says nothing about the household.
  expect(await patPage.content()).not.toContain(name);
  await signIn(patPage, pat);
  await patPage.goto(link.pathname);
  await expect(heading(patPage, `Join ${name}`)).toBeVisible();
  await expect(
    visible(patPage, /Olive invited you to join this household/),
  ).toBeVisible();
  await patPage.getByRole("button", { name: "Join household" }).click();
  await patPage.waitForURL(new RegExp(`/households/${householdId}\\?`));
  await expect(heading(patPage, name)).toBeVisible();
  const members = section(patPage, "Members");
  await expect(members).toContainText("2 people live here.");
  await expect(members).toContainText("Pat (you)");
  await expect(members).toContainText("Olive");
  expect(patCsp).toEqual([]);
  await other.close();

  await page.reload();
  await expect(section(page, "Members")).toContainText("2 people live here.");
  const { data: rows } = await admin
    .from("household_members")
    .select("user_id, role, left_at")
    .eq("household_id", householdId)
    .order("role"); // the enum's order: owner, then member
  expect(rows).toEqual([
    { user_id: olive.id, role: "owner", left_at: null },
    { user_id: pat.id, role: "member", left_at: null },
  ]);
  expect(csp).toEqual([]);
});

test("D: an expense, its balance, the payment back, and the expense unchanged", async ({
  page,
}) => {
  const csp = watchCsp(page);
  const home = await olive.client.rpc("create_household", {
    household_name: `Settle ${run}`,
    currency: "INR",
    time_zone: TZ,
  });
  if (home.error) throw home.error;
  const H = home.data;
  const bytes = randomBytes(32);
  const insert = await olive.client.from("invitations").insert({
    household_id: H,
    token_hash: createHash("sha256").update(bytes).digest("hex"),
  });
  if (insert.error) throw insert.error;
  const joined = await pat.client.rpc("accept_invite", {
    token: bytes.toString("base64url"),
  });
  if (joined.error) throw joined.error;

  // Olive adds the expense in the app.
  await signIn(page, olive);
  await page.goto(`/households/${H}/expenses/new`);
  await field(page, "What was it for?").fill("Internet");
  await field(page, "Amount (INR)").fill("900");
  await field(page, "Category").selectOption("internet");
  await expect(visible(page, "Split equally between 2 people.")).toBeVisible();
  await page.getByRole("button", { name: "Save expense" }).click();
  await page.waitForURL(/\/expenses\/([0-9a-f-]{36})\?created=1/);
  const expenseId = /expenses\/([0-9a-f-]{36})/.exec(page.url())![1];
  const before = await admin
    .from("expenses")
    .select("*, expense_splits(user_id, share_minor, percentage_bp)")
    .eq("id", expenseId)
    .single();
  expect(before.data).toMatchObject({ amount_minor: 90000, paid_by: olive.id });

  // Pat sees what they owe and records paying it back.
  await page.context().clearCookies();
  await signIn(page, pat);
  await page.goto(`/households/${H}/balances`);
  await expect(visible(page, "You owe ₹450.00.")).toBeVisible();
  await section(page, "Who owes whom")
    .getByRole("link", { name: "Record a payment to Olive" })
    .click();
  await expect(field(page, "Amount (INR)")).toHaveValue("450.00");
  await page.getByRole("button", { name: "Review payment" }).click();
  await expect(visible(page, "You paid Olive ₹450.00.")).toBeVisible();
  await page.getByRole("button", { name: "Record payment" }).click();
  await page.waitForURL(/\/settlements\/[0-9a-f-]{36}\?recorded=1/);

  await page.goto(`/households/${H}/balances`);
  await expect(visible(page, "You're settled up.")).toBeVisible();

  // The expense is exactly as it was (D8).
  await page.goto(`/households/${H}/expenses/${expenseId}`);
  await expect(heading(page, "Internet")).toBeVisible();
  await expect(visible(page, "₹900.00").first()).toBeVisible();
  await expect(visible(page, "Split equally")).toBeVisible();
  const after = await admin
    .from("expenses")
    .select("*, expense_splits(user_id, share_minor, percentage_bp)")
    .eq("id", expenseId)
    .single();
  expect(after.data).toEqual(before.data);
  expect(csp).toEqual([]);
});

test("G: another household's pages, opened by URL, show nothing of it", async ({
  page,
}) => {
  const csp = watchCsp(page);
  const secret = `Hidden ${run}`;
  const home = await olive.client.rpc("create_household", {
    household_name: secret,
    currency: "INR",
    time_zone: TZ,
  });
  if (home.error) throw home.error;
  const H = home.data;
  const today = new Date().toISOString().slice(0, 10);
  const shares = [
    { user_id: olive.id, share_minor: 4321, percentage_bp: null },
  ];
  const ids = {
    expense: await olive.client.rpc("create_expense", {
      target_household_id: H,
      title: `${secret} expense`,
      amount: 4321,
      expense_category: "dining",
      spent_on: today,
      payer_id: olive.id,
      method: "equal",
      shares,
    }),
    bill: await olive.client.rpc("create_recurring_bill", {
      target_household_id: H,
      title: `${secret} bill`,
      amount: 4321,
      bill_category: "rent",
      bill_payer_id: olive.id,
      method: "equal",
      shares,
      repeat_unit: "month",
      repeat_every: 1,
      first_due_on: today,
    }),
    item: await olive.client.rpc("add_shopping_item", {
      target_household_id: H,
      item_name: `${secret} item`,
    }),
    chore: await olive.client.rpc("create_chore", {
      target_household_id: H,
      chore_title: `${secret} chore`,
    }),
    budget: await olive.client.rpc("create_budget", {
      target_household_id: H,
      budget_kind: "month",
      budget_limit: 432100,
    }),
  };
  for (const result of Object.values(ids)) if (result.error) throw result.error;
  const [E, B, I, C, G] = [
    ids.expense,
    ids.bill,
    ids.item,
    ids.chore,
    ids.budget,
  ].map((r) => r.data as string);
  // A settlement needs two people; any id stands in for one that isn't Xena's.
  const S = randomUUID();

  const base = `/households/${H}`;
  const pages = [
    base,
    `${base}/expenses`,
    `${base}/expenses/new`,
    `${base}/expenses/${E}`,
    `${base}/expenses/${E}/edit`,
    `${base}/balances`,
    `${base}/balances/${olive.id}`,
    `${base}/settlements`,
    `${base}/settlements/new`,
    `${base}/settlements/${S}`,
    `${base}/journal`,
    `${base}/bills`,
    `${base}/bills/new`,
    `${base}/bills/${B}`,
    `${base}/bills/${B}/edit`,
    `${base}/bills/${B}/record`,
    `${base}/bills/${B}/schedule`,
    `${base}/shopping`,
    `${base}/shopping/${I}/edit`,
    `${base}/chores`,
    `${base}/chores/new`,
    `${base}/chores/${C}/edit`,
    `${base}/budgets`,
    `${base}/budgets/new`,
    `${base}/budgets/${G}/edit`,
    `${base}/analytics`,
  ];

  await signIn(page, xena);
  for (const path of pages) {
    await page.goto(path);
    await expect(visible(page, /^We couldn't find that/), path).toBeVisible();
    const html = await page.content();
    expect(html, path).not.toContain(secret);
    expect(html, path).not.toContain("43.21");
  }
  expect(csp).toEqual([]);
});

test("every response carries the security headers, and the health check answers", async ({
  request,
}) => {
  for (const path of [
    "/",
    "/sign-in",
    "/home",
    "/households/x",
    "/api/health",
    "/no-such-page",
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();
    const csp = headers["content-security-policy"] ?? "";
    expect(csp, path).toContain("default-src 'self'");
    expect(csp, path).toContain("frame-ancestors 'none'");
    expect(csp, path).toContain("object-src 'none'");
    expect(csp, path).toContain("base-uri 'self'");
    expect(csp, path).toContain("form-action 'self'");
    expect(csp, path).not.toContain("unsafe-eval");
    expect(headers, path).toMatchObject({
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "cross-origin-opener-policy": "same-origin",
      "strict-transport-security": "max-age=63072000",
    });
    expect(headers["permissions-policy"], path).toContain("camera=()");
    expect(headers["x-powered-by"], path).toBeUndefined();
  }

  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(health.headers()["cache-control"]).toContain("no-store");
  expect(await health.json()).toEqual({ status: "ok", database: "ok" });
});
