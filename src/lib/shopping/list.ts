// The shopping list's filters (roadmap Phase 15): what's still needed, what's
// been bought, or both; and whose (assigned to you, to nobody, or to one
// person). The filters live in the URL. Pure.

export type ShoppingItem = {
  id: string;
  householdId: string;
  name: string;
  quantity: string | null;
  note: string | null;
  assigneeId: string | null;
  addedBy: string;
  purchasedAt: string | null;
  purchasedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export const SHOPPING_VIEWS = ["pending", "purchased", "all"] as const;
export type ShoppingView = (typeof SHOPPING_VIEWS)[number];

export const SHOPPING_VIEW_LABELS: Record<ShoppingView, string> = {
  pending: "Still needed",
  purchased: "Bought",
  all: "All",
};

/** "anyone", "me", "nobody", or a person's id. */
export type WhoFilter = string;

export type ShoppingQuery = { show: ShoppingView; who: WhoFilter };

export const DEFAULT_SHOPPING_QUERY: ShoppingQuery = {
  show: "pending",
  who: "anyone",
};

type Param = string | string[] | undefined;

function one(value: Param): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Who a list is filtered to. Anything that isn't "me", "nobody" or one of the
 * household's people (current or former) is ignored: no filter.
 */
export function readWho(value: Param, personIds: readonly string[]): WhoFilter {
  const who = one(value);
  if (who === "me" || who === "nobody") return who;
  if (who !== undefined && personIds.includes(who)) return who;
  return "anyone";
}

export function readShoppingQuery(
  params: { show?: Param; who?: Param },
  personIds: readonly string[],
): ShoppingQuery {
  const show = one(params.show);
  return {
    show: (SHOPPING_VIEWS as readonly string[]).includes(show ?? "")
      ? (show as ShoppingView)
      : DEFAULT_SHOPPING_QUERY.show,
    who: readWho(params.who, personIds),
  };
}

/** The URL for a filter, leaving out defaults so the plain page stays plain. */
export function shoppingHref(base: string, query: ShoppingQuery): string {
  const params = new URLSearchParams();
  if (query.show !== DEFAULT_SHOPPING_QUERY.show)
    params.set("show", query.show);
  if (query.who !== "anyone") params.set("who", query.who);
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

export function matchesWho(
  assigneeId: string | null,
  who: WhoFilter,
  viewerId: string,
): boolean {
  if (who === "anyone") return true;
  if (who === "nobody") return assigneeId === null;
  if (who === "me") return assigneeId === viewerId;
  return assigneeId === who;
}

/**
 * The items the filter shows. Still needed: oldest first, as they were
 * added. Bought: most recently bought first.
 */
export function filterItems(
  items: readonly ShoppingItem[],
  query: ShoppingQuery,
  viewerId: string,
): { pending: ShoppingItem[]; purchased: ShoppingItem[] } {
  const shown = items.filter((item) =>
    matchesWho(item.assigneeId, query.who, viewerId),
  );
  const pending =
    query.show === "purchased"
      ? []
      : shown
          .filter((item) => item.purchasedAt === null)
          .sort(
            (a, b) => compare(a.createdAt, b.createdAt) || compare(a.id, b.id),
          );
  const purchased =
    query.show === "pending"
      ? []
      : shown
          .filter((item) => item.purchasedAt !== null)
          .sort(
            (a, b) =>
              compare(b.purchasedAt ?? "", a.purchasedAt ?? "") ||
              compare(a.id, b.id),
          );
  return { pending, purchased };
}

/**
 * Timestamps from Postgres all have the same shape and offset, so they sort
 * as text; ids break ties.
 */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The person filter's choices: anyone, you, nobody, then every other current
 * member in join order. Someone who has left shows only while chosen.
 */
export function whoChips(
  people: readonly { userId: string; displayName: string; isActive: boolean }[],
  viewerId: string,
  current: WhoFilter,
): { key: WhoFilter; label: string; active: boolean }[] {
  return [
    { key: "anyone", label: "Anyone", active: current === "anyone" },
    { key: "me", label: "Mine", active: current === "me" },
    { key: "nobody", label: "Unassigned", active: current === "nobody" },
    ...people
      .filter(
        (p) => p.userId !== viewerId && (p.isActive || p.userId === current),
      )
      .map((p) => ({
        key: p.userId,
        label: p.isActive ? p.displayName : `${p.displayName} (left)`,
        active: current === p.userId,
      })),
  ];
}

/** "Milk", "Milk (2 litres)". */
export function itemLabel(item: Pick<ShoppingItem, "name" | "quantity">) {
  return item.quantity ? `${item.name} (${item.quantity})` : item.name;
}
