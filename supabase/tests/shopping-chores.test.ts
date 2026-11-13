// The shopping list and chores (roadmap Phase 15, D28 proposed) as real
// signed-in users against the local stack: adding, editing, buying, reopening
// and removing items; adding, editing, reassigning, completing, reopening and
// removing chores; who may do what; assignees and members who leave (D13);
// repeated and concurrent requests; other households and forged ids; that a
// failed change writes nothing; the journal (one event per real change,
// notes and descriptions left out, the Shopping and Chores filters); deleting
// the household; and that no money moves. Journal answers are parsed and
// checked with the app's own code (src/lib/journal/payload.ts).
//
// Needs `npm run db:start`, then `npm run test:db`. Everything is created for
// this run and removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkJournal, parseJournalPayload } from "@/lib/journal/payload";
import type { JournalFilter } from "@/lib/journal/query";
import {
  adminClient,
  anonClient,
  signedInClient,
  type TypedClient,
} from "./support/local-supabase";

const PERMISSION_DENIED = "42501";
const CHECK_VIOLATION = "23514";
const NO_SUCH_ITEM = "HJ026";
const NO_SUCH_CHORE = "HJ027";
const REMOVED = "HJ028";
const CHANGED = "HJ029";
const NOT_A_MEMBER = "HJ030";

const runId = randomUUID().slice(0, 8);
const password = `chore-${randomUUID()}`;
const admin = adminClient();

type User = { id: string; name: string; client: TypedClient };
const users: User[] = [];
let olive: User, pat: User, quin: User, raj: User, xena: User;
/** Olive owns it; Pat and Quin are members. */
let H: string;
/** Xena's. */
let X: string;

function expectError(error: PostgrestError | null, code: string) {
  expect(error, `expected Postgres error ${code}`).not.toBeNull();
  expect(error?.code).toBe(code);
}

async function createUser(name: string): Promise<User> {
  const email = `chore-${runId}-${name.toLowerCase()}@example.com`;
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
    time_zone: "Asia/Kolkata",
  });
  if (error) throw error;
  return data;
}

async function join(owner: User, householdId: string, ...members: User[]) {
  const bytes = randomBytes(32);
  const insert = await owner.client.from("invitations").insert({
    household_id: householdId,
    token_hash: createHash("sha256").update(bytes).digest("hex"),
  });
  if (insert.error) throw insert.error;
  for (const member of members) {
    const { error } = await member.client.rpc("accept_invite", {
      token: bytes.toString("base64url"),
    });
    if (error) throw error;
  }
}

async function addItem(
  user: User,
  householdId: string,
  input: {
    name?: string;
    quantity?: string;
    note?: string;
    assignee?: User;
    key?: string;
  } = {},
) {
  const { data, error } = await user.client.rpc("add_shopping_item", {
    target_household_id: householdId,
    item_name: input.name ?? "Milk",
    ...(input.quantity ? { item_quantity: input.quantity } : {}),
    ...(input.note ? { item_note: input.note } : {}),
    ...(input.assignee ? { item_assignee_id: input.assignee.id } : {}),
    ...(input.key ? { request_key: input.key } : {}),
  });
  if (error) throw error;
  return data;
}

async function addChore(
  user: User,
  householdId: string,
  input: {
    title?: string;
    description?: string;
    assignee?: User;
    dueOn?: string;
    priority?: "low" | "medium" | "high";
    key?: string;
  } = {},
) {
  const { data, error } = await user.client.rpc("create_chore", {
    target_household_id: householdId,
    chore_title: input.title ?? "Take out the bins",
    ...(input.description ? { chore_description: input.description } : {}),
    ...(input.assignee ? { chore_assignee_id: input.assignee.id } : {}),
    ...(input.dueOn ? { chore_due_on: input.dueOn } : {}),
    ...(input.priority ? { chore_priority_level: input.priority } : {}),
    ...(input.key ? { request_key: input.key } : {}),
  });
  if (error) throw error;
  return data;
}

