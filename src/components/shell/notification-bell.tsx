"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon } from "lucide-react";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { NOTIFICATIONS_CHANGED } from "@/lib/notifications/events";

const REFRESH_MS = 60_000;

// One count for every bell on the page (the top bar's and the sidebar's are
// both mounted; CSS shows one), read from /api/notifications/unread. It's
// refreshed on navigation, when the window comes back into view, after a
// notification action, and once a minute while the page is visible. No
// websockets: this is the app's only live element (roadmap Phase 17).
let count: number | null = null;
let inflight: Promise<void> | null = null;
let timer: number | undefined;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function refresh(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetch("/api/notifications/unread", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return;
      const body: unknown = await response.json();
      const next =
        typeof body === "object" &&
        body !== null &&
        "count" in body &&
        typeof body.count === "number"
          ? body.count
          : null;
      if (next !== null && next !== count) {
        count = next;
        emit();
      }
    })
    .catch(() => {
      // Offline or signed out: keep what's shown; the next refresh tries again.
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function onVisible() {
  if (document.visibilityState === "visible") void refresh();
}

function onChanged() {
  void refresh();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("focus", onChanged);
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    document.addEventListener("visibilitychange", onVisible);
    timer = window.setInterval(onVisible, REFRESH_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("focus", onChanged);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    }
  };
}

/**
 * The notification centre's entry point: a bell with the unread count. Its
 * accessible name says the count ("Notifications, 3 unread"); the badge is a
 * picture of the same number.
 */
export function NotificationBell({ className }: { className?: string }) {
  const unread = useSyncExternalStore(
    subscribe,
    () => count,
    () => null,
  );
  const pathname = usePathname();
  useEffect(() => {
    void refresh();
  }, [pathname]);

  const active =
    pathname === "/notifications" || pathname.startsWith("/notifications/");
  const label =
    unread && unread > 0 ? `Notifications, ${unread} unread` : "Notifications";

  return (
    <Link
      href="/notifications"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        buttonVariants({ variant: "ghost", size: "icon" }),
        "relative shrink-0",
        active && "bg-info-subtle text-info hover:bg-info-subtle",
        className,
      )}
    >
      <BellIcon aria-hidden="true" className="size-5" />
      {unread && unread > 0 ? (
        <span
          aria-hidden="true"
          data-testid="unread-badge"
          className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[0.6875rem] leading-none font-semibold text-destructive-foreground tabular-nums"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
