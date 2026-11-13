import { Suspense } from "react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { BellIcon, HouseIcon } from "lucide-react";
import { cn } from "cn";
import { HouseholdSwitcher } from "@/components/shell/household-switcher";
import { MainNav } from "@/components/shell/main-nav";
import { NotificationBell } from "@/components/shell/notification-bell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import {
  listMyHouseholds,
  type HouseholdSummary,
} from "@/lib/households/queries";
import { AccountNav } from "./account-nav";

// The signed-in application shell (Phase 3): a sidebar from `lg` (1024px) up;
// below that, a top bar with the household switcher and a bottom tab bar.
// Every page in this group renders only after the session is verified on the
// server; hiding links is never the protection.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1">
      <a
        href="#main-content"
        className="sr-only rounded-md bg-card px-3 py-2 type-label shadow-raised focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <div className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
        <div className="flex items-center justify-between gap-2 px-4 pt-5 pb-4">
          <BrandLink />
          <Suspense fallback={<BellFallback />}>
            <NotificationBell />
          </Suspense>
        </div>
        <div className="px-3">
          <Suspense fallback={<Skeleton className="h-10 w-full" />}>
            <Switcher />
          </Suspense>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <Suspense fallback={<NavSkeleton />}>
            <Navigation variant="sidebar" />
          </Suspense>
        </div>
        <div className="border-t border-border p-3">
          <Suspense fallback={<Skeleton className="h-9 w-full" />}>
            <AccountNav />
          </Suspense>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile and tablet top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card px-4 sm:px-6 lg:hidden">
          <BrandLink compact />
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <Suspense fallback={<Skeleton className="h-10 w-full" />}>
              <Switcher />
            </Suspense>
          </div>
          <Suspense fallback={<BellFallback className="ml-auto" />}>
            <NotificationBell className="ml-auto" />
          </Suspense>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] outline-none lg:pb-0"
        >
          <Suspense fallback={<PageLoading />}>
            <SignedIn>{children}</SignedIn>
          </Suspense>
        </main>
      </div>

      {/* Mobile and tablet bottom tab bar */}
      <div
        data-bottom-nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <Suspense fallback={<div className="h-16" />}>
          <Navigation variant="bottom" />
        </Suspense>
      </div>
    </div>
  );
}

async function SignedIn({ children }: { children: React.ReactNode }) {
  await requireUser();
  return children;
}

/**
 * The user's households for the shell, or null if they can't be loaded. The
 * shell degrades instead of failing, so the page itself (and its own error
 * state) still renders. React's cache shares this with the page's own read.
 */
async function shellHouseholds(): Promise<HouseholdSummary[] | null> {
  // The SignedIn boundary redirects signed-out visitors; render nothing meanwhile.
  if (!(await getCurrentUser())) return null;
  try {
    return await listMyHouseholds();
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

async function Switcher() {
  const households = await shellHouseholds();
  if (!households) {
    return (
      <Button variant="outline" className="w-full" asChild>
        <Link href="/home">Your households</Link>
      </Button>
    );
  }
  return (
    <HouseholdSwitcher
      households={households.map(({ id, name }) => ({ id, name }))}
    />
  );
}

async function Navigation({ variant }: { variant: "sidebar" | "bottom" }) {
  if (!(await getCurrentUser())) return null;
  const households = await shellHouseholds();
  return (
    <MainNav
      variant={variant}
      householdIds={(households ?? []).map((household) => household.id)}
    />
  );
}

function BrandLink({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/home"
      className="flex shrink-0 items-center gap-2 rounded-md type-card-title"
    >
      <span
        className="flex size-8 items-center justify-center rounded-lg bg-info-subtle text-info"
        aria-hidden="true"
      >
        <HouseIcon className="size-4" />
      </span>
      {compact ? (
        <span className="sr-only">Shared Household Journal home</span>
      ) : (
        <span>Shared Household Journal</span>
      )}
    </Link>
  );
}

/** The bell before its count has loaded: the same link, without a number. */
function BellFallback({ className }: { className?: string }) {
  return (
    <Link
      href="/notifications"
      aria-label="Notifications"
      className={cn(
        buttonVariants({ variant: "ghost", size: "icon" }),
        "shrink-0",
        className,
      )}
    >
      <BellIcon aria-hidden="true" className="size-5" />
    </Link>
  );
}

function NavSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function PageLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading page"
      className="mx-auto w-full max-w-page space-y-4 px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
    >
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
