import { Suspense } from "react";
import Link from "next/link";
import { HouseIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { AccountNav } from "./account-nav";

// Minimal signed-in layout until the Phase 3 application shell replaces it.
// Every page in this group renders only after the session is verified on the
// server; hiding links is never the protection.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 w-full max-w-page items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Link
            href="/home"
            className="flex items-center gap-2 rounded-md type-card-title"
          >
            <span
              className="flex size-8 items-center justify-center rounded-lg bg-info-subtle text-info"
              aria-hidden="true"
            >
              <HouseIcon className="size-4" />
            </span>
            <span className="hidden sm:inline">Shared Household Journal</span>
            <span className="sr-only sm:hidden">
              Shared Household Journal home
            </span>
          </Link>
          <Suspense fallback={<Skeleton className="h-9 w-40" />}>
            <AccountNav />
          </Suspense>
        </div>
      </header>
      <main className="flex-1">
        <Suspense fallback={<PageLoading />}>
          <SignedIn>{children}</SignedIn>
        </Suspense>
      </main>
    </>
  );
}

async function SignedIn({ children }: { children: React.ReactNode }) {
  await requireUser();
  return children;
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
