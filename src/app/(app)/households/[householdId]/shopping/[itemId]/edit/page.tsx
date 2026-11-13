import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { FormSkeleton } from "@/components/form-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  listHouseholdPeople,
  listMembersInJoinOrder,
} from "@/lib/households/queries";
import { getShoppingItem } from "@/lib/shopping/queries";
import { updateItem } from "../../actions";
import { ItemForm } from "../../item-form";

export const metadata: Metadata = { title: "Edit item" };

export default function EditItemPage({
  params,
}: PageProps<"/households/[householdId]/shopping/[itemId]/edit">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<FormSkeleton fields={4} label="Loading form" />}>
        <EditItem params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function EditItem({
  params,
}: Pick<
  PageProps<"/households/[householdId]/shopping/[itemId]/edit">,
  "params"
>) {
  const { householdId, itemId } = await params;
  // A 404 for a non-member, a malformed id or another household's item.
  const { household, view } = await getShoppingItem(householdId, itemId);
  const back = (
    <Link
      href={`/households/${household.id}/shopping`}
      className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      Shopping list
    </Link>
  );
  if (view.state === "removed") {
    return (
      <>
        {back}
        <ErrorState
          title="This item has been removed"
          description="It's no longer on the shopping list, so it can't be changed. Add it again if it's still needed."
        />
      </>
    );
  }

  const { item } = view;
  const [members, people] = await Promise.all([
    listMembersInJoinOrder(household.id),
    listHouseholdPeople(household.id),
  ]);
  const formerAssignee =
    item.assigneeId && !members.some((m) => m.userId === item.assigneeId)
      ? (people.find((p) => p.userId === item.assigneeId) ?? {
          userId: item.assigneeId,
          displayName: "Former member",
        })
      : null;

  return (
    <>
      {back}
      <PageHeader
        title="Edit item"
        description="Anyone in the household can change an item. The household journal notes what changed."
      />
      <Card>
        <CardContent>
          <ItemForm
            mode="edit"
            action={updateItem}
            hidden={{
              householdId: household.id,
              itemId: item.id,
              expectedUpdatedAt: item.updatedAt,
            }}
            members={members}
            former={
              formerAssignee
                ? {
                    userId: formerAssignee.userId,
                    displayName: formerAssignee.displayName,
                  }
                : null
            }
            viewerId={household.myUserId}
            defaults={{
              name: item.name,
              quantity: item.quantity ?? "",
              note: item.note ?? "",
              assignee: item.assigneeId ?? "",
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
