// The household journal (roadmap Phase 13) as real signed-in users against
// the local stack: every operation writes its entry, refused or failed
// operations write none, retries and repeated transitions write one, the
// event and its change commit or roll back together; public.household_journal
// returns them newest first with ties broken by id, in pages that never
// repeat or skip, filtered, minimal (no notes, tokens or shares), and only to
// active members; reading it changes no money. Every page is parsed and
// checked with the app's own code (src/lib/journal/payload.ts).
//
// Needs `npm run db:start`, then `npm run test:db`. Everything is created for
// this run and removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeSplit } from "@/domain/money/split";
import { sharesJson } from "@/lib/expenses/form";
import { entryDescriber } from "@/lib/journal/describe";
import {
  checkJournal,
  entryCategory,
  nextCursor,
  parseJournalPayload,
  type JournalEntry,
  type JournalPage,
} from "@/lib/journal/payload";
import type { JournalCursor, JournalFilter } from "@/lib/journal/query";
import {
  adminClient,
  anonClient,
  psqlAsSuperuser,
  signedInClient,
  type TypedClient,
} from "./support/local-supabase";

const PERMISSION_DENIED = "42501";
const INVALID_PARAMETER = "22023";
const INVITE_NOT_VALID = "HJ001";
const OWNER_MUST_TRANSFER = "HJ002";
const BALANCE_NOT_ZERO = "HJ006";
const INVALID_SPLIT = "HJ008";
const CHANGED_SINCE_LOADED = "HJ010";
const ALREADY_DELETED = "HJ011";
const ALREADY_VOIDED = "HJ015";
const MORE_THAN_OWED = "HJ017";

const runId = randomUUID().slice(0, 8);
const password = `jrn-${randomUUID()}`;
const admin = adminClient();
const NOTE = `Cash for groceries ${runId}, keep this private`;

type User = { id: string; name: string; client: TypedClient };
const users: User[] = [];
let olive: User, pat: User, quin: User, raj: User, xena: User;

function expectError(error: PostgrestError | null, code: string) {
  expect(error, `expected Postgres error ${code}`).not.toBeNull();
  expect(error?.code).toBe(code);
}

