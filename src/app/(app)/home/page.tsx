import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon, HouseIcon, PlusIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-alert";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getMyProfile } from "@/lib/auth/session";
import { listMyHouseholds } from "@/lib/households/queries";

export const metadata: Metadata = { title: "Home" };

const NOTICES = {
  confirmed: "Your email is confirmed. Welcome aboard!",
  left: "You've left the household.",
  deleted: "The household has been deleted.",
} as const;

export default function HomePage({ searchParams }: PageProps<"/home">) {
  return (
    <PageContainer className="space-y-8">
      <Suspense fallback={<Skeleton className="h-9 w-72 max-w-full" />}>
        <Welcome searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<HouseholdListSkeleton />}>
        <Households />
      </Suspense>
    </PageContainer>
  );
}

async function Welcome({
  searchParams,
}: Pick<PageProps<"/home">, "searchParams">) {
  const [profile, params] = await Promise.all([getMyProfile(), searchParams]);
  const notice = (Object.keys(NOTICES) as (keyof typeof NOTICES)[]).find(
    (key) => params[key] === "1",
  );
  return (
    <div className="space-y-4">
      {notice ? <FormAlert tone="success">{NOTICES[notice]}</FormAlert> : null}
      <PageHeader
        title={`Welcome, ${profile.displayName}`}
        description="This is your home base for shared costs, bills and chores."
      />
    </div>
  );
}

const createButton = (
  <Button asChild>
    <Link href="/households/new">
      <PlusIcon aria-hidden="true" data-icon="inline-start" />
      Create a household
    </Link>
  </Button>
);

async function Households() {
  const households = await listMyHouseholds();

  if (households.length === 0) {
    return (
      <EmptyState
        icon={<HouseIcon />}
        title="You're not in a household yet"
        description="Create one for the people you live with, or ask a housemate for an invite link to join theirs."
        action={createButton}
      />
    );
  }

  return (
    <Section title="Your households" actions={createButton}>
      <ul className="grid gap-3 sm:grid-cols-2">
        {households.map((household) => (
          <li key={household.id} className="min-w-0">
            <Link
              href={`/households/${household.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-card hover:bg-muted"
            >
              <span className="block min-w-0 flex-1 space-y-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate type-card-title">
                    {household.name}
                  </span>
                  {household.role === "owner" ? (
                    <Badge variant="info">Owner</Badge>
                  ) : null}
                </span>
                <span className="block type-secondary">
                  {household.memberCount === 1
                    ? "1 member"
                    : `${household.memberCount} members`}{" "}
                  · {household.currencyCode}
                </span>
              </span>
              <ChevronRightIcon
                aria-hidden="true"
                className="size-5 shrink-0 text-muted-foreground"
              />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function HouseholdListSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading your households"
      className="space-y-4"
    >
      <Skeleton className="h-7 w-48" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}
