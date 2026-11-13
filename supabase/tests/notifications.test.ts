// In-app notifications (roadmap Phase 17; D12, ADR-011, D30 decided
// 2026-11-13) as real signed-in users against the local stack: who each real
// event notifies (never the person who did it, never someone who isn't an
// active member), the per-household, per-type switches, no notification from
// a failed or repeated operation, reading and marking only your own, former
// members, what a notification shows (the journal's projection: no notes or
// shares), no direct writes, and deleting the household. Answers are parsed
// and checked with the app's own code (src/lib/notifications/payload.ts).
//
// Needs `npm run db:start`, then `npm run test:db`. Everything is created for
// this run and removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "@/lib/expenses/dates";
import {
  checkNotifications,
  parseNotifications,
  type NotificationsPage,
} from "@/lib/notifications/payload";
import type { Database } from "@/lib/supabase/database.types";
import {
  adminClient,
  anonClient,
  signedInClient,
  type TypedClient,
} from "./support/local-supabase";

type EventType = Database["public"]["Enums"]["activity_event_type"];

const PERMISSION_DENIED = "42501";
const INVALID_SPLIT = "HJ008";

const runId = randomUUID().slice(0, 8);
const password = `notify-${randomUUID()}`;
const admin = adminClient();
const TZ = "Asia/Kolkata";
let today: string;

type User = { id: string; name: string; client: TypedClient };
const users: User[] = [];
let olive: User, pat: User, quin: User, raj: User, xena: User;

function expectError(error: PostgrestError | null, code: string) {
  expect(error, `expected Postgres error ${code}`).not.toBeNull();
  expect(error?.code).toBe(code);
}