async function createUser(name: string): Promise<User> {
  const email = `jrn-${runId}-${name.toLowerCase()}@example.com`;
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

async function household(owner: User, name: string, key?: string) {
  const { data, error } = await owner.client.rpc("create_household", {
    household_name: `${name} ${runId}`,
    currency: "INR",
    time_zone: "Asia/Kolkata",
    ...(key ? { request_key: key } : {}),
  });
  if (error) throw error;
  return data;
}

/** An invite link created by `creator`: its id and the raw token. */
async function invite(creator: User, householdId: string) {
  const bytes = randomBytes(32);
  const { data, error } = await creator.client
    .from("invitations")
    .insert({
      household_id: householdId,
      token_hash: createHash("sha256").update(bytes).digest("hex"),
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, token: bytes.toString("base64url") };
}

async function accept(user: User, token: string) {
  const { error } = await user.client.rpc("accept_invite", { token });
  if (error) throw error;
}

function equalShares(total: number, people: User[]) {
  const split = computeSplit({
    method: "equal",
    total: BigInt(total),
    participants: people.map((p) => p.id),
  });
  if (!split.ok) throw new Error(split.error);
  return sharesJson(split.shares);
}

type ExpenseInput = {
  title: string;
  amount: number;
  payer: User;
  people: User[];
  category?: "groceries" | "utilities" | "dining" | "other";
  key?: string;
};

function expenseArgs(householdId: string, input: ExpenseInput) {
  return {
    target_household_id: householdId,
    title: input.title,
    amount: input.amount,
    expense_category: input.category ?? "groceries",
    spent_on: "2026-11-12",
    payer_id: input.payer.id,
    method: "equal" as const,
    shares: equalShares(input.amount, input.people),
    ...(input.key ? { request_key: input.key } : {}),
  };
}

async function addExpense(
  creator: User,
  householdId: string,
  input: ExpenseInput,
): Promise<string> {
  const { data, error } = await creator.client.rpc(
    "create_expense",
    expenseArgs(householdId, input),
  );
  if (error) throw error;
  return data;
}

async function eventCount(householdId: string): Promise<number> {
  const { count, error } = await admin
    .from("activity_events")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId);
  if (error) throw error;
  return count ?? 0;
}

type PageOptions = {
  filter?: JournalFilter;
  before?: JournalCursor | null;
  pageSize?: number;
};

function journalArgs(householdId: string, options: PageOptions = {}) {
  const { filter = "all", before = null, pageSize = 25 } = options;
  return {
    target_household_id: householdId,
    ...(filter !== "all" ? { category_filter: filter } : {}),
    ...(before ? { before_us: Number(before.us), before_id: before.id } : {}),
    page_size: pageSize,
  };
}

/** One page, parsed and checked exactly as the app does before showing it. */
async function journalPage(
  user: User,
  householdId: string,
  options: PageOptions = {},
): Promise<{ page: JournalPage; raw: unknown }> {
  const { filter = "all", before = null, pageSize = 25 } = options;
  const { data, error } = await user.client.rpc(
    "household_journal",
    journalArgs(householdId, options),
  );
  if (error) throw error;
  const page = parseJournalPayload(data);
  if (!page) throw new Error("household_journal returned an unexpected shape");
  const check = checkJournal(page, { householdId, filter, before, pageSize });
  if (!check.ok) throw new Error(`household_journal failed ${check.code}`);
  return { page, raw: data };
}

/** Every entry, page by page, following the cursor; and every raw page. */
async function wholeJournal(
  user: User,
  householdId: string,
  options: Omit<PageOptions, "before"> = {},
): Promise<{ entries: JournalEntry[]; pages: number; raw: unknown[] }> {
  const entries: JournalEntry[] = [];
  const raw: unknown[] = [];
  let before: JournalCursor | null = null;
  for (let pages = 1; pages <= 500; pages++) {
    const result = await journalPage(user, householdId, { ...options, before });
    entries.push(...result.page.entries);
    raw.push(result.raw);
    before = nextCursor(result.page);
    if (!before) return { entries, pages, raw };
  }
  throw new Error("The journal never ended");
}

type StoredEvent = {
  id: string;
  type: string;
  actor_id: string | null;
  entity_id: string;
  created_at: string;
  summary: Record<string, unknown>;
};

/** What activity_events holds for a household, as Postgres orders it. */
async function storedEvents(householdId: string): Promise<StoredEvent[]> {
  const { data, error } = await admin
    .from("activity_events")
    .select("id, type, actor_id, entity_id, created_at, summary")
    .eq("household_id", householdId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw error;
  return data as StoredEvent[];
}

/**
 * The stored events the journal should show: all of them except invite links
 * revoked in the same transaction as their creator leaving or being removed.
 */
function expectedVisible(events: StoredEvent[]): StoredEvent[] {
  const departures = new Set(
    events
      .filter((e) => e.type === "member_left" || e.type === "member_removed")
      .map((e) => `${e.created_at}|${e.summary.user_id}`),
  );
  return events.filter(
    (e) =>
      e.type !== "invitation_revoked" ||
      !departures.has(`${e.created_at}|${e.summary.created_by}`),
  );
}

async function balances(user: User, householdId: string) {
  const { data, error } = await user.client.rpc("household_balances", {
    target_household_id: householdId,
  });
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  [olive, pat, quin, raj, xena] = await Promise.all(
    ["Olive", "Pat", "Quin", "Raj", "Xena"].map(createUser),
  );
}, 60_000);

afterAll(async () => {
  const ids = users.map((u) => u.id);
  if (ids.length) {
    // Households cascade to members, invitations, expenses, settlements and
    // the journal; then profiles, then auth users (D14).
    await admin.from("households").delete().in("created_by", ids);
    await admin.from("profiles").delete().in("id", ids);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  }
});

// ---------------------------------------------------------------------------
// One household's story, written by the real functions, read back
// ---------------------------------------------------------------------------

describe("a household's journal", () => {
  let H: string;
  let groceries: string, electricity: string, payment: string;
  const hiddenRevocations: string[] = [];
  let inviteHashes: string[] = [];

  beforeAll(async () => {
    H = await household(olive, "Journal home");
    const first = await invite(olive, H);
    await accept(pat, first.token);
    await accept(quin, first.token);

    groceries = await addExpense(olive, H, {
      title: "Groceries",
      amount: 150000,
      payer: olive,
      people: [olive, pat, quin],
    });
    // Olive, who added it, edits it (D6): a new amount and category, and
    // Quin is no longer in it.
    const loaded = await admin
      .from("expenses")
      .select("updated_at")
      .eq("id", groceries)
      .single();
    if (loaded.error) throw loaded.error;
    const edit = await olive.client.rpc("update_expense", {
      target_expense_id: groceries,
      title: "Groceries",
      amount: 160000,
      expense_category: "dining",
      spent_on: "2026-11-12",
      payer_id: olive.id,
      method: "equal",
      shares: equalShares(160000, [olive, pat]),
      expected_updated_at: loaded.data.updated_at,
    });
    if (edit.error) throw edit.error;

    // Pat owes Olive ₹800.00 and records paying ₹500.00 of it; Olive voids it.
    const recorded = await pat.client.rpc("record_settlement", {
      target_household_id: H,
      payer_id: pat.id,
      recipient_id: olive.id,
      amount: 50000,
      paid_on: "2026-11-12",
      memo: NOTE,
    });
    if (recorded.error) throw recorded.error;
    payment = recorded.data;
    const voided = await olive.client.rpc("void_settlement", {
      target_settlement_id: payment,
    });
    if (voided.error) throw voided.error;

    // Quin creates a link, then leaves: the link is revoked with the leave.
    const quinsLink = await invite(quin, H);
    hiddenRevocations.push(quinsLink.id);
    const left = await quin.client.rpc("leave_household", {
      target_household_id: H,
    });
    if (left.error) throw left.error;

    electricity = await addExpense(olive, H, {
      title: "Electricity",
      amount: 90000,
      payer: pat,
      people: [olive, pat],
      category: "utilities",
    });
    for (const fn of ["delete_expense", "restore_expense"] as const) {
      const { error } = await olive.client.rpc(fn, {
        target_expense_id: electricity,
      });
      if (error) throw error;
    }

    const revoked = await olive.client
      .from("invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", first.id);
    if (revoked.error) throw revoked.error;

    const transferred = await olive.client.rpc("transfer_ownership", {
      target_household_id: H,
      new_owner_user_id: pat.id,
    });
    if (transferred.error) throw transferred.error;

    // Pat, now the owner, invites Raj; Raj creates a link and is removed.
    const patsLink = await invite(pat, H);
    await accept(raj, patsLink.token);
    const rajsLink = await invite(raj, H);
    hiddenRevocations.push(rajsLink.id);
    const removed = await pat.client.rpc("remove_member", {
      target_household_id: H,
      member_user_id: raj.id,
    });
    if (removed.error) throw removed.error;

    const hashes = await admin
      .from("invitations")
      .select("token_hash")
      .eq("household_id", H);
    if (hashes.error) throw hashes.error;
    inviteHashes = hashes.data.map((row) => row.token_hash);
  }, 60_000);

  it("has one entry per operation, newest first, attributed to whoever did it", async () => {
    const { entries } = await wholeJournal(pat, H);
    expect(entries.map((e) => [e.detail.type, e.actorId])).toEqual([
      ["member_removed", pat.id],
      ["invitation_created", raj.id],
      ["member_joined", raj.id],
      ["invitation_created", pat.id],
      ["ownership_transferred", olive.id],
      ["invitation_revoked", olive.id],
      ["expense_restored", olive.id],
      ["expense_deleted", olive.id],
      ["expense_created", olive.id],
      ["member_left", quin.id],
      ["invitation_created", quin.id],
      ["settlement_voided", olive.id],
      ["settlement_recorded", pat.id],
      ["expense_updated", olive.id],
      ["expense_created", olive.id],
      ["member_joined", quin.id],
      ["member_joined", pat.id],
      ["invitation_created", olive.id],
      ["household_created", olive.id],
    ]);
  });

  it("matches what's stored, in Postgres order, except revocations that were part of leaving", async () => {
    const stored = await storedEvents(H);
    const { entries } = await wholeJournal(pat, H);
    expect(entries.map((e) => e.id)).toEqual(
      expectedVisible(stored).map((e) => e.id),
    );
    // The links revoked by Quin leaving and by Raj's removal are stored, as
    // well as the one Olive revoked herself...
    const revocations = stored.filter((e) => e.type === "invitation_revoked");
    expect(revocations).toHaveLength(3);
    expect(revocations.map((e) => e.entity_id)).toEqual(
      expect.arrayContaining(hiddenRevocations),
    );
    // ...but only Olive's own revocation is an entry.
    expect(
      entries.filter((e) => e.detail.type === "invitation_revoked"),
    ).toHaveLength(1);
  });

  it("carries what each entry needs, and what its record looks like now", async () => {
    const { entries } = await wholeJournal(pat, H);
    const find = (type: string) =>
      entries.filter((e) => e.detail.type === type);

    expect(find("household_created")[0].detail).toEqual({
      type: "household_created",
      name: `Journal home ${runId}`,
    });
    expect(find("member_joined").map((e) => e.detail)).toEqual([
      { type: "member_joined", userId: raj.id, inviterId: pat.id },
      { type: "member_joined", userId: quin.id, inviterId: olive.id },
      { type: "member_joined", userId: pat.id, inviterId: olive.id },
    ]);
    expect(find("member_removed")[0].detail).toEqual({
      type: "member_removed",
      userId: raj.id,
    });
    expect(find("ownership_transferred")[0].detail).toEqual({
      type: "ownership_transferred",
      fromUserId: olive.id,
      toUserId: pat.id,
    });
    expect(find("invitation_revoked")[0].detail).toEqual({
      type: "invitation_revoked",
      createdBy: olive.id,
    });

    const [edit] = find("expense_updated");
    expect(edit.detail).toEqual({
      type: "expense_updated",
      before: {
        description: "Groceries",
        amountMinor: BigInt(150000),
        category: "groceries",
        paidBy: olive.id,
        expenseDate: "2026-11-12",
        splitMethod: "equal",
        participants: [olive.id, pat.id, quin.id].sort(),
      },
      after: {
        description: "Groceries",
        amountMinor: BigInt(160000),
        category: "dining",
        paidBy: olive.id,
        expenseDate: "2026-11-12",
        splitMethod: "equal",
        participants: [olive.id, pat.id].sort(),
      },
      sharesChanged: true,
    });
    expect(edit.entity).toEqual({
      available: true,
      id: groceries,
      state: "active",
    });

    for (const e of find("settlement_recorded").concat(
      find("settlement_voided"),
    )) {
      expect(e.detail).toMatchObject({
        settlement: {
          fromUser: pat.id,
          toUser: olive.id,
          amountMinor: BigInt(50000),
          settledOn: "2026-11-12",
          recordedBy: pat.id,
        },
      });
      // Both entries link to the payment, which is voided now.
      expect(e.entity).toEqual({
        available: true,
        id: payment,
        state: "voided",
      });
    }
    // Electricity was deleted and restored: every entry about it sees it now.
    for (const type of [
      "expense_created",
      "expense_deleted",
      "expense_restored",
    ]) {
      const about = find(type).filter(
        (e) => e.entity?.available && e.entity.id === electricity,
      );
      expect(about, type).toHaveLength(1);
      expect(about[0].entity).toMatchObject({ state: "active" });
    }
  });

  it("names everyone it mentions, marking who has left", async () => {
    const { page } = await journalPage(pat, H, { pageSize: 100 });
    expect(
      page.people
        .map((p) => [p.displayName, p.isActive])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["Olive", true],
      ["Pat", true],
      ["Quin", false],
      ["Raj", false],
    ]);
  });

  it("reads as the app shows it", async () => {
    const { page } = await journalPage(pat, H, { pageSize: 100 });
    const describe = entryDescriber({
      householdId: H,
      viewerId: pat.id,
      currency: "INR",
      people: page.people,
    });
    const titles = page.entries.map((e) => describe(e).title);
    expect(titles).toEqual([
      "You removed Raj from the household",
      "Raj (left) created an invite link",
      "Raj (left) joined the household",
      "You created an invite link",
      "Olive made you the owner",
      "Olive revoked an invite link",
      "Olive restored an expense",
      "Olive deleted an expense",
      "Olive added an expense",
      "Quin left the household",
      "Quin (left) created an invite link",
      "Olive voided a payment",
      "You recorded a payment of ₹500.00 to Olive",
      "Olive edited an expense",
      "Olive added an expense",
      "Quin (left) joined the household",
      "You joined the household",
      "Olive created an invite link",
      `Olive created the household “Journal home ${runId}”`,
    ]);
    const edit = describe(page.entries[13]);
    expect(edit.changes).toEqual([
      { kind: "value", label: "Amount", from: "₹1,500.00", to: "₹1,600.00" },
      { kind: "value", label: "Category", from: "Groceries", to: "Dining" },
      { kind: "text", label: "Who shares it", text: "removed Quin (left)" },
    ]);
  });

  it("filters by expenses, settlements or the household, and the three make the whole", async () => {
    const all = (await wholeJournal(pat, H)).entries;
    const parts: Record<string, JournalEntry[]> = {};
    for (const filter of ["expenses", "settlements", "household"] as const) {
      parts[filter] = (await wholeJournal(pat, H, { filter })).entries;
      expect(parts[filter].every((e) => entryCategory(e) === filter)).toBe(
        true,
      );
      expect(parts[filter].map((e) => e.id)).toEqual(
        all.filter((e) => entryCategory(e) === filter).map((e) => e.id),
      );
    }
    expect(parts.expenses.map((e) => e.detail.type)).toEqual([
      "expense_restored",
      "expense_deleted",
      "expense_created",
      "expense_updated",
      "expense_created",
    ]);
    expect(parts.settlements.map((e) => e.detail.type)).toEqual([
      "settlement_voided",
      "settlement_recorded",
    ]);
    expect(
      parts.expenses.length + parts.settlements.length + parts.household.length,
    ).toBe(all.length);
  });

  it("pages the same entries in the same order, whatever the page size", async () => {
    const reference = (await wholeJournal(pat, H, { pageSize: 100 })).entries;
    for (const pageSize of [1, 2, 3, 7, 18, 19]) {
      const { entries, pages } = await wholeJournal(pat, H, { pageSize });
      expect(
        entries.map((e) => e.id),
        `page size ${pageSize}`,
      ).toEqual(reference.map((e) => e.id));
      expect(pages).toBe(Math.max(1, Math.ceil(reference.length / pageSize)));
    }
    for (const pageSize of [2, 3]) {
      const { entries } = await wholeJournal(pat, H, {
        filter: "expenses",
        pageSize,
      });
      expect(entries.map((e) => e.id)).toEqual(
        reference
          .filter((e) => entryCategory(e) === "expenses")
          .map((e) => e.id),
      );
    }
  });

  it("leaves out notes, tokens, shares, invite settings and raw summaries", async () => {
    const { raw } = await wholeJournal(pat, H, { pageSize: 5 });
    const text = JSON.stringify(raw);
    // The note is stored with the event, but the journal doesn't pass it on.
    const stored = JSON.stringify(await storedEvents(H));
    expect(stored).toContain(NOTE);
    expect(text).not.toContain(NOTE);
    for (const hash of inviteHashes) expect(text).not.toContain(hash);
    expect(text).not.toContain("@example.com");
    for (const key of [
      '"summary"',
      '"note"',
      '"memo"',
      '"splits"',
      '"share_minor"',
      '"percentage_bp"',
      '"max_uses"',
      '"expires_at"',
      '"invitation_id"',
      '"token',
      '"currency_code"',
      '"timezone"',
    ]) {
      expect(text, key).not.toContain(key);
    }
  });

  it("is refused to anyone who isn't an active member now", async () => {
    // Removed (Raj), left (Quin), never a member (Xena).
    for (const user of [raj, quin, xena]) {
      const { data, error } = await user.client.rpc(
        "household_journal",
        journalArgs(H),
      );
      expectError(error, PERMISSION_DENIED);
      expect(data).toBeNull();
      const direct = await user.client
        .from("activity_events")
        .select("id")
        .eq("household_id", H);
      expect(direct.data ?? []).toEqual([]);
    }
    const anon = await anonClient().rpc("household_journal", journalArgs(H));
    expect(anon.error).not.toBeNull();
    expect(anon.data).toBeNull();
    // A household id that doesn't exist answers the same way.
    const forged = await pat.client.rpc(
      "household_journal",
      journalArgs(randomUUID()),
    );
    expectError(forged.error, PERMISSION_DENIED);
  });

  it("doesn't change any money, and reading it changes nothing at all", async () => {
    const records = async () => ({
      expenses: (
        await admin
          .from("expenses")
          .select("*, expense_splits(*)")
          .eq("household_id", H)
          .order("id")
      ).data,
      settlements: (
        await admin
          .from("settlements")
          .select("*")
          .eq("household_id", H)
          .order("id")
      ).data,
    });
    const before = {
      balances: await balances(pat, H),
      events: await eventCount(H),
      records: await records(),
    };
    expect(before.records.expenses).toHaveLength(2);
    expect(before.records.settlements).toHaveLength(1);
    for (const filter of [
      "all",
      "expenses",
      "settlements",
      "household",
    ] as const) {
      await wholeJournal(pat, H, { filter, pageSize: 2 });
    }
    // Journal-only operations: an invite link created and revoked.
    const link = await invite(pat, H);
    const revoke = await pat.client
      .from("invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", link.id);
    if (revoke.error) throw revoke.error;

    expect(await balances(pat, H)).toEqual(before.balances);
    expect(await eventCount(H)).toBe(before.events + 2);
    expect(await records()).toEqual(before.records);
  });

  it("stays append-only, even for the service role", async () => {
    const update = await admin
      .from("activity_events")
      .update({ summary: { edited: true } })
      .eq("household_id", H);
    expectError(update.error, PERMISSION_DENIED);
    const del = await admin
      .from("activity_events")
      .delete()
      .eq("household_id", H);
    expectError(del.error, PERMISSION_DENIED);
  });
});

