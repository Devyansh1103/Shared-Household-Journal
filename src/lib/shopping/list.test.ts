import { describe, expect, it } from "vitest";
import {
  filterItems,
  itemLabel,
  readShoppingQuery,
  shoppingHref,
  whoChips,
  type ShoppingItem,
} from "./list";

const HOUSEHOLD = "6f1c2f4e-8a7b-4c3d-9e2f-1a2b3c4d5e6f";
const OLIVE = "11111111-1111-4111-8111-111111111111";
const PAT = "22222222-2222-4222-8222-222222222222";
const QUIN = "33333333-3333-4333-8333-333333333333";
const PEOPLE = [OLIVE, PAT, QUIN];

function item(n: number, overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id: `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    householdId: HOUSEHOLD,
    name: `Item ${n}`,
    quantity: null,
    note: null,
    assigneeId: null,
    addedBy: OLIVE,
    purchasedAt: null,
    purchasedBy: null,
    createdAt: `2026-11-1${n}T10:00:00+00:00`,
    updatedAt: `2026-11-1${n}T10:00:00+00:00`,
    ...overrides,
  };
}

describe("readShoppingQuery", () => {
  it("reads the view and the person, ignoring anything else", () => {
    expect(readShoppingQuery({}, PEOPLE)).toEqual({
      show: "pending",
      who: "anyone",
    });
    expect(readShoppingQuery({ show: "purchased", who: "me" }, PEOPLE)).toEqual(
      {
        show: "purchased",
        who: "me",
      },
    );
    expect(readShoppingQuery({ show: "all", who: QUIN }, PEOPLE)).toEqual({
      show: "all",
      who: QUIN,
    });
    expect(
      readShoppingQuery(
        {
          show: ["all", "pending"],
          who: "11111111-0000-4000-8000-000000000000",
        },
        PEOPLE,
      ),
    ).toEqual({ show: "pending", who: "anyone" });
    expect(
      readShoppingQuery({ show: "Bought", who: "nobody" }, PEOPLE),
    ).toEqual({
      show: "pending",
      who: "nobody",
    });
  });
});

describe("shoppingHref", () => {
  it("leaves the defaults out", () => {
    expect(shoppingHref("/s", { show: "pending", who: "anyone" })).toBe("/s");
    expect(shoppingHref("/s", { show: "all", who: PAT })).toBe(
      `/s?show=all&who=${PAT}`,
    );
  });
});

describe("filterItems", () => {
  const items = [
    item(3, { assigneeId: PAT }),
    item(1),
    item(2, {
      assigneeId: OLIVE,
      purchasedAt: "2026-11-13T09:00:00+00:00",
      purchasedBy: PAT,
    }),
    item(4, {
      purchasedAt: "2026-11-14T09:00:00+00:00",
      purchasedBy: OLIVE,
    }),
  ];
  const ids = (list: ShoppingItem[]) => list.map((i) => i.name);

  it("shows what's still needed oldest first, and what's bought newest first", () => {
    const all = filterItems(items, { show: "all", who: "anyone" }, OLIVE);
    expect(ids(all.pending)).toEqual(["Item 1", "Item 3"]);
    expect(ids(all.purchased)).toEqual(["Item 4", "Item 2"]);
    expect(
      filterItems(items, { show: "pending", who: "anyone" }, OLIVE).purchased,
    ).toEqual([]);
    expect(
      filterItems(items, { show: "purchased", who: "anyone" }, OLIVE).pending,
    ).toEqual([]);
  });

  it("filters by whose it is", () => {
    const mine = filterItems(items, { show: "all", who: "me" }, OLIVE);
    expect([...ids(mine.pending), ...ids(mine.purchased)]).toEqual(["Item 2"]);
    const pats = filterItems(items, { show: "all", who: PAT }, OLIVE);
    expect(ids(pats.pending)).toEqual(["Item 3"]);
    const nobody = filterItems(items, { show: "all", who: "nobody" }, OLIVE);
    expect([...ids(nobody.pending), ...ids(nobody.purchased)]).toEqual([
      "Item 1",
      "Item 4",
    ]);
  });
});

describe("whoChips", () => {
  const people = [
    { userId: OLIVE, displayName: "Olive", isActive: true },
    { userId: PAT, displayName: "Pat", isActive: true },
    { userId: QUIN, displayName: "Quin", isActive: false },
  ];

  it("offers anyone, you, nobody and the others; former members only when chosen", () => {
    expect(whoChips(people, OLIVE, "anyone").map((c) => c.label)).toEqual([
      "Anyone",
      "Mine",
      "Unassigned",
      "Pat",
    ]);
    const chosen = whoChips(people, OLIVE, QUIN);
    expect(chosen.at(-1)).toEqual({
      key: QUIN,
      label: "Quin (left)",
      active: true,
    });
    expect(chosen.filter((c) => c.active)).toHaveLength(1);
  });
});

describe("itemLabel", () => {
  it("adds the quantity when there is one", () => {
    expect(itemLabel({ name: "Milk", quantity: null })).toBe("Milk");
    expect(itemLabel({ name: "Milk", quantity: "2" })).toBe("Milk (2)");
  });
});