async function itemRow(id: string) {
  const { data, error } = await admin
    .from("shopping_items")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

async function choreRow(id: string) {
  const { data, error } = await admin
    .from("chores")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

/** The journal's events about one record, oldest first. */
async function eventsFor(entityId: string) {
  const { data, error } = await admin
    .from("activity_events")
    .select("type, actor_id, summary, household_id")
    .eq("entity_id", entityId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return data;
}

async function eventCount(householdId: string) {
  const { count, error } = await admin
    .from("activity_events")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId);
  if (error) throw error;
  return count ?? 0;
}

async function journal(user: User, householdId: string, filter: JournalFilter) {
  const { data, error } = await user.client.rpc("household_journal", {
    target_household_id: householdId,
    ...(filter === "all" ? {} : { category_filter: filter }),
    page_size: 100,
  });
  if (error) throw error;
  const page = parseJournalPayload(data);
  if (!page) throw new Error("household_journal returned an unexpected shape");
  const check = checkJournal(page, {
    householdId,
    filter,
    before: null,
    pageSize: 100,
  });
  if (!check.ok) throw new Error(`household_journal failed ${check.code}`);
  return { page, raw: JSON.stringify(data) };
}

beforeAll(async () => {
  [olive, pat, quin, raj, xena] = await Promise.all(
    ["Olive", "Pat", "Quin", "Raj", "Xena"].map(createUser),
  );
  H = await household(olive, "Chores home");
  X = await household(xena, "Other home");
  await join(olive, H, pat, quin);
}, 60_000);

afterAll(async () => {
  const ids = users.map((u) => u.id);
  if (ids.length) {
    // Households cascade to items, chores and the journal (D14).
    await admin.from("households").delete().in("created_by", ids);
    await admin.from("profiles").delete().in("id", ids);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  }
});

describe("the shopping list", () => {
  it("adds an item with who added it, from the session, and journals it", async () => {
    const id = await addItem(pat, H, {
      name: "Rice",
      quantity: "5 kg",
      note: "Basmati",
      assignee: quin,
    });
    expect(await itemRow(id)).toMatchObject({
      household_id: H,
      name: "Rice",
      quantity: "5 kg",
      note: "Basmati",
      assignee_id: quin.id,
      added_by: pat.id,
      purchased_at: null,
      removed_at: null,
    });
    const events = await eventsFor(id);
    expect(events).toEqual([
      {
        type: "shopping_item_added",
        actor_id: pat.id,
        household_id: H,
        summary: {
          after: { name: "Rice", quantity: "5 kg", assignee_id: quin.id },
        },
      },
    ]);
    // The note stays out of the journal.
    expect(JSON.stringify(events)).not.toContain("Basmati");
  });

  it("adds once for a repeated or concurrent submission", async () => {
    const key = randomUUID();
    const first = await addItem(olive, H, { name: "Bread", key });
    expect(await addItem(olive, H, { name: "Bread", key })).toBe(first);
    const concurrentKey = randomUUID();
    const ids = await Promise.all(
      Array.from({ length: 4 }, () =>
        addItem(pat, H, { name: "Eggs", key: concurrentKey }),
      ),
    );
    expect(new Set(ids).size).toBe(1);
    expect(await eventsFor(first)).toHaveLength(1);
    expect(await eventsFor(ids[0])).toHaveLength(1);
    // The same key from someone else is their own request.
    expect(await addItem(pat, H, { name: "Bread", key })).not.toBe(first);
  });

  it("refuses bad fields and non-member assignees, writing nothing", async () => {
    const before = await eventCount(H);
    for (const name of ["", " Milk", "x".repeat(121)]) {
      const { error } = await olive.client.rpc("add_shopping_item", {
        target_household_id: H,
        item_name: name,
      });
      expectError(error, CHECK_VIOLATION);
    }
    const longQuantity = await olive.client.rpc("add_shopping_item", {
      target_household_id: H,
      item_name: "Milk",
      item_quantity: "x".repeat(41),
    });
    expectError(longQuantity.error, CHECK_VIOLATION);
    for (const outsider of [xena, raj]) {
      const { error } = await olive.client.rpc("add_shopping_item", {
        target_household_id: H,
        item_name: "Milk",
        item_assignee_id: outsider.id,
      });
      expectError(error, NOT_A_MEMBER);
    }
    expect(await eventCount(H)).toBe(before);
  });

  it("lets any member edit, journalling old and new values and only flagging the note", async () => {
    const id = await addItem(olive, H, { name: "Milk", quantity: "1 litre" });
    const row = await itemRow(id);
    const edit = await quin.client.rpc("update_shopping_item", {
      target_item_id: id,
      item_name: "Oat milk",
      item_quantity: "2 litres",
      item_note: "Unsweetened",
      item_assignee_id: pat.id,
      expected_updated_at: row.updated_at,
    });
    expect(edit.error).toBeNull();
    expect(await itemRow(id)).toMatchObject({
      name: "Oat milk",
      quantity: "2 litres",
      note: "Unsweetened",
      assignee_id: pat.id,
      added_by: olive.id,
    });
    const events = await eventsFor(id);
    expect(events.at(-1)).toMatchObject({
      type: "shopping_item_updated",
      actor_id: quin.id,
      summary: {
        before: { name: "Milk", quantity: "1 litre", assignee_id: null },
        after: { name: "Oat milk", quantity: "2 litres", assignee_id: pat.id },
        note_changed: true,
      },
    });
    expect(JSON.stringify(events)).not.toContain("Unsweetened");

    // Saving it unchanged writes no event.
    const now = await itemRow(id);
    const same = await quin.client.rpc("update_shopping_item", {
      target_item_id: id,
      item_name: "Oat milk",
      item_quantity: "2 litres",
      item_note: "Unsweetened",
      item_assignee_id: pat.id,
      expected_updated_at: now.updated_at,
    });
    expect(same.error).toBeNull();
    expect(await eventsFor(id)).toHaveLength(2);

    // An edit from a stale page is refused.
    const stale = await pat.client.rpc("update_shopping_item", {
      target_item_id: id,
      item_name: "Soy milk",
      expected_updated_at: row.updated_at,
    });
    expectError(stale.error, CHANGED);
    expect((await itemRow(id)).name).toBe("Oat milk");
  });

  it("marks an item bought by whoever does it; again changes nothing", async () => {
    const id = await addItem(olive, H, { name: "Soap", assignee: quin });
    const bought = await pat.client.rpc("purchase_shopping_item", {
      target_item_id: id,
    });
    expect(bought.error).toBeNull();
    const row = await itemRow(id);
    expect(row.purchased_by).toBe(pat.id);
    expect(row.purchased_at).not.toBeNull();
    // A double tap, or someone else at the same moment: no change, no event.
    const again = await Promise.all([
      quin.client.rpc("purchase_shopping_item", { target_item_id: id }),
      olive.client.rpc("purchase_shopping_item", { target_item_id: id }),
    ]);
    expect(again.map((r) => r.error)).toEqual([null, null]);
    expect(await itemRow(id)).toMatchObject({
      purchased_by: pat.id,
      purchased_at: row.purchased_at,
    });

    const reopened = await quin.client.rpc("reopen_shopping_item", {
      target_item_id: id,
    });
    expect(reopened.error).toBeNull();
    expect(await itemRow(id)).toMatchObject({
      purchased_at: null,
      purchased_by: null,
    });
    await quin.client.rpc("reopen_shopping_item", { target_item_id: id });
    expect((await eventsFor(id)).map((e) => e.type)).toEqual([
      "shopping_item_added",
      "shopping_item_purchased",
      "shopping_item_reopened",
    ]);
  });

  it("removes an item for good: kept, refused afterwards, once in the journal", async () => {
    const id = await addItem(olive, H, { name: "Batteries" });
    expect(
      (await pat.client.rpc("remove_shopping_item", { target_item_id: id }))
        .error,
    ).toBeNull();
    expect(await itemRow(id)).toMatchObject({
      removed_by: pat.id,
      added_by: olive.id,
    });
    expect(
      (await olive.client.rpc("remove_shopping_item", { target_item_id: id }))
        .error,
    ).toBeNull();
    for (const call of [
      olive.client.rpc("purchase_shopping_item", { target_item_id: id }),
      olive.client.rpc("reopen_shopping_item", { target_item_id: id }),
      olive.client.rpc("update_shopping_item", {
        target_item_id: id,
        item_name: "AA batteries",
      }),
    ]) {
      expectError((await call).error, REMOVED);
    }
    expect((await eventsFor(id)).map((e) => e.type)).toEqual([
      "shopping_item_added",
      "shopping_item_removed",
    ]);
  });
});

describe("chores", () => {
  it("adds a chore with who added it, medium priority by default, and journals it", async () => {
    const id = await addChore(pat, H, { description: "Blue bin first" });
    expect(await choreRow(id)).toMatchObject({
      household_id: H,
      title: "Take out the bins",
      description: "Blue bin first",
      assignee_id: null,
      due_on: null,
      priority: "medium",
      created_by: pat.id,
      completed_at: null,
    });
    const events = await eventsFor(id);
    expect(events).toEqual([
      {
        type: "chore_created",
        actor_id: pat.id,
        household_id: H,
        summary: {
          after: {
            title: "Take out the bins",
            assignee_id: null,
            due_on: null,
            priority: "medium",
          },
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("Blue bin");
  });

  it("adds once for a repeated submission, and refuses bad fields", async () => {
    const key = randomUUID();
    const first = await addChore(olive, H, { title: "Mop", key });
    expect(await addChore(olive, H, { title: "Mop", key })).toBe(first);
    expect(await eventsFor(first)).toHaveLength(1);
    const before = await eventCount(H);
    for (const args of [
      { chore_title: "" },
      { chore_title: "x".repeat(121) },
      { chore_title: "Mop", chore_description: "x".repeat(1001) },
      { chore_title: "Mop", chore_due_on: "1999-12-31" },
    ]) {
      const { error } = await olive.client.rpc("create_chore", {
        target_household_id: H,
        ...args,
      });
      expectError(error, CHECK_VIOLATION);
    }
    const outsider = await olive.client.rpc("create_chore", {
      target_household_id: H,
      chore_title: "Mop",
      chore_assignee_id: xena.id,
    });
    expectError(outsider.error, NOT_A_MEMBER);
    expect(await eventCount(H)).toBe(before);
  });

  it("lets the person who added it, its assignee or the owner change it (D28)", async () => {
    const id = await addChore(pat, H, { title: "Water plants", assignee: pat });
    // Quin neither added it nor has it: refused, nothing written.
    const before = await eventsFor(id);
    for (const call of [
      quin.client.rpc("update_chore", {
        target_chore_id: id,
        chore_title: "Mine now",
      }),
      quin.client.rpc("complete_chore", { target_chore_id: id }),
      quin.client.rpc("remove_chore", { target_chore_id: id }),
    ]) {
      expectError((await call).error, PERMISSION_DENIED);
    }
    expect(await eventsFor(id)).toEqual(before);

    // The owner reassigns it to Quin, with a due date and a priority.
    const row = await choreRow(id);
    const reassigned = await olive.client.rpc("update_chore", {
      target_chore_id: id,
      chore_title: "Water plants",
      chore_assignee_id: quin.id,
      chore_due_on: "2026-11-20",
      chore_priority_level: "high",
      expected_updated_at: row.updated_at,
    });
    expect(reassigned.error).toBeNull();
    expect((await eventsFor(id)).at(-1)).toMatchObject({
      type: "chore_updated",
      actor_id: olive.id,
      summary: {
        before: { assignee_id: pat.id, due_on: null, priority: "medium" },
        after: { assignee_id: quin.id, due_on: "2026-11-20", priority: "high" },
        description_changed: false,
      },
    });
    // Now Quin, its assignee, may complete it; Pat still may, having added it.
    expect(
      (await quin.client.rpc("complete_chore", { target_chore_id: id })).error,
    ).toBeNull();
    expect(await choreRow(id)).toMatchObject({ completed_by: quin.id });
    expect(
      (await pat.client.rpc("reopen_chore", { target_chore_id: id })).error,
    ).toBeNull();
    // A stale edit is refused.
    const stale = await pat.client.rpc("update_chore", {
      target_chore_id: id,
      chore_title: "Water the plants",
      expected_updated_at: row.updated_at,
    });
    expectError(stale.error, CHANGED);
  });

  it("lets anyone pick up a chore that's assigned to nobody", async () => {
    const id = await addChore(olive, H, { title: "Descale the kettle" });
    expect(
      (await quin.client.rpc("complete_chore", { target_chore_id: id })).error,
    ).toBeNull();
    expect(await choreRow(id)).toMatchObject({ completed_by: quin.id });
    // But only those D28 names may change or remove it (a regression: with
    // nobody assigned, the rule once came out null and let anyone through).
    expectError(
      (await quin.client.rpc("remove_chore", { target_chore_id: id })).error,
      PERMISSION_DENIED,
    );
    expectError(
      (
        await quin.client.rpc("update_chore", {
          target_chore_id: id,
          chore_title: "Mine now",
          chore_assignee_id: quin.id,
        })
      ).error,
      PERMISSION_DENIED,
    );
    expect(await choreRow(id)).toMatchObject({
      title: "Descale the kettle",
      assignee_id: null,
    });
  });

  it("completes and reopens once; repeats change nothing and write no event", async () => {
    const id = await addChore(olive, H, {
      title: "Clean the hob",
      assignee: pat,
    });
    const done = await Promise.all([
      pat.client.rpc("complete_chore", { target_chore_id: id }),
      pat.client.rpc("complete_chore", { target_chore_id: id }),
      olive.client.rpc("complete_chore", { target_chore_id: id }),
    ]);
    expect(done.map((r) => r.error)).toEqual([null, null, null]);
    const row = await choreRow(id);
    expect(row.completed_at).not.toBeNull();
    await pat.client.rpc("reopen_chore", { target_chore_id: id });
    await pat.client.rpc("reopen_chore", { target_chore_id: id });
    expect((await eventsFor(id)).map((e) => e.type)).toEqual([
      "chore_created",
      "chore_completed",
      "chore_reopened",
    ]);
  });

  it("removes a chore for good: kept, refused afterwards, once in the journal", async () => {
    const id = await addChore(olive, H, { title: "Defrost the freezer" });
    expect(
      (await olive.client.rpc("remove_chore", { target_chore_id: id })).error,
    ).toBeNull();
    expect(
      (await olive.client.rpc("remove_chore", { target_chore_id: id })).error,
    ).toBeNull();
    expect(await choreRow(id)).toMatchObject({ removed_by: olive.id });
    for (const call of [
      olive.client.rpc("complete_chore", { target_chore_id: id }),
      olive.client.rpc("reopen_chore", { target_chore_id: id }),
      olive.client.rpc("update_chore", {
        target_chore_id: id,
        chore_title: "Defrost",
      }),
    ]) {
      expectError((await call).error, REMOVED);
    }
    expect((await eventsFor(id)).map((e) => e.type)).toEqual([
      "chore_created",
      "chore_removed",
    ]);
  });
});

describe("someone leaving (D13)", () => {
  it("keeps their assignments; anyone may finish or reassign, never to them", async () => {
    const L = await household(olive, "Leaving home");
    await join(olive, L, pat, raj);
    const chore = await addChore(olive, L, { title: "Bins", assignee: raj });
    const item = await addItem(olive, L, { name: "Tea", assignee: raj });
    const left = await raj.client.rpc("leave_household", {
      target_household_id: L,
    });
    expect(left.error).toBeNull();

    // Nothing was moved to anyone.
    expect((await choreRow(chore)).assignee_id).toBe(raj.id);
    expect((await itemRow(item)).assignee_id).toBe(raj.id);

    // Pat neither added the chore nor has it, but its assignee has left.
    expect(
      (await pat.client.rpc("complete_chore", { target_chore_id: chore }))
        .error,
    ).toBeNull();

    // Editing the item while keeping the former member is fine...
    const kept = await pat.client.rpc("update_shopping_item", {
      target_item_id: item,
      item_name: "Green tea",
      item_assignee_id: raj.id,
    });
    expect(kept.error).toBeNull();
    // ...choosing them again once moved isn't.
    await pat.client.rpc("update_shopping_item", {
      target_item_id: item,
      item_name: "Green tea",
      item_assignee_id: pat.id,
    });
    const back = await pat.client.rpc("update_shopping_item", {
      target_item_id: item,
      item_name: "Green tea",
      item_assignee_id: raj.id,
    });
    expectError(back.error, NOT_A_MEMBER);

    // Raj can't read or change anything there any more.
    const read = await raj.client
      .from("chores")
      .select("id")
      .eq("household_id", L);
    expect(read.data).toEqual([]);
    expectError(
      (await raj.client.rpc("reopen_chore", { target_chore_id: chore })).error,
      NO_SUCH_CHORE,
    );
    expectError(
      (
        await raj.client.rpc("add_shopping_item", {
          target_household_id: L,
          item_name: "Tea",
        })
      ).error,
      PERMISSION_DENIED,
    );

    // The journal names Raj, marked as no longer active.
    const { page } = await journal(pat, L, "chores");
    expect(page.people.find((p) => p.userId === raj.id)).toEqual({
      userId: raj.id,
      displayName: "Raj",
      isActive: false,
    });
  });
});

describe("other households", () => {
  let item: string;
  let chore: string;

  beforeAll(async () => {
    item = await addItem(xena, X, { name: "Xena's coffee", note: "Private" });
    chore = await addChore(xena, X, { title: "Xena's laundry" });
  });

  it("can't be read, by members of other households or anyone signed out", async () => {
    for (const client of [olive.client, anonClient()]) {
      for (const table of ["shopping_items", "chores"] as const) {
        const { data } = await client
          .from(table)
          .select("id")
          .eq("household_id", X);
        expect(data ?? [], table).toEqual([]);
      }
    }
    expect(
      (await xena.client.from("shopping_items").select("id").eq("id", item))
        .data,
    ).toHaveLength(1);
  });

  it("can't be changed: forged ids look like ids that don't exist", async () => {
    const before = await eventCount(X);
    for (const fn of [
      "purchase_shopping_item",
      "reopen_shopping_item",
      "remove_shopping_item",
    ] as const) {
      expectError(
        (await olive.client.rpc(fn, { target_item_id: item })).error,
        NO_SUCH_ITEM,
      );
    }
    expectError(
      (
        await olive.client.rpc("update_shopping_item", {
          target_item_id: item,
          item_name: "Mine",
        })
      ).error,
      NO_SUCH_ITEM,
    );
    for (const fn of [
      "complete_chore",
      "reopen_chore",
      "remove_chore",
    ] as const) {
      expectError(
        (await olive.client.rpc(fn, { target_chore_id: chore })).error,
        NO_SUCH_CHORE,
      );
    }
    expectError(
      (
        await olive.client.rpc("purchase_shopping_item", {
          target_item_id: randomUUID(),
        })
      ).error,
      NO_SUCH_ITEM,
    );
    // Adding to another household, or assigning someone from it.
    expectError(
      (
        await olive.client.rpc("add_shopping_item", {
          target_household_id: X,
          item_name: "x",
        })
      ).error,
      PERMISSION_DENIED,
    );
    expectError(
      (
        await olive.client.rpc("create_chore", {
          target_household_id: X,
          chore_title: "x",
        })
      ).error,
      PERMISSION_DENIED,
    );
    expect(await eventCount(X)).toBe(before);
    expect(await itemRow(item)).toMatchObject({
      name: "Xena's coffee",
      purchased_at: null,
    });
  });

  it("can't be written directly, even in your own household", async () => {
    const insert = await olive.client
      .from("shopping_items")
      .insert({ household_id: H, name: "Direct", added_by: olive.id });
    expectError(insert.error, PERMISSION_DENIED);
    const update = await olive.client
      .from("chores")
      .update({ title: "Direct" })
      .eq("household_id", H);
    expectError(update.error, PERMISSION_DENIED);
    const del = await olive.client
      .from("shopping_items")
      .delete()
      .eq("household_id", H);
    expectError(del.error, PERMISSION_DENIED);
    for (const fn of ["add_shopping_item", "create_chore"] as const) {
      const { error } = await anonClient().rpc(
        fn,
        fn === "add_shopping_item"
          ? { target_household_id: H, item_name: "x" }
          : { target_household_id: H, chore_title: "x" },
      );
      expectError(error, PERMISSION_DENIED);
    }
  });
});

describe("the journal", () => {
  it("shows each real change under Shopping and Chores, with the record's state now", async () => {
    const J = await household(olive, "Journal tasks");
    await join(olive, J, pat);
    const milk = await addItem(olive, J, { name: "Milk", note: "Secret note" });
    await pat.client.rpc("purchase_shopping_item", { target_item_id: milk });
    await pat.client.rpc("purchase_shopping_item", { target_item_id: milk });
    const tea = await addItem(olive, J, { name: "Tea" });
    await olive.client.rpc("remove_shopping_item", { target_item_id: tea });
    const bins = await addChore(olive, J, {
      title: "Bins",
      description: "Secret description",
      assignee: pat,
      dueOn: "2026-11-14",
    });
    await pat.client.rpc("complete_chore", { target_chore_id: bins });

    const shopping = await journal(pat, J, "shopping");
    expect(shopping.page.entries.map((e) => e.detail.type)).toEqual([
      "shopping_item_removed",
      "shopping_item_added",
      "shopping_item_purchased",
      "shopping_item_added",
    ]);
    expect(shopping.page.entries[0].entity).toEqual({
      available: true,
      id: tea,
      state: "removed",
    });
    expect(shopping.page.entries[2].entity).toEqual({
      available: true,
      id: milk,
      state: "purchased",
    });

    const chores = await journal(olive, J, "chores");
    expect(chores.page.entries.map((e) => e.detail.type)).toEqual([
      "chore_completed",
      "chore_created",
    ]);
    expect(chores.page.entries[0]).toMatchObject({
      actorId: pat.id,
      entity: { available: true, id: bins, state: "completed" },
    });

    const all = await journal(olive, J, "all");
    const types = all.page.entries.map((e) => e.detail.type);
    expect(types.filter((t) => t.startsWith("shopping_"))).toHaveLength(4);
    expect(types.filter((t) => t.startsWith("chore_"))).toHaveLength(2);
    // Notes and descriptions never reach the journal.
    for (const raw of [shopping.raw, chores.raw, all.raw]) {
      expect(raw).not.toContain("Secret");
    }
    // Other filters don't show them.
    const expenses = await journal(olive, J, "expenses");
    expect(expenses.page.entries).toEqual([]);
  });

  it("still refuses a category it doesn't know", async () => {
    const { error } = await olive.client.rpc("household_journal", {
      target_household_id: H,
      category_filter: "analytics",
    });
    expectError(error, "22023");
  });
});

describe("money and the household", () => {
  it("buying something records no expense and changes no balance", async () => {
    const M = await household(raj, "No money");
    const id = await addItem(raj, M, { name: "Milk" });
    await raj.client.rpc("purchase_shopping_item", { target_item_id: id });
    const chore = await addChore(raj, M);
    await raj.client.rpc("complete_chore", { target_chore_id: chore });
    for (const table of ["expenses", "settlements"] as const) {
      const { data } = await admin
        .from(table)
        .select("id")
        .eq("household_id", M);
      expect(data, table).toEqual([]);
    }
  });

  it("deleting the household removes its items and chores (D14)", async () => {
    const D = await household(raj, "Short-lived tasks");
    await addItem(raj, D, { name: "Milk" });
    await addChore(raj, D);
    const { error } = await raj.client.rpc("delete_household", {
      target_household_id: D,
    });
    expect(error).toBeNull();
    for (const table of [
      "shopping_items",
      "chores",
      "activity_events",
    ] as const) {
      const { data } = await admin
        .from(table)
        .select("household_id")
        .eq("household_id", D);
      expect(data, table).toEqual([]);
    }
  });
});
