"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { HouseIcon, ReceiptIcon, UserRoundIcon, UsersIcon } from "lucide-react";
import { cn } from "cn";
import {
  currentHousehold,
  isActive,
  navItems,
  type NavItemKey,
} from "@/lib/navigation";

const ICONS: Record<NavItemKey, typeof HouseIcon> = {
  home: HouseIcon,
  household: UsersIcon,
  expenses: ReceiptIcon,
  profile: UserRoundIcon,
};

// Literal class names, so Tailwind generates them.
const BOTTOM_COLUMNS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

/**
 * The main navigation: a vertical list in the desktop sidebar, a bar of
 * labelled tabs at the bottom on smaller screens. The active item is marked
 * with `aria-current`, a heavier weight and an indicator bar, not colour alone.
 */
export function MainNav({
  variant,
  householdIds,
}: {
  variant: "sidebar" | "bottom";
  householdIds: string[];
}) {
  const pathname = usePathname();
  const params = useParams<{ householdId?: string }>();
  const household = currentHousehold(
    householdIds.map((id) => ({ id })),
    params.householdId,
  );
  const items = navItems(household?.id);

  if (variant === "sidebar") {
    return (
      <nav aria-label="Main">
        <ul className="space-y-1">
          {items.map((item) => {
            const Icon = ICONS[item.key];
            const active = isActive(item, pathname);
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-10 items-center gap-3 rounded-lg px-3 type-label hover:bg-muted",
                    active &&
                      "bg-info-subtle font-semibold text-info before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-info hover:bg-info-subtle",
                  )}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="Main">
      <ul className={cn("grid", BOTTOM_COLUMNS[items.length])}>
        {items.map((item) => {
          const Icon = ICONS[item.key];
          const active = isActive(item, pathname);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 flex-col items-center justify-center gap-1 px-2 text-xs font-medium text-muted-foreground hover:bg-muted",
                  active &&
                    "font-semibold text-primary before:absolute before:top-0 before:left-1/2 before:h-1 before:w-10 before:-translate-x-1/2 before:rounded-b-full before:bg-primary",
                )}
              >
                <Icon aria-hidden="true" className="size-5" />
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
