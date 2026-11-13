import { describe, expect, it } from "vitest";
import { describeNotifications } from "./describe";
import {
  checkNotifications,
  nextNotificationsCursor,
  parseNotifications,
  peopleIn,
} from "./payload";

const HOME = "6f1c2f4e-8a7b-4c3d-9e2f-1a2b3c4d5e6f";
const FLAT = "7a2d3e5f-9b8c-4d4e-8f3a-2b3c4d5e6f7a";
const OLIVE = "11111111-1111-4111-8111-111111111111";
const PAT = "22222222-2222-4222-8222-222222222222";
const EXPENSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const n = (i: number) =>
  `d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const ev = (i: number) =>
  `e0000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

const expenseRow = {
  notification_id: n(2),
  household_id: HOME,
  household_name: "Home",
  currency_code: "INR",
  timezone: "Asia/Kolkata",
  category: "expenses",
  read: false,
  created_us: "1763029800000000",
  event: {
    event_id: ev(2),
    type: "expense_created",
    actor_id: OLIVE,
    detail: {
      description: "Groceries",
      amount_minor: "125000",
      category: "groceries",
      paid_by: OLIVE,
    },
    entity: { available: true, id: EXPENSE, state: "active" },
  },
};
const paymentRow = {
  ...expenseRow,
  notification_id: n(1),
  household_id: FLAT,
  household_name: "Flat",
  currency_code: "EUR",
  timezone: "Europe/Berlin",
  category: "settlements",
  read: true,
  created_us: "1763029700000000",
  event: {
    event_id: ev(1),
    type: "settlement_recorded",
    actor_id: OLIVE,
    detail: {
      from_user: OLIVE,
      to_user: PAT,
      amount_minor: "5000",
      settled_on: "2026-11-12",
      recorded_by: OLIVE,
    },
    entity: { available: false },
  },
};

function payload(rows: unknown[], over: Record<string, unknown> = {}) {
  return {
    has_more: false,
    unread_count: 1,
    rows,
    people: [
      {
        household_id: HOME,
        user_id: OLIVE,
        display_name: "Olive",
        is_active: true,
      },
      {
        household_id: FLAT,
        user_id: OLIVE,
        display_name: "Olive",
        is_active: false,
      },
      {
        household_id: FLAT,
        user_id: PAT,
        display_name: "Pat",
        is_active: true,
      },
    ],
    ...over,
  };
}

const asked = { unreadOnly: false, before: null, pageSize: 20 };

describe("parseNotifications", () => {
  it("reads each notification with its journal entry", () => {
    const page = parseNotifications(payload([expenseRow, paymentRow]));
    expect(page?.items[0]).toMatchObject({
      id: n(2),
      householdName: "Home",
      currency: "INR",
      read: false,
      createdUs: BigInt("1763029800000000"),
      entry: {
        id: ev(2),
        householdId: HOME,
        detail: {
          type: "expense_created",
          expense: { amountMinor: BigInt(125000) },
        },
      },
    });
    // "(left)" is per household: Olive left the flat, not the home.
    expect(peopleIn(page!, FLAT)).toContainEqual({
      userId: OLIVE,
      displayName: "Olive",
      isActive: false,
    });
    expect(peopleIn(page!, HOME)).toEqual([
      { userId: OLIVE, displayName: "Olive", isActive: true },
    ]);
  });

  it("refuses a note, an unknown type or category, or a bad currency", () => {
    for (const row of [
      {
        ...paymentRow,
        event: {
          ...paymentRow.event,
          detail: { ...paymentRow.event.detail, note: "Rent, cash" },
        },
      },
      { ...expenseRow, event: { ...expenseRow.event, type: "budget_alert" } },
      { ...expenseRow, category: "alerts" },
      { ...expenseRow, currency_code: "inr" },
      { ...expenseRow, recipient_id: PAT },
    ]) {
      expect(
        parseNotifications(payload([row])),
        JSON.stringify(row),
      ).toBeNull();
    }
    expect(parseNotifications({ ...payload([]), unread_count: -1 })).toBeNull();
  });
});

describe("checkNotifications", () => {
  const page = (rows: unknown[], over: Record<string, unknown> = {}) =>
    parseNotifications(payload(rows, over))!;

  it("accepts a page in order", () => {
    expect(checkNotifications(page([expenseRow, paymentRow]), asked)).toEqual({
      ok: true,
    });
    expect(checkNotifications(page([]), asked)).toEqual({ ok: true });
  });

  it("refuses a notification whose type isn't its event's", () => {
    expect(
      checkNotifications(page([{ ...expenseRow, category: "budgets" }]), asked),
    ).toEqual({ ok: false, code: "category_mismatch" });
    expect(
      checkNotifications(
        page([{ ...expenseRow, event: { ...expenseRow.event, entity: null } }]),
        asked,
      ),
    ).toEqual({ ok: false, code: "entity_mismatch" });
  });

  it("refuses read ones when only unread were asked for, or more unread than counted", () => {
    expect(
      checkNotifications(page([paymentRow]), { ...asked, unreadOnly: true }),
    ).toEqual({ ok: false, code: "read_mismatch" });
    expect(
      checkNotifications(page([expenseRow], { unread_count: 0 }), asked),
    ).toEqual({ ok: false, code: "read_mismatch" });
  });

  it("refuses repeats, the wrong order, the wrong page size or the cursor", () => {
    expect(checkNotifications(page([expenseRow, expenseRow]), asked)).toEqual({
      ok: false,
      code: "duplicate_notification",
    });
    expect(checkNotifications(page([paymentRow, expenseRow]), asked)).toEqual({
      ok: false,
      code: "order_mismatch",
    });
    expect(
      checkNotifications(
        page([expenseRow, paymentRow], { has_more: true }),
        asked,
      ),
    ).toEqual({ ok: false, code: "page_mismatch" });
    expect(
      checkNotifications(page([expenseRow]), {
        ...asked,
        before: { us: BigInt("1763029800000000"), id: n(1) },
      }),
    ).toEqual({ ok: false, code: "cursor_mismatch" });
    const dupPeople = payload([expenseRow]);
    dupPeople.people.push(dupPeople.people[0]);
    expect(checkNotifications(parseNotifications(dupPeople)!, asked)).toEqual({
      ok: false,
      code: "people_mismatch",
    });
  });

  it("gives the next cursor only when more are promised", () => {
    const full = parseNotifications(payload([expenseRow], { has_more: true }))!;
    expect(nextNotificationsCursor(full)).toEqual({
      us: BigInt("1763029800000000"),
      id: n(2),
    });
    expect(nextNotificationsCursor(page([expenseRow]))).toBeNull();
  });
});

describe("describeNotifications", () => {
  it("uses the journal's words in each household's currency, and links inside it", () => {
    const views = describeNotifications(page2(), PAT);
    expect(views[0]).toMatchObject({
      description: {
        title: "Olive added an expense",
        summary: "Groceries — ₹1,250.00",
      },
      href: `/households/${HOME}/expenses/${EXPENSE}`,
    });
    // The payment isn't in the flat any more: its journal instead.
    expect(views[1].description.title).toBe(
      "Olive (left) recorded a payment of €50.00 to you",
    );
    expect(views[1].href).toBe(`/households/${FLAT}/journal`);
  });
});

function page2() {
  return parseNotifications(payload([expenseRow, paymentRow]))!;
}
