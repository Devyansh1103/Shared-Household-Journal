import { describe, expect, it } from "vitest";
import { mutedFromChecked } from "./categories";
import {
  notificationsArgs,
  notificationsHref,
  parseNotificationsQuery,
  readNotificationsQuery,
} from "./query";

const ID = "d0000000-0000-4000-8000-000000000001";

describe("parseNotificationsQuery", () => {
  it("reads all or unread, and a cursor", () => {
    expect(parseNotificationsQuery(readNotificationsQuery({}))).toEqual({
      ok: true,
      query: { show: "all", before: null },
    });
    expect(
      parseNotificationsQuery(
        readNotificationsQuery({
          show: "unread",
          before: `1763029800000000.${ID}`,
        }),
      ),
    ).toEqual({
      ok: true,
      query: {
        show: "unread",
        before: { us: BigInt("1763029800000000"), id: ID },
      },
    });
  });

  it("reports what it can't use instead of guessing", () => {
    expect(parseNotificationsQuery({ show: "Unread", before: "" })).toEqual({
      ok: false,
      problem: "show",
    });
    expect(parseNotificationsQuery({ show: "", before: "yesterday" })).toEqual({
      ok: false,
      problem: "cursor",
    });
  });
});

describe("notificationsHref and notificationsArgs", () => {
  it("leaves defaults out of the URL and passes an exact cursor", () => {
    expect(notificationsHref("/n", { show: "all", before: null })).toBe("/n");
    expect(
      notificationsHref("/n", {
        show: "unread",
        before: { us: BigInt(5), id: ID },
      }),
    ).toBe(`/n?show=unread&before=5.${ID}`);
    expect(
      notificationsArgs({ show: "unread", before: { us: BigInt(5), id: ID } }),
    ).toEqual({
      unread_only: true,
      before_us: 5,
      before_id: ID,
      page_size: 20,
    });
  });
});

describe("mutedFromChecked", () => {
  it("mutes every type that isn't ticked, and ignores anything else", () => {
    expect(
      mutedFromChecked([
        "expenses",
        "settlements",
        "bills",
        "shopping",
        "chores",
        "budgets",
        "household",
      ]),
    ).toEqual([]);
    expect(mutedFromChecked(["expenses", "budgets", "nonsense"])).toEqual([
      "settlements",
      "bills",
      "shopping",
      "chores",
      "household",
    ]);
    expect(mutedFromChecked([])).toHaveLength(7);
  });
});
