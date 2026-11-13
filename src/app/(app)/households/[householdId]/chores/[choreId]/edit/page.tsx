import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { FormSkeleton } from "@/components/form-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { canManageChore } from "@/lib/chores/board";
import { getChore } from "@/lib/chores/queries";
import {
  listHouseholdPeople,
  listMembersInJoinOrder,
} from "@/lib/households/queries";
import { updateChore } from "../../actions";
import { ChoreForm } from "../../chore-form";

export const metadata: Metadata = { title: "Edit chore" };

export default function EditChorePage({
  params,
}: PageProps<"/households/[householdId]/chores/[choreId]/edit">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<FormSkeleton fields={5} label="Loading form" />}>
        <EditChore params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function EditChore({
  params,
}: Pick<
  PageProps<"/households/[householdId]/chores/[choreId]/edit">,
  "params"
>) {
  const { householdId, choreId } = await params;
  // A 404 for a non-member, a malformed id or another household's chore.
  const { household, view } = await getChore(householdId, choreId);
  const back = (
    <Link
      href={`/households/${household.id}/chores`}
      className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      Chores
    </Link>
  );
  if (view.state === "removed") {
    return (
      <>
        {back}
        <ErrorState
          title="This chore has been removed"
          description="It's no longer on the chores page, so it can't be changed. Add it again if it still needs doing."
        />
      </>
    );
  }
  const { chore } = view;
  // D28 (proposed); the database enforces the same rule.
  if (
    !canManageChore(chore, {
      userId: household.myUserId,
      isOwner: household.myRole === "owner",
    })
  ) {
    return (
      <>
        {back}
        <ErrorState
          title="You can't edit this chore"
          description="Only the person who added it, the person it's assigned to, or the household owner can."
        />
      </>
    );
  }

  const [members, people] = await Promise.all([
    listMembersInJoinOrder(household.id),
    listHouseholdPeople(household.id),
  ]);
  const former =
    chore.assigneeId && !members.some((m) => m.userId === chore.assigneeId)
      ? {
          userId: chore.assigneeId,
          displayName:
            people.find((p) => p.userId === chore.assigneeId)?.displayName ??
            "Former member",
        }
      : null;

  return (
    <>
      {back}
      <PageHeader
        title="Edit chore"
        description="Change what it is, reassign it, or move its due date. The household journal notes what changed."
      />
      <Card>
        <CardContent>
          <ChoreForm
            action={updateChore}
            hidden={{
              householdId: household.id,
              choreId: chore.id,
              expectedUpdatedAt: chore.updatedAt,
            }}
            members={members}
            former={former}
            viewerId={household.myUserId}
            defaults={{
              title: chore.title,
              description: chore.description ?? "",
              assignee: chore.assigneeId ?? "",
              dueOn: chore.dueOn ?? "",
              priority: chore.priority,
            }}
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>
    </>
  );
}
