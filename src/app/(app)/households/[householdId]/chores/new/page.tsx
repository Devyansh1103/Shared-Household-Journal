import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { io } from "next/cache";
import { ArrowLeftIcon } from "lucide-react";
import { FormSkeleton } from "@/components/form-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EMPTY_CHORE_FORM } from "@/lib/chores/form";
import { getHousehold, listMembersInJoinOrder } from "@/lib/households/queries";
import { createChore } from "../actions";
import { ChoreForm } from "../chore-form";

export const metadata: Metadata = { title: "Add a chore" };

export default function NewChorePage({
  params,
}: PageProps<"/households/[householdId]/chores/new">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<FormSkeleton fields={5} label="Loading form" />}>
        <NewChore params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function NewChore({
  params,
}: Pick<PageProps<"/households/[householdId]/chores/new">, "params">) {
  const { householdId } = await params;
  const household = await getHousehold(householdId);
  const members = await listMembersInJoinOrder(household.id);
  // A fresh key per visit, so resubmitting can't add the chore twice.
  await io();
  const requestKey = randomUUID();

  return (
    <>
      <Link
        href={`/households/${household.id}/chores`}
        className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Chores
      </Link>
      <PageHeader
        title="Add a chore"
        description={`Something that needs doing in ${household.name}, once. Everyone in the household sees it.`}
      />
      <Card>
        <CardContent>
          <ChoreForm
            action={createChore}
            hidden={{ householdId: household.id, requestKey }}
            members={members}
            viewerId={household.myUserId}
            defaults={EMPTY_CHORE_FORM}
            submitLabel="Add chore"
          />
        </CardContent>
      </Card>
    </>
  );
}
