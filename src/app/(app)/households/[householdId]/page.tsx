import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { currencyOptions, timeZoneLabel } from "@/lib/households/options";
import {
  getHousehold,
  listInvitations,
  listMembers,
} from "@/lib/households/queries";
import { InvitePanel } from "./invite-panel";
import { InvitationList } from "./invitation-list";
import { MemberList } from "./member-list";
import { MembershipSection } from "./membership-section";

export const metadata: Metadata = { title: "Household" };

const NOTICES = {
  created: "Your household is ready. Invite the people you live with.",
  joined: "Welcome! You've joined this household.",
  already: "You're already a member of this household.",
} as const;

export default function HouseholdPage({
  params,
  searchParams,
}: PageProps<"/households/[householdId]">) {
  return (
    <PageContainer className="space-y-8">
      <Link
        href="/home"
        className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Your households
      </Link>
      <Suspense fallback={<HouseholdSkeleton />}>
        <HouseholdContent params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function HouseholdContent({
  params,
  searchParams,
}: PageProps<"/households/[householdId]">) {
  const { householdId } = await params;
  // Not a member (or no such household): the same 404, from the data layer.
  const household = await getHousehold(householdId);
  const [members, invitations, query] = await Promise.all([
    listMembers(household.id),
    listInvitations(household.id),
    searchParams,
  ]);

  const notice = (Object.keys(NOTICES) as (keyof typeof NOTICES)[]).find(
    (key) => query[key] === "1",
  );
  const isOwner = household.myRole === "owner";
  const currency =
    currencyOptions().find((c) => c.code === household.currencyCode)?.label ??
    household.currencyCode;

  return (
    <div className="space-y-8">
      {notice ? <FormAlert tone="success">{NOTICES[notice]}</FormAlert> : null}

      <PageHeader
        title={household.name}
        description={
          isOwner
            ? "You're the owner of this household."
            : "You're a member of this household."
        }
      />

      <Card>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <dt className="type-label">Currency</dt>
              <dd className="type-body">{currency}</dd>
            </div>
            <div className="space-y-1">
              <dt className="type-label">Timezone</dt>
              <dd className="type-body">{timeZoneLabel(household.timezone)}</dd>
            </div>
            <div className="space-y-1">
              <dt className="type-label">Created</dt>
              <dd className="type-body">
                {formatDateTime(household.createdAt, household.timezone)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Section
        title="Expenses"
        description="Shared costs, who paid, and how each one is split."
      >
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/households/${household.id}/expenses/new`}>
              <PlusIcon aria-hidden="true" data-icon="inline-start" />
              Add expense
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/households/${household.id}/expenses`}>
              View expenses
            </Link>
          </Button>
        </div>
      </Section>

      <Section
        title="Members"
        description={
          members.length === 1
            ? "Just you so far."
            : `${members.length} people live here.`
        }
      >
        <MemberList household={household} members={members} />
      </Section>

      <Section
        title="Invite someone"
        description="Anyone with a link can join after signing in, until it expires or runs out of uses. Share it only with people you live with."
      >
        <InvitePanel householdId={household.id} timeZone={household.timezone} />
        <InvitationList household={household} invitations={invitations} />
      </Section>

      <MembershipSection household={household} memberCount={members.length} />
    </div>
  );
}

function HouseholdSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading household"
      className="space-y-8"
    >
      <Skeleton className="h-9 w-64 max-w-full" />
      <Skeleton className="h-24 w-full" />
      <div className="space-y-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