// ---------------------------------------------------------------------------
// Consistency: an entry exists exactly when its change was committed
// ---------------------------------------------------------------------------

describe("consistency with the operations", () => {
  let C: string;
  let token: string;

  beforeAll(async () => {
    C = await household(olive, "Consistency home");
    const link = await invite(olive, C);
    token = link.token;
    await accept(pat, token);
  });

  it("refused operations write no entry", async () => {
    const count = await eventCount(C);
    const expense = await addExpense(olive, C, {
      title: "Rent",
      amount: 100000,
      payer: olive,
      people: [olive, pat],
    });
    expect(await eventCount(C)).toBe(count + 1);
    const loaded = await admin
      .from("expenses")
      .select("updated_at")
      .eq("id", expense)
      .single();
    if (loaded.error) throw loaded.error;

    const refusals: [PromiseLike<{ error: PostgrestError | null }>, string][] =
      [
        // Shares that don't add up.
        [
          olive.client.rpc("create_expense", {
            ...expenseArgs(C, {
              title: "Bad split",
              amount: 1000,
              payer: olive,
              people: [olive],
            }),
            shares: [
              { user_id: olive.id, share_minor: 999, percentage_bp: null },
            ],
          }),
          INVALID_SPLIT,
        ],
        // Someone outside the household.
        [
          xena.client.rpc(
            "create_expense",
            expenseArgs(C, {
              title: "Intruder",
              amount: 1000,
              payer: xena,
              people: [xena],
            }),
          ),
          PERMISSION_DENIED,
        ],
        // An edit made from a stale form.
        [
          olive.client.rpc("update_expense", {
            target_expense_id: expense,
            title: "Rent",
            amount: 120000,
            expense_category: "groceries",
            spent_on: "2026-11-12",
            payer_id: olive.id,
            method: "equal",
            shares: equalShares(120000, [olive, pat]),
            expected_updated_at: "2000-01-01T00:00:00Z",
          }),
          CHANGED_SINCE_LOADED,
        ],
        // More than what's owed, without acknowledging it (D9).
        [
          pat.client.rpc("record_settlement", {
            target_household_id: C,
            payer_id: pat.id,
            recipient_id: olive.id,
            amount: 999999,
            paid_on: "2026-11-12",
          }),
          MORE_THAN_OWED,
        ],
        // Leaving or removal with a balance (D13, O8); the owner leaving (D13).
        [
          pat.client.rpc("leave_household", { target_household_id: C }),
          BALANCE_NOT_ZERO,
        ],
        [
          olive.client.rpc("remove_member", {
            target_household_id: C,
            member_user_id: pat.id,
          }),
          BALANCE_NOT_ZERO,
        ],
        [
          olive.client.rpc("leave_household", { target_household_id: C }),
          OWNER_MUST_TRANSFER,
        ],
      ];
    for (const [call, code] of refusals) {
      expectError((await call).error, code);
    }

    // An edit that changes nothing succeeds but isn't an event either.
    const same = await olive.client.rpc("update_expense", {
      target_expense_id: expense,
      title: "Rent",
      amount: 100000,
      expense_category: "groceries",
      spent_on: "2026-11-12",
      payer_id: olive.id,
      method: "equal",
      shares: equalShares(100000, [olive, pat]),
      expected_updated_at: loaded.data.updated_at,
    });
    expect(same.error).toBeNull();

    // A revoked link can't be used to join.
    const revokedLink = await invite(olive, C);
    const revoke = await olive.client
      .from("invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", revokedLink.id);
    if (revoke.error) throw revoke.error;
    const joined = await raj.client.rpc("accept_invite", {
      token: revokedLink.token,
    });
    expectError(joined.error, INVITE_NOT_VALID);

    // Only the expense, the new link and its revocation were written.
    expect(await eventCount(C)).toBe(count + 3);
  });

  it("a repeated submission or transition writes one entry", async () => {
    const key = randomUUID();
    const input = {
      title: "Internet",
      amount: 80000,
      payer: pat,
      people: [olive, pat],
      key,
    };
    const first = await addExpense(pat, C, input);
    expect(await addExpense(pat, C, input)).toBe(first);

    const deleted = await pat.client.rpc("delete_expense", {
      target_expense_id: first,
    });
    expect(deleted.error).toBeNull();
    const again = await pat.client.rpc("delete_expense", {
      target_expense_id: first,
    });
    expectError(again.error, ALREADY_DELETED);

    // Pat owes Olive for the rent, so paying part of it needs no warning.
    const settleKey = randomUUID();
    const settle = () =>
      pat.client.rpc("record_settlement", {
        target_household_id: C,
        payer_id: pat.id,
        recipient_id: olive.id,
        amount: 100,
        paid_on: "2026-11-12",
        request_key: settleKey,
      });
    const recorded = await settle();
    if (recorded.error) throw recorded.error;
    expect((await settle()).data).toBe(recorded.data);
    expect(
      (
        await olive.client.rpc("void_settlement", {
          target_settlement_id: recorded.data,
        })
      ).error,
    ).toBeNull();
    expectError(
      (
        await pat.client.rpc("void_settlement", {
          target_settlement_id: recorded.data,
        })
      ).error,
      ALREADY_VOIDED,
    );

    const houseKey = randomUUID();
    const home = await household(raj, "Repeat home", houseKey);
    expect(await household(raj, "Repeat home", houseKey)).toBe(home);

    // Joining again as a member uses no invite and writes nothing.
    await accept(pat, token);

    const events = await storedEvents(C);
    const { data } = await admin
      .from("activity_events")
      .select("type, entity_id")
      .in("entity_id", [first, recorded.data]);
    expect(data?.map((row) => row.type).sort()).toEqual([
      "expense_created",
      "expense_deleted",
      "settlement_recorded",
      "settlement_voided",
    ]);
    expect((await storedEvents(home)).map((e) => e.type)).toEqual([
      "household_created",
    ]);
    expect(events.filter((e) => e.type === "member_joined")).toHaveLength(1);
  });

  it("concurrent repeats still write one entry", async () => {
    const key = randomUUID();
    const input = {
      title: "Water",
      amount: 30000,
      payer: olive,
      people: [olive, pat],
      key,
    };
    const ids = await Promise.all([
      addExpense(olive, C, input),
      addExpense(olive, C, input),
      addExpense(olive, C, input),
    ]);
    expect(new Set(ids).size).toBe(1);

    // Recorded by Olive, the recipient (D9); Pat owes Olive, so no warning.
    const settlement = await olive.client.rpc("record_settlement", {
      target_household_id: C,
      payer_id: pat.id,
      recipient_id: olive.id,
      amount: 100,
      paid_on: "2026-11-12",
    });
    if (settlement.error) throw settlement.error;
    const voids = await Promise.all([
      olive.client.rpc("void_settlement", {
        target_settlement_id: settlement.data,
      }),
      pat.client.rpc("void_settlement", {
        target_settlement_id: settlement.data,
      }),
    ]);
    expect(voids.filter((v) => v.error === null)).toHaveLength(1);
    expectError(
      voids.find((v) => v.error !== null)?.error ?? null,
      ALREADY_VOIDED,
    );

    const { data } = await admin
      .from("activity_events")
      .select("type")
      .in("entity_id", [ids[0], settlement.data]);
    expect(data?.map((row) => row.type).sort()).toEqual([
      "expense_created",
      "settlement_recorded",
      "settlement_voided",
    ]);
  });

  /**
   * Runs `statement` as `user` inside a transaction in which writing any
   * journal event fails. psql stops at the error and the transaction is
   * rolled back; nothing here is ever committed.
   */
  function withFailingJournal(user: User, statement: string) {
    return psqlAsSuperuser(`
\\set VERBOSITY terse
begin;
create function public.journal_test_refuse_event() returns trigger
language plpgsql as $f$ begin raise exception 'journal write refused'; end $f$;
create trigger journal_test_refuse_event before insert on public.activity_events
for each row execute function public.journal_test_refuse_event();
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${user.id}","role":"authenticated"}', true);
${statement};
commit;
`);
  }

  it("an operation whose entry can't be written doesn't happen", async () => {
    const count = await eventCount(C);
    const title = `Never saved ${runId}`;
    const expense = withFailingJournal(
      olive,
      `select public.create_expense('${C}', '${title}', 1000, 'other', '2026-11-12', '${olive.id}', 'custom', '[{"user_id":"${olive.id}","share_minor":1000,"percentage_bp":null}]'::jsonb)`,
    );
    expect(expense.status).not.toBe(0);
    expect(expense.stderr).toContain("journal write refused");
    const saved = await admin
      .from("expenses")
      .select("id")
      .eq("description", title);
    expect(saved.data).toEqual([]);

    const settlement = withFailingJournal(
      pat,
      `select public.record_settlement('${C}', '${pat.id}', '${olive.id}', 1, '2026-11-12', '${title}')`,
    );
    expect(settlement.status).not.toBe(0);
    expect(settlement.stderr).toContain("journal write refused");
    const recorded = await admin
      .from("settlements")
      .select("id")
      .eq("note", title);
    expect(recorded.data).toEqual([]);

    // The trigger and its function were never committed either.
    expect(await eventCount(C)).toBe(count);
    const stillWorks = await addExpense(olive, C, {
      title: "After the test",
      amount: 1000,
      payer: olive,
      people: [olive],
    });
    expect(stillWorks).toBeTruthy();
    expect(await eventCount(C)).toBe(count + 1);
  });

  it("an operation rolled back takes its entry with it", async () => {
    const count = await eventCount(C);
    const title = `Rolled back ${runId}`;
    const result = psqlAsSuperuser(`
\\set VERBOSITY terse
\\pset tuples_only on
\\pset format unaligned
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${olive.id}","role":"authenticated"}', true);
select public.create_expense('${C}', '${title}', 1000, 'other', '2026-11-12', '${olive.id}', 'custom', '[{"user_id":"${olive.id}","share_minor":1000,"percentage_bp":null}]'::jsonb);
select 'events=' || count(*) from public.activity_events where household_id = '${C}';
rollback;
`);
    expect(result.status).toBe(0);
    // Inside the transaction the entry was there, with the expense...
    expect(result.stdout).toContain(`events=${count + 1}`);
    // ...and after the rollback, neither is.
    expect(await eventCount(C)).toBe(count);
    const saved = await admin
      .from("expenses")
      .select("id")
      .eq("description", title);
    expect(saved.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Order and pages when entries share a timestamp
// ---------------------------------------------------------------------------

describe("ties and cursors", () => {
  let T: string;
  const SAME = "2026-11-10T09:15:00.123456+00:00";
  const LATER = "2026-11-10T09:15:00.123457+00:00";
  let tied: string[];

  beforeAll(async () => {
    T = await household(olive, "Tie home");
    // Test fixtures only, in a throwaway household: entries written in one
    // transaction share its timestamp, so make several that do, and one a
    // microsecond later.
    const rows = Array.from({ length: 7 }, () => ({
      household_id: T,
      actor_id: olive.id,
      type: "invitation_created" as const,
      entity_type: "invitation" as const,
      entity_id: randomUUID(),
      summary: {},
      created_at: SAME,
    }));
    rows.push({ ...rows[0], entity_id: randomUUID(), created_at: LATER });
    const { data, error } = await admin
      .from("activity_events")
      .insert(rows)
      .select("id, created_at");
    if (error) throw error;
    tied = data
      .filter((row) => row.created_at.startsWith("2026-11-10T09:15:00.123456"))
      .map((row) => row.id)
      .sort()
      .reverse();
  });

  it("orders entries with the same time by id, and pages through them without repeats", async () => {
    const reference = (await wholeJournal(olive, T, { pageSize: 100 })).entries;
    // Newest first: household_created (now), the later one, then the tie.
    expect(reference.map((e) => e.detail.type)[0]).toBe("household_created");
    expect(reference[1].createdUs).toBe(reference[2].createdUs + BigInt(1));
    expect(reference.slice(2).map((e) => e.id)).toEqual(tied);
    for (const pageSize of [1, 2, 3, 4]) {
      const { entries } = await wholeJournal(olive, T, { pageSize });
      expect(
        entries.map((e) => e.id),
        `page size ${pageSize}`,
      ).toEqual(reference.map((e) => e.id));
    }
  });

  it("continues after a cursor in the middle of a tie", async () => {
    const reference = (await wholeJournal(olive, T, { pageSize: 100 })).entries;
    const middle = reference[4];
    const { page } = await journalPage(olive, T, {
      before: { us: middle.createdUs, id: middle.id },
      pageSize: 100,
    });
    expect(page.entries.map((e) => e.id)).toEqual(
      reference.slice(5).map((e) => e.id),
    );
    expect(page.hasMore).toBe(false);
  });

  it("doesn't let entries added meanwhile into older pages", async () => {
    const first = await journalPage(olive, T, { pageSize: 3 });
    // Something new happens between two pages.
    await invite(olive, T);
    const cursor = nextCursor(first.page);
    expect(cursor).not.toBeNull();
    const rest = await wholeJournal(olive, T, { pageSize: 3 });
    const second = await journalPage(olive, T, {
      before: cursor,
      pageSize: 100,
    });
    const seen = [...first.page.entries, ...second.page.entries].map(
      (e) => e.id,
    );
    expect(new Set(seen).size).toBe(seen.length);
    // The new entry is on top of the journal, not in the older pages.
    expect(rest.entries[0].detail.type).toBe("invitation_created");
    expect(seen).not.toContain(rest.entries[0].id);
    expect(seen).toEqual(rest.entries.slice(1).map((e) => e.id));
  });

  it("answers a cursor past the end with an empty page", async () => {
    const { page } = await journalPage(olive, T, {
      before: { us: BigInt(0), id: "00000000-0000-4000-8000-000000000000" },
    });
    expect(page).toEqual({ hasMore: false, entries: [], people: [] });
  });

  it("refuses input that can't be right", async () => {
    const id = randomUUID();
    const bad: Record<string, unknown>[] = [
      { category_filter: "analytics" },
      { category_filter: "Chores" },
      { category_filter: "" },
      { page_size: 0 },
      { page_size: 101 },
      { before_us: 1 },
      { before_id: id },
      { before_us: -1, before_id: id },
      { before_us: 253402300800000000, before_id: id },
    ];
    for (const args of bad) {
      const { error } = await olive.client.rpc("household_journal", {
        target_household_id: T,
        ...args,
      } as never);
      expectError(error, INVALID_PARAMETER);
    }
  });
});

// ---------------------------------------------------------------------------
// Records the journal points at
// ---------------------------------------------------------------------------

describe("related records", () => {
  let X: string;
  let secret: string;
  let R: string;

  beforeAll(async () => {
    X = await household(xena, "Other home");
    secret = await addExpense(xena, X, {
      title: `Xena's rent ${runId}`,
      amount: 2500000,
      payer: xena,
      people: [xena],
    });
    R = await household(olive, "Records home");
  });

  it("never links to another household's record, even if an event names it", async () => {
    // A forged event (fixture, service role) in Olive's household that points
    // at Xena's expense.
    const { error } = await admin.from("activity_events").insert({
      household_id: R,
      actor_id: olive.id,
      type: "expense_created",
      entity_type: "expense",
      entity_id: secret,
      summary: {
        after: {
          description: "Forged",
          amount_minor: 1,
          category: "other",
          paid_by: olive.id,
          splits: [],
        },
      },
    });
    if (error) throw error;

    const { page, raw } = await journalPage(olive, R);
    const forged = page.entries.find(
      (e) => e.detail.type === "expense_created",
    );
    expect(forged?.entity).toEqual({ available: false });
    const describe = entryDescriber({
      householdId: R,
      viewerId: olive.id,
      currency: "INR",
      people: page.people,
    });
    expect(describe(forged!)).toMatchObject({ link: null, unavailable: true });
    expect(JSON.stringify(raw)).not.toContain(secret);
    expect(JSON.stringify(raw)).not.toContain("Xena");
    // And the expense itself stays out of reach.
    const direct = await olive.client
      .from("expenses")
      .select("id")
      .eq("id", secret);
    expect(direct.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Membership changes and history
// ---------------------------------------------------------------------------

describe("history after membership changes", () => {
  it("a removed member sees nothing; rejoining shows the whole history again", async () => {
    const M = await household(olive, "Membership home");
    const first = await invite(olive, M);
    await accept(raj, first.token);
    const removed = await olive.client.rpc("remove_member", {
      target_household_id: M,
      member_user_id: raj.id,
    });
    if (removed.error) throw removed.error;
    expectError(
      (await raj.client.rpc("household_journal", journalArgs(M))).error,
      PERMISSION_DENIED,
    );

    const second = await invite(olive, M);
    await accept(raj, second.token);
    const { entries } = await wholeJournal(raj, M);
    const { page } = await journalPage(raj, M, { pageSize: 100 });
    const describe = entryDescriber({
      householdId: M,
      viewerId: raj.id,
      currency: "INR",
      people: page.people,
    });
    expect(entries.map((e) => describe(e).title)).toEqual([
      "You joined the household",
      "Olive created an invite link",
      "Olive removed you from the household",
      "You joined the household",
      "Olive created an invite link",
      `Olive created the household “Membership home ${runId}”`,
    ]);
  });
});
