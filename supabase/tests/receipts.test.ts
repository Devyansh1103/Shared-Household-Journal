// Receipts (roadmap Phase 19, D31) as real signed-in users against the local
// stack: the bucket, starting and storing a receipt (Storage policies: only
// the uploader, only to its own pending path, never overwriting), what a
// stored file must match, who sees what (unattached: the uploader only;
// attached: the household's active members), confirming an expense from a
// receipt (one transaction, retries, failures leave it waiting), attaching,
// replacing and removing (D6), discarding, clearing old uploads, deleting the
// household, and direct writes.
//
// Needs `npm run db:start`, then `npm run test:db`. Everything is created for
// this run and removed afterwards.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "@/lib/expenses/dates";
import {
  adminClient,
  anonClient,
  psqlAsSuperuser,
  signedInClient,
  type TypedClient,
} from "./support/local-supabase";

const TZ = "Asia/Kolkata";
const runId = randomUUID().slice(0, 8);
const password = `rcpt-${randomUUID()}`;
const admin = adminClient();

type User = { id: string; name: string; client: TypedClient };
const users: User[] = [];
let olive: User, pat: User, quin: User, xena: User;
let H: string, X: string;
let today: string;

async function must<T>(
  query: PromiseLike<{ data: T; error: PostgrestError | null }>,
): Promise<NonNullable<T>> {
  const { data, error } = await query;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("No data returned");
  return data;
}

function expectCode(error: PostgrestError | null, code: string) {
  expect(error, `expected ${code}`).not.toBeNull();
  expect(error?.code).toBe(code);
}

