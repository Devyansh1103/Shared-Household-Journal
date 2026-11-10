// Main navigation for the signed-in shell (Phase 3). Only routes that exist are
// listed; each feature phase adds its own entry when its pages ship.

export type NavItemKey = "home" | "household" | "expenses" | "profile";

export type NavItem = {
  key: NavItemKey;
  href: string;
  label: string;
  /** Also active on sub-paths of `href` (e.g. a household's later pages). */
  matchSubpaths: boolean;
};

/** Items in display order. The household item appears only inside a household. */
export function navItems(currentHouseholdId?: string | null): NavItem[] {
  const items: NavItem[] = [
    { key: "home", href: "/home", label: "Home", matchSubpaths: false },
  ];
  if (currentHouseholdId) {
    const base = `/households/${currentHouseholdId}`;
    items.push(
      {
        key: "household",
        href: base,
        label: "Household",
        matchSubpaths: false,
      },
      {
        key: "expenses",
        href: `${base}/expenses`,
        label: "Expenses",
        matchSubpaths: true,
      },
    );
  }
  items.push({
    key: "profile",
    href: "/profile",
    label: "Profile",
    matchSubpaths: false,
  });
  return items;
}

export function isActive(item: NavItem, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (
    path === item.href ||
    (item.matchSubpaths && path.startsWith(`${item.href}/`))
  );
}

/** The household in the URL, if it's one of the user's households. */
export function currentHousehold<T extends { id: string }>(
  households: T[],
  householdIdParam: string | string[] | undefined,
): T | undefined {
  if (typeof householdIdParam !== "string") return undefined;
  return households.find((household) => household.id === householdIdParam);
}