async function createUser(name: string): Promise<User> {
  const email = `notify-${runId}-${name.toLowerCase()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  const user = {
    id: data.user.id,
    name,
    client: await signedInClient(email, password),
  };
  users.push(user);
  return user;
}

async function household(owner: User, name: string) {
  const { data, error } = await owner.client.rpc("create_household", {
    household_name: `${name} ${runId}`,
    currency: "INR",
    time_zone: TZ,
  });
  if (error) throw error;
  return data;
}

async function invite(owner: User, householdId: string) {
  const bytes = randomBytes(32);
  const insert = await owner.client.from("invitations").insert({
    household_id: householdId,
    token_hash: createHash("sha256").update(bytes).digest("hex"),
  });
  if (insert.error) throw insert.error;
  return bytes.toString("base64url");
}

async function join(owner: User, householdId: string, ...members: User[]) {
  const token = await invite(owner, householdId);
  for (const member of members) {
    const { error } = await member.client.rpc("accept_invite", { token });
    if (error) throw error;
  }
}

/** An equal split, exactly, in minor units. */
function equal(amount: number, people: User[]) {
  const base = Math.floor(amount / people.length);
  return people.map((p, i) => ({
    user_id: p.id,
    share_minor: i === 0 ? amount - base * (people.length - 1) : base,
    percentage_bp: null,
  }));
}

async function addExpense(
  user: User,
  householdId: string,
  input: {
    amount?: number;
    payer?: User;
    people?: User[];
    key?: string;
    note?: string;
  } = {},
) {
  const amount = input.amount ?? 60000;
  const { data, error } = await user.client.rpc("create_expense", {
    target_household_id: householdId,
    title: "Groceries",
    amount,
    expense_category: "groceries",
    spent_on: today,
    payer_id: (input.payer ?? user).id,
    method: "custom",
    shares: equal(amount, input.people ?? [olive, pat]),
    ...(input.key ? { request_key: input.key } : {}),
  });
  if (error) throw error;
  return data;
}

/** Who the latest event of a type (about an entity, or in a household) notified. */
async function recipients(
  type: EventType,
  where: { entityId?: string; householdId?: string },
) {
  let query = admin
    .from("activity_events")
    .select("id")
    .eq("type", type)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (where.entityId) query = query.eq("entity_id", where.entityId);
  if (where.householdId) query = query.eq("household_id", where.householdId);
  const { data: events, error } = await query;
  if (error) throw error;
  if (!events?.length) throw new Error(`no ${type} event`);
  const { data, error: nError } = await admin
    .from("notifications")
    .select("user_id")
    .eq("activity_event_id", events[0].id);
  if (nError) throw nError;
  const names = new Map(users.map((u) => [u.id, u.name]));
  return data.map((r) => names.get(r.user_id) ?? r.user_id).sort();
}

async function inbox(
  user: User,
  args: Database["public"]["Functions"]["my_notifications"]["Args"] = {},
): Promise<NotificationsPage> {
  const { data, error } = await user.client.rpc("my_notifications", {
    page_size: 100,
    ...args,
  });
  if (error) throw error;
  const page = parseNotifications(data);
  if (!page) throw new Error("my_notifications returned an unexpected shape");
  const check = checkNotifications(page, {
    unreadOnly: args.unread_only ?? false,
    before:
      args.before_us !== undefined && args.before_id
        ? { us: BigInt(args.before_us), id: args.before_id }
        : null,
    pageSize: args.page_size ?? 100,
  });
  if (!check.ok) throw new Error(`my_notifications failed ${check.code}`);
  return page;
}

beforeAll(async () => {
  [olive, pat, quin, raj, xena] = await Promise.all(
    ["Olive", "Pat", "Quin", "Raj", "Xena"].map(createUser),
  );
  today = todayIn(TZ);
}, 60_000);

afterAll(async () => {
  const ids = users.map((u) => u.id);
  if (ids.length) {
    // Households cascade to events, notifications and preferences (D14).
    await admin.from("households").delete().in("created_by", ids);
    await admin.from("profiles").delete().in("id", ids);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  }
});

describe("who an event notifies (D30)", () => {
  let H: string;

  beforeAll(async () => {
    H = await household(olive, "Who");
    await join(olive, H, pat, quin);
  });

  it("membership changes notify everyone else; never the person who acted or left", async () => {
    await join(olive, H, raj);
    expect(await recipients("member_joined", { householdId: H })).toEqual([
      "Olive",
      "Pat",
      "Quin",
    ]);
    expect(
      (await raj.client.rpc("leave_household", { target_household_id: H }))
        .error,
    ).toBeNull();
    expect(await recipients("member_left", { householdId: H })).toEqual([
      "Olive",
      "Pat",
      "Quin",
    ]);
    await join(olive, H, raj);
    expect(
      (
        await olive.client.rpc("remove_member", {
          target_household_id: H,
          member_user_id: raj.id,
        })
      ).error,
    ).toBeNull();
    expect(await recipients("member_removed", { householdId: H })).toEqual([
      "Pat",
      "Quin",
    ]);
    expect(
      (
        await olive.client.rpc("transfer_ownership", {
          target_household_id: H,
          new_owner_user_id: pat.id,
        })
      ).error,
    ).toBeNull();
    expect(
      await recipients("ownership_transferred", { householdId: H }),
    ).toEqual(["Pat", "Quin"]);
    expect(
      (
        await pat.client.rpc("transfer_ownership", {
          target_household_id: H,
          new_owner_user_id: olive.id,
        })
      ).error,
    ).toBeNull();
    // Invite links concern no one.
    await invite(olive, H);
    expect(await recipients("invitation_created", { householdId: H })).toEqual(
      [],
    );
  });

  it("an expense notifies its payer and the people in its split, before and after an edit", async () => {
    // Pat records what Olive paid for Olive and Pat: Olive hears, Quin doesn't.
    const id = await addExpense(pat, H, { payer: olive, people: [olive, pat] });
    expect(await recipients("expense_created", { entityId: id })).toEqual([
      "Olive",
    ]);
    // Moved from Olive and Pat to Pat and Quin: Olive and Quin both hear.
    const edit = await pat.client.rpc("update_expense", {
      target_expense_id: id,
      title: "Groceries",
      amount: 60000,
      expense_category: "groceries",
      spent_on: today,
      payer_id: pat.id,
      method: "custom",
      shares: equal(60000, [pat, quin]),
    });
    expect(edit.error).toBeNull();
    expect(await recipients("expense_updated", { entityId: id })).toEqual([
      "Olive",
      "Quin",
    ]);
    // Pat (who added it) deletes it: Quin, in its split now, hears.
    expect(
      (await pat.client.rpc("delete_expense", { target_expense_id: id })).error,
    ).toBeNull();
    expect(await recipients("expense_deleted", { entityId: id })).toEqual([
      "Quin",
    ]);
    expect(
      (await olive.client.rpc("restore_expense", { target_expense_id: id }))
        .error,
    ).toBeNull();
    expect(await recipients("expense_restored", { entityId: id })).toEqual([
      "Pat",
      "Quin",
    ]);
  });

  it("a payment notifies the other person (D9), and voiding it the other one", async () => {
    await addExpense(olive, H, {
      payer: olive,
      people: [olive, pat],
      amount: 100000,
    });
    const { data: settlement, error } = await pat.client.rpc(
      "record_settlement",
      {
        target_household_id: H,
        payer_id: pat.id,
        recipient_id: olive.id,
        amount: 10000,
        paid_on: today,
        memo: "Secret note about cash",
      },
    );
    if (error) throw error;
    expect(
      await recipients("settlement_recorded", { entityId: settlement }),
    ).toEqual(["Olive"]);
    expect(
      (
        await olive.client.rpc("void_settlement", {
          target_settlement_id: settlement,
        })
      ).error,
    ).toBeNull();
    expect(
      await recipients("settlement_voided", { entityId: settlement }),
    ).toEqual(["Pat"]);
  });

  it("a bill notifies who usually pays it and its split, the old payer too after a change", async () => {
    const { data: bill, error } = await quin.client.rpc(
      "create_recurring_bill",
      {
        target_household_id: H,
        title: "Internet",
        amount: 90000,
        bill_category: "internet",
        bill_payer_id: olive.id,
        method: "custom",
        shares: equal(90000, [olive, pat]),
        repeat_unit: "month",
        repeat_every: 1,
        first_due_on: today,
      },
    );
    if (error) throw error;
    expect(await recipients("bill_created", { entityId: bill })).toEqual([
      "Olive",
      "Pat",
    ]);
    const changed = await olive.client.rpc("update_recurring_bill", {
      target_bill_id: bill,
      title: "Internet",
      amount: 90000,
      bill_category: "internet",
      bill_payer_id: quin.id,
      method: "custom",
      shares: equal(90000, [quin, pat]),
    });
    expect(changed.error).toBeNull();
    // Quin and Pat now; Olive paid it before the change.
    expect(await recipients("bill_updated", { entityId: bill })).toEqual([
      "Pat",
      "Quin",
    ]);
    // Quin (who added it and pays it now) pauses it: Pat hears.
    expect(
      (await quin.client.rpc("pause_recurring_bill", { target_bill_id: bill }))
        .error,
    ).toBeNull();
    expect(await recipients("bill_paused", { entityId: bill })).toEqual([
      "Pat",
    ]);
  });

  it("an item or a chore notifies its assignee, and who added it when it's bought or done", async () => {
    const { data: item } = await olive.client.rpc("add_shopping_item", {
      target_household_id: H,
      item_name: "Milk",
      item_note: "Secret brand",
      item_assignee_id: pat.id,
    });
    expect(
      await recipients("shopping_item_added", { entityId: item! }),
    ).toEqual(["Pat"]);
    await quin.client.rpc("update_shopping_item", {
      target_item_id: item!,
      item_name: "Milk",
      item_assignee_id: quin.id,
    });
    // Taken from Pat, given to Quin (who did it): Pat hears.
    expect(
      await recipients("shopping_item_updated", { entityId: item! }),
    ).toEqual(["Pat"]);
    await quin.client.rpc("purchase_shopping_item", { target_item_id: item! });
    expect(
      await recipients("shopping_item_purchased", { entityId: item! }),
    ).toEqual(["Olive"]);

    const { data: chore } = await olive.client.rpc("create_chore", {
      target_household_id: H,
      chore_title: "Bins",
      chore_assignee_id: quin.id,
    });
    expect(await recipients("chore_created", { entityId: chore! })).toEqual([
      "Quin",
    ]);
    await quin.client.rpc("complete_chore", { target_chore_id: chore! });
    expect(await recipients("chore_completed", { entityId: chore! })).toEqual([
      "Olive",
    ]);
    // Unassigned: nobody to tell.
    const { data: free } = await olive.client.rpc("create_chore", {
      target_household_id: H,
      chore_title: "Mop",
    });
    expect(await recipients("chore_created", { entityId: free! })).toEqual([]);
  });

  it("a budget change notifies everyone else", async () => {
    const { data: budget, error } = await pat.client.rpc("create_budget", {
      target_household_id: H,
      budget_kind: "month",
      budget_limit: 500000,
    });
    if (error) throw error;
    expect(await recipients("budget_created", { entityId: budget })).toEqual([
      "Olive",
      "Quin",
    ]);
  });
});

describe("the switches (D12)", () => {
  it("leave out a type switched off in that household only, from then on", async () => {
    const A = await household(olive, "Switch A");
    const B = await household(olive, "Switch B");
    await join(olive, A, pat);
    await join(olive, B, pat);
    const muted = await olive.client.rpc("set_notification_preferences", {
      target_household_id: A,
      muted_categories: ["expenses"],
    });
    expect(muted.error).toBeNull();
    const inA = await addExpense(pat, A, { payer: pat, people: [olive, pat] });
    const inB = await addExpense(pat, B, { payer: pat, people: [olive, pat] });
    expect(await recipients("expense_created", { entityId: inA })).toEqual([]);
    expect(await recipients("expense_created", { entityId: inB })).toEqual([
      "Olive",
    ]);
    // Other types in A still arrive.
    const { data: chore } = await pat.client.rpc("create_chore", {
      target_household_id: A,
      chore_title: "Bins",
      chore_assignee_id: olive.id,
    });
    expect(await recipients("chore_created", { entityId: chore! })).toEqual([
      "Olive",
    ]);
    // Back on: new events arrive again; the one missed isn't made up later.
    await olive.client.rpc("set_notification_preferences", {
      target_household_id: A,
      muted_categories: [],
    });
    const again = await addExpense(pat, A, {
      payer: pat,
      people: [olive, pat],
    });
    expect(await recipients("expense_created", { entityId: again })).toEqual([
      "Olive",
    ]);
    expect(await recipients("expense_created", { entityId: inA })).toEqual([]);
    const { data: rows } = await olive.client
      .from("notification_preferences")
      .select("category, enabled")
      .eq("household_id", A);
    expect(rows).toHaveLength(7);
    expect(rows!.every((r) => r.enabled)).toBe(true);
  });

  it("can only be set for yourself, in a household you're in", async () => {
    const X = await household(xena, "Not yours");
    expectError(
      (
        await olive.client.rpc("set_notification_preferences", {
          target_household_id: X,
          muted_categories: ["budgets"],
        })
      ).error,
      PERMISSION_DENIED,
    );
    expectError(
      (
        await anonClient().rpc("set_notification_preferences", {
          target_household_id: X,
          muted_categories: [],
        })
      ).error,
      PERMISSION_DENIED,
    );
    const { data } = await admin
      .from("notification_preferences")
      .select("user_id")
      .eq("household_id", X);
    expect(data).toEqual([]);
    // Xena's own switches can't be read by anyone else.
    await xena.client.rpc("set_notification_preferences", {
      target_household_id: X,
      muted_categories: ["budgets"],
    });
    const seen = await olive.client
      .from("notification_preferences")
      .select("user_id")
      .eq("household_id", X);
    expect(seen.data).toEqual([]);
  });
});

describe("consistency", () => {
  it("a failed operation notifies no one; a repeated one, once", async () => {
    const C = await household(olive, "Consistency");
    await join(olive, C, pat);
    const before = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("household_id", C);
    const bad = await pat.client.rpc("create_expense", {
      target_household_id: C,
      title: "Broken",
      amount: 1000,
      expense_category: "other",
      spent_on: today,
      payer_id: pat.id,
      method: "custom",
      shares: [{ user_id: olive.id, share_minor: 1, percentage_bp: null }],
    });
    expectError(bad.error, INVALID_SPLIT);
    const after = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("household_id", C);
    expect(after.count).toBe(before.count);

    const key = randomUUID();
    const first = await addExpense(pat, C, { payer: pat, key });
    expect(await addExpense(pat, C, { payer: pat, key })).toBe(first);
    const { data } = await admin
      .from("notifications")
      .select("user_id")
      .eq("household_id", C)
      .eq("category", "expenses");
    expect(data).toHaveLength(1);
    // And the database won't hold two for one person and event.
    const { data: one } = await admin
      .from("notifications")
      .select("*")
      .eq("household_id", C)
      .eq("category", "expenses")
      .single();
    const twice = await admin.from("notifications").insert({
      user_id: one!.user_id,
      household_id: one!.household_id,
      activity_event_id: one!.activity_event_id,
      category: one!.category,
      created_at: one!.created_at,
    });
    expect(twice.error?.code).toBe("23505");
  });
});

describe("reading and marking", () => {
  let R: string;

  beforeAll(async () => {
    R = await household(olive, "Reading");
    await join(olive, R, pat, quin);
    for (let i = 0; i < 5; i++)
      await addExpense(pat, R, { payer: pat, people: [olive, pat] });
    // Olive records paying Pat: Pat hears (D9), Olive doesn't.
    await olive.client.rpc("record_settlement", {
      target_household_id: R,
      payer_id: olive.id,
      recipient_id: pat.id,
      amount: 1000,
      paid_on: today,
      memo: "Secret note about cash",
    });
    await olive.client.rpc("create_chore", {
      target_household_id: R,
      chore_title: "Bins",
      chore_assignee_id: quin.id,
    });
  });

  it("shows each person their own, newest first, in the journal's words without notes or shares", async () => {
    const page = await inbox(olive);
    const here = page.items.filter((i) => i.householdId === R);
    // Pat and Quin joining, and Pat's five expenses she shares in.
    expect(here.map((i) => i.entry.detail.type)).toEqual([
      ...Array(5).fill("expense_created"),
      "member_joined",
      "member_joined",
    ]);
    expect(here.every((i) => !i.read)).toBe(true);
    const raw = JSON.stringify(
      (await olive.client.rpc("my_notifications", { page_size: 100 })).data,
    );
    expect(raw).not.toContain("Secret note");
    expect(raw).not.toContain("share_minor");
    // Quin isn't in any of those expenses.
    const quins = await inbox(quin);
    expect(
      quins.items.filter(
        (i) => i.householdId === R && i.category === "expenses",
      ),
    ).toEqual([]);
    // Pat recorded nothing about himself... but heard about Olive's payment.
    const pats = await inbox(pat);
    expect(
      pats.items.filter(
        (i) => i.householdId === R && i.category === "settlements",
      ),
    ).toHaveLength(1);
  });

  it("pages by cursor without repeats", async () => {
    const all = await inbox(olive);
    const first = await inbox(olive, { page_size: 3 });
    expect(first.hasMore).toBe(true);
    const last = first.items.at(-1)!;
    const second = await inbox(olive, {
      page_size: 3,
      before_us: Number(last.createdUs),
      before_id: last.id,
    });
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual(
      all.items.slice(0, 6).map((i) => i.id),
    );
  });

  it("marks one or all as read, only ever the caller's own", async () => {
    const page = await inbox(olive, { unread_only: true });
    const target = page.items.find((i) => i.householdId === R)!;
    // Pat can't mark Olive's: nothing changes, and nothing says it exists.
    const { data: none } = await pat.client.rpc("mark_notifications_read", {
      target_notification_ids: [target.id],
    });
    expect(none).toBe(0);
    expect(
      (await inbox(olive, { target_notification_id: target.id })).items[0].read,
    ).toBe(false);
    const { data: one } = await olive.client.rpc("mark_notifications_read", {
      target_notification_ids: [target.id],
    });
    expect(one).toBe(1);
    const { data: again } = await olive.client.rpc("mark_notifications_read", {
      target_notification_ids: [target.id],
    });
    expect(again).toBe(0);
    const { data: count } = await olive.client.rpc(
      "my_unread_notification_count",
    );
    expect(count).toBe(page.unreadCount - 1);
    const { data: rest } = await olive.client.rpc("mark_notifications_read");
    expect(rest).toBe(page.unreadCount - 1);
    expect((await olive.client.rpc("my_unread_notification_count")).data).toBe(
      0,
    );
    expect((await inbox(olive, { unread_only: true })).items).toEqual([]);
    // Pat's are untouched.
    expect(
      (await pat.client.rpc("my_unread_notification_count")).data,
    ).toBeGreaterThan(0);
  });

  it("can't be read by anyone else, and hide when you leave the household", async () => {
    const mine = (await inbox(quin)).items.find((i) => i.householdId === R);
    expect(mine).toBeDefined();
    // Someone else asking for it by id gets nothing.
    expect(
      (await inbox(olive, { target_notification_id: mine!.id })).items,
    ).toEqual([]);
    const direct = await olive.client
      .from("notifications")
      .select("id")
      .eq("id", mine!.id);
    expect(direct.data).toEqual([]);
    expect(
      (await anonClient().rpc("my_unread_notification_count")).error,
    ).not.toBeNull();
    // Quin leaves: their notifications from R are hidden, and not counted.
    expect(
      (await quin.client.rpc("leave_household", { target_household_id: R }))
        .error,
    ).toBeNull();
    expect(
      (await inbox(quin)).items.filter((i) => i.householdId === R),
    ).toEqual([]);
    expect(
      (
        await quin.client
          .from("notifications")
          .select("id")
          .eq("household_id", R)
      ).data,
    ).toEqual([]);
    // And get no more from it, even what concerns everyone.
    const { data: budget } = await pat.client.rpc("create_budget", {
      target_household_id: R,
      budget_kind: "week",
      budget_limit: 1000,
    });
    expect(await recipients("budget_created", { entityId: budget! })).toEqual([
      "Olive",
    ]);
  });

  it("can't be written directly", async () => {
    const insert = await olive.client.from("notifications").insert({
      user_id: olive.id,
      household_id: R,
      activity_event_id: randomUUID(),
      category: "expenses",
      created_at: new Date().toISOString(),
    });
    expectError(insert.error, PERMISSION_DENIED);
    const update = await olive.client
      .from("notifications")
      .update({ read_at: null })
      .eq("user_id", olive.id);
    expectError(update.error, PERMISSION_DENIED);
    const del = await olive.client
      .from("notifications")
      .delete()
      .eq("user_id", olive.id);
    expectError(del.error, PERMISSION_DENIED);
    const pref = await olive.client.from("notification_preferences").insert({
      user_id: pat.id,
      household_id: R,
      category: "expenses",
      enabled: false,
    });
    expectError(pref.error, PERMISSION_DENIED);
  });

  it("refuses page sizes and cursors it can't use", async () => {
    for (const args of [
      { page_size: 0 },
      { page_size: 101 },
      { before_us: 5 },
    ]) {
      const { error } = await olive.client.rpc("my_notifications", args);
      expectError(error, "22023");
    }
  });
});

describe("deleting the household", () => {
  it("removes its notifications and switches (D14)", async () => {
    const D = await household(xena, "Short-lived notifications");
    await join(xena, D, raj);
    await raj.client.rpc("set_notification_preferences", {
      target_household_id: D,
      muted_categories: ["budgets"],
    });
    await xena.client.rpc("create_budget", {
      target_household_id: D,
      budget_kind: "month",
      budget_limit: 1000,
    });
    const { count } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("household_id", D);
    expect(count).toBeGreaterThan(0);
    // Raj leaves so Xena is alone and may delete it.
    expect(
      (await raj.client.rpc("leave_household", { target_household_id: D }))
        .error,
    ).toBeNull();
    expect(
      (await xena.client.rpc("delete_household", { target_household_id: D }))
        .error,
    ).toBeNull();
    for (const table of [
      "notifications",
      "notification_preferences",
    ] as const) {
      const { data } = await admin
        .from(table)
        .select("household_id")
        .eq("household_id", D);
      expect(data, table).toEqual([]);
    }
  });
});