async function createUser(name: string): Promise<User> {
  const email = `rcpt-${runId}-${name.toLowerCase()}@example.com`;
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

async function household(owner: User, name: string, ...members: User[]) {
  const id = await must(
    owner.client.rpc("create_household", {
      household_name: `${name} ${runId}`,
      currency: "INR",
      time_zone: TZ,
    }),
  );
  const bytes = randomBytes(32);
  const insert = await owner.client.from("invitations").insert({
    household_id: id,
    token_hash: createHash("sha256").update(bytes).digest("hex"),
  });
  if (insert.error) throw insert.error;
  for (const member of members) {
    await must(
      member.client.rpc("accept_invite", {
        token: bytes.toString("base64url"),
      }),
    );
  }
  return id;
}

/** Stand-in image bytes: Storage keeps what it's given (the app checks images). */
function fakeJpeg(size = 2048): Uint8Array {
  const bytes = randomBytes(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  return new Uint8Array(bytes);
}

type Started = { receipt_id: string; storage_path: string; status: string };

async function start(
  user: User,
  householdId: string,
  bytes: Uint8Array,
  key: string = randomUUID(),
) {
  return (await must(
    user.client.rpc("create_receipt", {
      target_household_id: householdId,
      content_type: "image/jpeg",
      byte_size: bytes.length,
      width: 1200,
      height: 2400,
      request_key: key,
    }),
  )) as Started;
}

function upload(
  user: User,
  path: string,
  bytes: Uint8Array,
  contentType = "image/jpeg",
) {
  return user.client.storage
    .from("receipts")
    .upload(path, bytes, { contentType, upsert: false });
}

/** A receipt stored and waiting for review. */
async function uploaded(user: User, householdId: string) {
  const bytes = fakeJpeg();
  const r = await start(user, householdId, bytes);
  const stored = await upload(user, r.storage_path, bytes);
  if (stored.error) throw stored.error;
  const marked = await user.client.rpc("mark_receipt_uploaded", {
    target_receipt_id: r.receipt_id,
  });
  if (marked.error) throw marked.error;
  return { id: r.receipt_id, path: r.storage_path, bytes };
}

function expenseArgs(
  householdId: string,
  payer: User,
  people: User[],
  amount = 1000,
) {
  const each = amount / people.length;
  return {
    title: "Groceries",
    amount,
    expense_category: "groceries" as const,
    spent_on: today,
    payer_id: payer.id,
    method: "equal" as const,
    shares: people.map((p) => ({
      user_id: p.id,
      share_minor: each,
      percentage_bp: null,
    })),
    target_household_id: householdId,
  };
}

async function confirm(
  user: User,
  receiptId: string,
  householdId: string,
  key: string = randomUUID(),
) {
  const { target_household_id: _unused, ...args } = expenseArgs(
    householdId,
    user,
    [olive, pat],
  );
  void _unused;
  return user.client.rpc("create_expense_with_receipt", {
    target_receipt_id: receiptId,
    ...args,
    request_key: key,
  });
}

async function row(id: string) {
  const { data } = await admin
    .from("receipts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function objectExists(path: string): Promise<boolean> {
  const out = psqlAsSuperuser(
    `\\pset tuples_only on\n\\pset format unaligned\nselect count(*) from storage.objects where bucket_id = 'receipts' and name = '${path.replace(/'/g, "")}';`,
  );
  return out.stdout.trim() === "1";
}

beforeAll(async () => {
  [olive, pat, quin, xena] = await Promise.all(
    ["Olive", "Pat", "Quin", "Xena"].map(createUser),
  );
  H = await household(olive, "Receipts", pat, quin);
  X = await household(xena, "Elsewhere");
  today = todayIn(TZ);
}, 60_000);

afterAll(async () => {
  const ids = users.map((u) => u.id);
  if (!ids.length) return;
  // Files first (rows cascade with households; files don't).
  const listed = psqlAsSuperuser(
    `\\pset tuples_only on\n\\pset format unaligned\nselect r.storage_path from public.receipts r where r.household_id in (select id from public.households where created_by in (${ids.map((i) => `'${i}'`).join(",")}));`,
  );
  const paths = listed.stdout.trim().split("\n").filter(Boolean);
  if (paths.length) await admin.storage.from("receipts").remove(paths);
  await admin.from("households").delete().in("created_by", ids);
  await admin.from("profiles").delete().in("id", ids);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
});

describe("the bucket", () => {
  it("is private, images only, at most 4 MiB", async () => {
    const out = psqlAsSuperuser(
      `\\pset tuples_only on\n\\pset format unaligned\nselect public || '|' || file_size_limit || '|' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'receipts';`,
    );
    expect(out.stdout.trim()).toBe(
      "false|4194304|image/jpeg,image/png,image/webp",
    );
    // No public URL works.
    const { data } = admin.storage
      .from("receipts")
      .getPublicUrl(`${H}/anything.jpg`);
    const response = await fetch(data.publicUrl);
    expect(response.ok).toBe(false);
  });
});

describe("starting and storing a receipt", () => {
  it("lets a member start one; the path is fixed by the database", async () => {
    const bytes = fakeJpeg();
    const r = await start(pat, H, bytes);
    expect(r.status).toBe("pending");
    expect(r.storage_path).toBe(`${H}/${r.receipt_id}.jpg`);
    expect(await row(r.receipt_id)).toMatchObject({
      uploaded_by: pat.id,
      household_id: H,
      byte_size: bytes.length,
    });
  });

  it("refuses outsiders and impossible files", async () => {
    const outsider = await xena.client.rpc("create_receipt", {
      target_household_id: H,
      content_type: "image/jpeg",
      byte_size: 100,
      width: 1000,
      height: 1000,
    });
    expectCode(outsider.error, "42501");
    for (const bad of [
      {
        content_type: "application/pdf",
        byte_size: 100,
        width: 1000,
        height: 1000,
      },
      {
        content_type: "image/svg+xml",
        byte_size: 100,
        width: 1000,
        height: 1000,
      },
      {
        content_type: "image/jpeg",
        byte_size: 4194305,
        width: 1000,
        height: 1000,
      },
      { content_type: "image/jpeg", byte_size: 0, width: 1000, height: 1000 },
      { content_type: "image/jpeg", byte_size: 100, width: 9000, height: 1000 },
    ]) {
      const { error } = await pat.client.rpc("create_receipt", {
        target_household_id: H,
        ...bad,
      });
      expectCode(error, "23514");
    }
  });

  it("returns the same receipt for a repeated request key", async () => {
    const key = randomUUID();
    const bytes = fakeJpeg();
    const first = await start(quin, H, bytes, key);
    const again = await start(quin, H, bytes, key);
    expect(again.receipt_id).toBe(first.receipt_id);
    const { count } = await admin
      .from("receipts")
      .select("id", { count: "exact", head: true })
      .eq("creation_key", key);
    expect(count).toBe(1);
  });

  it("stores the file only for its own uploader, at its own path, once", async () => {
    const bytes = fakeJpeg();
    const r = await start(olive, H, bytes);
    // Someone else, even in the household, can't fill it.
    expect((await upload(pat, r.storage_path, bytes)).error).not.toBeNull();
    // Nobody can store a file without a receipt row.
    expect(
      (await upload(olive, `${H}/${randomUUID()}.jpg`, bytes)).error,
    ).not.toBeNull();
    // Only images, by the bucket's own rule.
    expect(
      (await upload(olive, r.storage_path, bytes, "text/html")).error,
    ).not.toBeNull();
    expect((await upload(olive, r.storage_path, bytes)).error).toBeNull();
    // Never overwritten, not even by its uploader.
    expect(
      (await upload(olive, r.storage_path, fakeJpeg())).error,
    ).not.toBeNull();
    const overwrite = await olive.client.storage
      .from("receipts")
      .upload(r.storage_path, fakeJpeg(), {
        contentType: "image/jpeg",
        upsert: true,
      });
    expect(overwrite.error).not.toBeNull();
  });

  it("marks it stored only when the file matches what was declared", async () => {
    const bytes = fakeJpeg(3000);
    const r = await start(pat, H, bytes);
    expectCode(
      (
        await pat.client.rpc("mark_receipt_uploaded", {
          target_receipt_id: r.receipt_id,
        })
      ).error,
      "HJ038",
    );
    // A file of another size than declared.
    expect(
      (await upload(pat, r.storage_path, fakeJpeg(1000))).error,
    ).toBeNull();
    expectCode(
      (
        await pat.client.rpc("mark_receipt_uploaded", {
          target_receipt_id: r.receipt_id,
        })
      ).error,
      "HJ038",
    );
    expect((await row(r.receipt_id))?.status).toBe("pending");

    const good = await uploaded(pat, H);
    expect(await row(good.id)).toMatchObject({ status: "uploaded" });
    // Again: nothing changes.
    expect(
      (
        await pat.client.rpc("mark_receipt_uploaded", {
          target_receipt_id: good.id,
        })
      ).error,
    ).toBeNull();
    // Someone else's receipt is "no such receipt".
    expectCode(
      (
        await olive.client.rpc("mark_receipt_uploaded", {
          target_receipt_id: good.id,
        })
      ).error,
      "HJ035",
    );
  });

  it("allows at most 10 waiting for review per person and household", async () => {
    const solo = await createUser("Solo");
    const S = await household(solo, "Busy");
    for (let i = 0; i < 10; i++) await start(solo, S, fakeJpeg(100));
    const { error } = await solo.client.rpc("create_receipt", {
      target_household_id: S,
      content_type: "image/png",
      byte_size: 100,
      width: 500,
      height: 500,
    });
    expectCode(error, "HJ037");
  });
});

describe("who sees a receipt", () => {
  it("shows one waiting for review to its uploader only", async () => {
    const r = await uploaded(pat, H);
    expect(
      await must(pat.client.from("receipts").select("id").eq("id", r.id)),
    ).toHaveLength(1);
    expect(
      await must(olive.client.from("receipts").select("id").eq("id", r.id)),
    ).toEqual([]);
    expect(
      (await pat.client.storage.from("receipts").download(r.path)).error,
    ).toBeNull();
    expect(
      (await olive.client.storage.from("receipts").download(r.path)).error,
    ).not.toBeNull();
    expect(
      (await xena.client.storage.from("receipts").download(r.path)).error,
    ).not.toBeNull();
    expect(
      (await anonClient().storage.from("receipts").download(r.path)).error,
    ).not.toBeNull();
    // Nor can anyone else delete it.
    await olive.client.storage.from("receipts").remove([r.path]);
    expect(await objectExists(r.path)).toBe(true);
  });
});

describe("confirming an expense from a receipt", () => {
  it("records the expense and attaches the receipt together; members then see it, others don't", async () => {
    const r = await uploaded(pat, H);
    const key = randomUUID();
    const expenseId = await must(confirm(pat, r.id, H, key));
    const expense = await must(
      admin.from("expenses").select("*").eq("id", expenseId).single(),
    );
    expect(expense).toMatchObject({
      household_id: H,
      amount_minor: 1000,
      created_by: pat.id,
      description: "Groceries",
    });
    expect(await row(r.id)).toMatchObject({
      status: "attached",
      expense_id: expenseId,
      attached_by: pat.id,
    });
    // The usual expense event, so the journal and notifications behave as ever.
    const events = await must(
      admin.from("activity_events").select("type").eq("entity_id", expenseId),
    );
    expect(events.map((e) => e.type)).toEqual(["expense_created"]);

    for (const member of [olive, quin]) {
      expect(
        await must(member.client.from("receipts").select("id").eq("id", r.id)),
      ).toHaveLength(1);
      const file = await member.client.storage
        .from("receipts")
        .download(r.path);
      expect(file.error).toBeNull();
      expect(new Uint8Array(await file.data!.arrayBuffer())).toEqual(r.bytes);
    }
    expect(
      await must(xena.client.from("receipts").select("id").eq("id", r.id)),
    ).toEqual([]);
    expect(
      (await xena.client.storage.from("receipts").download(r.path)).error,
    ).not.toBeNull();

    // Confirming again (a double click, a retry) records nothing new.
    expect(await must(confirm(pat, r.id, H, key))).toBe(expenseId);
    expect(await must(confirm(pat, r.id, H))).toBe(expenseId);
    const { count } = await admin
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("household_id", H)
      .eq("description", "Groceries")
      .eq("created_by", pat.id);
    expect(count).toBe(1);
  });

  it("is refused for someone else's receipt, a receipt still uploading, and outsiders", async () => {
    const theirs = await uploaded(pat, H);
    expectCode((await confirm(olive, theirs.id, H)).error, "HJ035");
    expectCode((await confirm(xena, theirs.id, H)).error, "HJ035");
    const pending = await start(olive, H, fakeJpeg());
    expectCode((await confirm(olive, pending.receipt_id, H)).error, "HJ036");
    expect((await row(theirs.id))?.status).toBe("uploaded");
  });

  it("leaves the receipt waiting when the expense is refused", async () => {
    const r = await uploaded(olive, H);
    const before = await admin
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("household_id", H);
    const { error } = await olive.client.rpc("create_expense_with_receipt", {
      target_receipt_id: r.id,
      title: "Broken split",
      amount: 1000,
      expense_category: "groceries",
      spent_on: today,
      payer_id: olive.id,
      method: "equal",
      shares: [{ user_id: olive.id, share_minor: 400, percentage_bp: null }],
    });
    expectCode(error, "HJ008");
    expect((await row(r.id))?.status).toBe("uploaded");
    const after = await admin
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("household_id", H);
    expect(after.count).toBe(before.count);
    // And with someone from another household in the split.
    const outsiderSplit = await olive.client.rpc(
      "create_expense_with_receipt",
      {
        target_receipt_id: r.id,
        title: "Outsider",
        amount: 1000,
        expense_category: "groceries",
        spent_on: today,
        payer_id: olive.id,
        method: "equal",
        shares: [{ user_id: xena.id, share_minor: 1000, percentage_bp: null }],
      },
    );
    expectCode(outsiderSplit.error, "HJ007");
    expect((await row(r.id))?.status).toBe("uploaded");
  });
});

describe("attaching, replacing and removing (D6)", () => {
  it("lets the expense's creator, payer or the owner attach and replace; the old one is removed", async () => {
    // Quin adds an expense Pat paid; Olive owns the household.
    const expenseId = await must(
      quin.client.rpc("create_expense", expenseArgs(H, pat, [pat, quin])),
    );
    const first = await uploaded(quin, H);
    const attached = await must(
      quin.client.rpc("attach_receipt", {
        target_expense_id: expenseId,
        target_receipt_id: first.id,
      }),
    );
    expect(attached).toEqual({ removed_path: null });
    const second = await uploaded(olive, H);
    const replaced = await must(
      olive.client.rpc("attach_receipt", {
        target_expense_id: expenseId,
        target_receipt_id: second.id,
      }),
    );
    expect(replaced).toEqual({ removed_path: first.path });
    expect(await row(first.id)).toMatchObject({
      status: "removed",
      removed_by: olive.id,
      expense_id: expenseId,
    });
    expect(await row(second.id)).toMatchObject({
      status: "attached",
      expense_id: expenseId,
    });
    // The remover deletes the old file; the record of its removal stays.
    await olive.client.storage.from("receipts").remove([first.path]);
    expect(await objectExists(first.path)).toBe(false);
    expect(
      await must(
        pat.client.from("receipts").select("status").eq("id", first.id),
      ),
    ).toEqual([{ status: "removed" }]);
  });

  it("refuses others, other households' receipts, and deleted expenses", async () => {
    const expenseId = await must(
      olive.client.rpc("create_expense", expenseArgs(H, olive, [olive, pat])),
    );
    const quins = await uploaded(quin, H);
    // Quin neither added nor paid it, and isn't the owner.
    expectCode(
      (
        await quin.client.rpc("attach_receipt", {
          target_expense_id: expenseId,
          target_receipt_id: quins.id,
        })
      ).error,
      "42501",
    );
    const xenas = await uploaded(xena, X);
    expectCode(
      (
        await xena.client.rpc("attach_receipt", {
          target_expense_id: expenseId,
          target_receipt_id: xenas.id,
        })
      ).error,
      "HJ009",
    );
    const olives = await uploaded(olive, H);
    const otherHousehold = await household(olive, "Second");
    const elsewhere = await uploaded(olive, otherHousehold);
    expectCode(
      (
        await olive.client.rpc("attach_receipt", {
          target_expense_id: expenseId,
          target_receipt_id: elsewhere.id,
        })
      ).error,
      "HJ035",
    );
    expect(
      (
        await olive.client.rpc("delete_expense", {
          target_expense_id: expenseId,
        })
      ).error,
    ).toBeNull();
    expectCode(
      (
        await olive.client.rpc("attach_receipt", {
          target_expense_id: expenseId,
          target_receipt_id: olives.id,
        })
      ).error,
      "HJ011",
    );
  });

  it("removes a receipt for D6 people only, and never changes the expense", async () => {
    const r = await uploaded(pat, H);
    const expenseId = await must(confirm(pat, r.id, H));
    const before = await must(
      admin
        .from("expenses")
        .select("*, expense_splits(*)")
        .eq("id", expenseId)
        .single(),
    );
    // Quin isn't the creator, the payer or the owner.
    expectCode(
      (await quin.client.rpc("remove_receipt", { target_receipt_id: r.id }))
        .error,
      "42501",
    );
    expectCode(
      (await xena.client.rpc("remove_receipt", { target_receipt_id: r.id }))
        .error,
      "HJ035",
    );
    // Members can't delete an attached file through Storage either.
    await quin.client.storage.from("receipts").remove([r.path]);
    expect(await objectExists(r.path)).toBe(true);

    const path = await must(
      olive.client.rpc("remove_receipt", { target_receipt_id: r.id }),
    );
    expect(path).toBe(r.path);
    expect(await row(r.id)).toMatchObject({
      status: "removed",
      removed_by: olive.id,
    });
    await olive.client.storage.from("receipts").remove([path]);
    expect(await objectExists(r.path)).toBe(false);
    const after = await must(
      admin
        .from("expenses")
        .select("*, expense_splits(*)")
        .eq("id", expenseId)
        .single(),
    );
    expect(after).toEqual(before);
    expectCode(
      (await olive.client.rpc("remove_receipt", { target_receipt_id: r.id }))
        .error,
      "HJ035",
    );
  });
});

describe("discarding and clearing", () => {
  it("lets the uploader discard an unused receipt: file, then row", async () => {
    const r = await uploaded(quin, H);
    expectCode(
      (await olive.client.rpc("discard_receipt", { target_receipt_id: r.id }))
        .error,
      "HJ035",
    );
    await quin.client.storage.from("receipts").remove([r.path]);
    expect(await objectExists(r.path)).toBe(false);
    expect(
      (await quin.client.rpc("discard_receipt", { target_receipt_id: r.id }))
        .error,
    ).toBeNull();
    expect(await row(r.id)).toBeNull();
  });

  it("never discards one that's on an expense", async () => {
    const r = await uploaded(quin, H);
    await must(
      quin.client.rpc("create_expense_with_receipt", {
        target_receipt_id: r.id,
        ...expenseArgsWithoutHousehold(quin),
      }),
    );
    expectCode(
      (await quin.client.rpc("discard_receipt", { target_receipt_id: r.id }))
        .error,
      "HJ036",
    );
  });

  it("clears your own uploads unused for a day: files first, then rows", async () => {
    const old = await uploaded(pat, H);
    const fresh = await uploaded(pat, H);
    psqlAsSuperuser(
      `update public.receipts set created_at = now() - interval '25 hours' where id = '${old.id}';`,
    );
    const due = await must(pat.client.rpc("my_receipt_files_to_clear"));
    expect(due.map((d) => d.receipt_id)).toContain(old.id);
    expect(due.map((d) => d.receipt_id)).not.toContain(fresh.id);
    // Others can't see or clear them.
    expect(
      (await must(olive.client.rpc("my_receipt_files_to_clear"))).map(
        (d) => d.receipt_id,
      ),
    ).not.toContain(old.id);
    // A row is only forgotten once its file is gone.
    expect(await must(pat.client.rpc("forget_my_stale_receipts"))).toBe(0);
    await pat.client.storage
      .from("receipts")
      .remove(due.map((d) => d.storage_path));
    expect(
      await must(pat.client.rpc("forget_my_stale_receipts")),
    ).toBeGreaterThanOrEqual(1);
    expect(await row(old.id)).toBeNull();
    expect(await row(fresh.id)).not.toBeNull();
  });
});

describe("deleting the household", () => {
  it("lets the owner, as the last member, list and delete every receipt file first", async () => {
    const solo = await createUser("Alone");
    const S = await household(solo, "Solo home");
    const r = await uploaded(solo, S);
    await must(
      solo.client.rpc("create_expense_with_receipt", {
        target_receipt_id: r.id,
        ...expenseArgsWithoutHousehold(solo, [solo]),
      }),
    );
    const waiting = await uploaded(solo, S);
    // Not while others are still members.
    expectCode(
      (
        await olive.client.rpc("household_receipt_files", {
          target_household_id: H,
        })
      ).error,
      "42501",
    );
    expectCode(
      (
        await pat.client.rpc("household_receipt_files", {
          target_household_id: H,
        })
      ).error,
      "42501",
    );

    const files = await must(
      solo.client.rpc("household_receipt_files", { target_household_id: S }),
    );
    expect([...files].sort()).toEqual([r.path, waiting.path].sort());
    await solo.client.storage.from("receipts").remove(files);
    expect(await objectExists(r.path)).toBe(false);
    expect(await objectExists(waiting.path)).toBe(false);
    expect(
      (await solo.client.rpc("delete_household", { target_household_id: S }))
        .error,
    ).toBeNull();
    expect(await row(r.id)).toBeNull();
  });
});

describe("direct writes", () => {
  it("are refused on the table, for everyone signed in or not", async () => {
    const r = await uploaded(olive, H);
    for (const client of [olive.client, anonClient()]) {
      expectCode(
        (
          await client.from("receipts").insert({
            household_id: H,
            uploaded_by: olive.id,
            storage_path: "x",
            content_type: "image/jpeg",
            byte_size: 1,
            width: 1,
            height: 1,
          })
        ).error,
        "42501",
      );
      expectCode(
        (
          await client
            .from("receipts")
            .update({ status: "attached" })
            .eq("id", r.id)
        ).error,
        "42501",
      );
      expectCode(
        (await client.from("receipts").delete().eq("id", r.id)).error,
        "42501",
      );
    }
    expect((await row(r.id))?.status).toBe("uploaded");
  });
});

function expenseArgsWithoutHousehold(
  payer: User,
  people: User[] = [olive, pat],
) {
  const { target_household_id: _unused, ...rest } = expenseArgs(
    H,
    payer,
    people,
  );
  void _unused;
  return rest;
}
