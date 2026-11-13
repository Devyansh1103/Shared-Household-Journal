import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { io } from "next/cache";
import {
  ArrowLeftIcon,
  CheckIcon,
  PencilIcon,
  ShoppingBasketIcon,
  Undo2Icon,
} from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { FilterChips } from "@/components/filter-chips";
import { FormAlert } from "@/components/form-alert";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { personName } from "@/lib/bills/board";
import { formatDateTime } from "@/lib/format";
import {
  getHousehold,
  listHouseholdPeople,
  listMembersInJoinOrder,
  type Household,
} from "@/lib/households/queries";
import { EMPTY_ITEM_FORM } from "@/lib/shopping/form";
import {
  filterItems,
  itemLabel,
  readShoppingQuery,
  SHOPPING_VIEW_LABELS,
  SHOPPING_VIEWS,
  shoppingHref,
  whoChips,
  type ShoppingItem,
} from "@/lib/shopping/list";
import {
  getShoppingList,
  PENDING_LIMIT,
  PURCHASED_LIMIT,
} from "@/lib/shopping/queries";
import { addItem, purchaseItem, removeItem, reopenItem } from "./actions";
import { ItemForm } from "./item-form";

export const metadata: Metadata = { title: "Shopping list" };

export default function ShoppingPage({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/shopping">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<ShoppingSkeleton />}>
        <Shopping params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function Shopping({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/shopping">) {
  const { householdId } = await params;
  // Not a member (or no such household): the same 404, from the data layer.
  const household = await getHousehold(householdId);
  const [members, people, view, search] = await Promise.all([
    listMembersInJoinOrder(household.id),
    listHouseholdPeople(household.id),
    getShoppingList(household.id),
    searchParams,
  ]);
  const base = `/households/${household.id}/shopping`;
  const query = readShoppingQuery(
    search,
    people.map((p) => p.userId),
  );
  // A fresh key per visit, so resubmitting can't add the item twice.
  await io();
  const requestKey = randomUUID();

  const header = (
    <>
      <Link
        href={`/households/${household.id}`}
        className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Household
      </Link>
      <PageHeader
        title="Shopping list"
        description={`One list for ${household.name}. Anyone in the household can add, change, tick off or remove an item. Nothing here is an expense: record what you spend separately.`}
      />
      {search.updated === "1" ? (
        <FormAlert tone="success">The item is saved.</FormAlert>
      ) : null}
    </>
  );

  if (!view.ok) {
    return (
      <div className="space-y-8">
        {header}
        <ErrorState
          title="The shopping list can't be shown right now"
          description="The list didn't pass the checks that make sure every item belongs to this household, so nothing is shown. Nothing has been changed. Reload the page to try again."
        />
      </div>
    );
  }

  const { pending, purchased } = filterItems(
    view.items,
    query,
    household.myUserId,
  );
  const name = (userId: string) =>
    personName(people, userId, household.myUserId);
  const filtered = query.who !== "anyone";

  return (
    <div className="space-y-8">
      {header}
      <Card>
        <CardContent className="space-y-4">
          <h2 className="type-section-title">Add an item</h2>
          <ItemForm
            mode="add"
            action={addItem}
            hidden={{ householdId: household.id }}
            requestKey={requestKey}
            members={members}
            viewerId={household.myUserId}
            defaults={EMPTY_ITEM_FORM}
          />
        </CardContent>
      </Card>

      <div className="space-y-3">
        <FilterChips
          label="Show on the list"
          chips={SHOPPING_VIEWS.map((show) => ({
            key: show,
            href: shoppingHref(base, { ...query, show }),
            label: SHOPPING_VIEW_LABELS[show],
            active: query.show === show,
          }))}
        />
        <FilterChips
          label="Whose items"
          chips={whoChips(people, household.myUserId, query.who).map(
            (chip) => ({
              ...chip,
              href: shoppingHref(base, { ...query, who: chip.key }),
            }),
          )}
        />
      </div>

      {view.items.length === 0 ? (
        <EmptyState
          icon={<ShoppingBasketIcon />}
          title="The list is empty"
          description="Add what the household needs above. Everyone in the household sees the same list."
        />
      ) : (
        <>
          {query.show !== "purchased" ? (
            <Section
              title="Still needed"
              description={
                pending.length === 0
                  ? filtered
                    ? "Nothing still needed matches this filter."
                    : "Nothing is still needed."
                  : `${count(pending.length, "item")}.`
              }
            >
              {pending.length > 0 ? (
                <ItemRows
                  items={pending}
                  household={household}
                  base={base}
                  name={name}
                />
              ) : null}
              {view.pendingTruncated ? (
                <p className="type-help">
                  Showing the first {PENDING_LIMIT} items still needed.
                </p>
              ) : null}
            </Section>
          ) : null}
          {query.show !== "pending" ? (
            <Section
              title="Bought"
              description={
                purchased.length === 0
                  ? "Nothing bought matches this filter."
                  : `The most recently bought first${view.purchasedTruncated ? `, up to ${PURCHASED_LIMIT}` : ""}.`
              }
            >
              {purchased.length > 0 ? (
                <ItemRows
                  items={purchased}
                  household={household}
                  base={base}
                  name={name}
                />
              ) : null}
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}

function count(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function ItemRows({
  items,
  household,
  base,
  name,
}: {
  items: ShoppingItem[];
  household: Household;
  base: string;
  name: (userId: string) => string;
}) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {items.map((item) => {
        const label = itemLabel(item);
        const bought = item.purchasedAt !== null;
        const fields = {
          householdId: household.id,
          itemId: item.id,
          itemName: item.name,
        };
        return (
          <li key={item.id} className="flex flex-col gap-3 p-4">
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 type-card-title wrap-break-word">
                  {item.name}
                </span>
                {item.quantity ? (
                  <span className="type-secondary">{item.quantity}</span>
                ) : null}
                {bought ? (
                  <StatusBadge status="success">Bought</StatusBadge>
                ) : null}
              </div>
              {item.note ? (
                <p className="type-body wrap-break-word">{item.note}</p>
              ) : null}
              <p className="type-secondary">
                {item.assigneeId
                  ? `For ${name(item.assigneeId)} to get · `
                  : ""}
                Added by {name(item.addedBy)}
                {bought && item.purchasedBy && item.purchasedAt
                  ? ` · bought by ${name(item.purchasedBy)}, ${formatDateTime(item.purchasedAt, household.timezone)}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {bought ? (
                <ActionButton
                  action={reopenItem}
                  fields={fields}
                  pendingLabel="Saving…"
                  ariaLabel={`Still needed: ${label}`}
                  icon={
                    <Undo2Icon aria-hidden="true" data-icon="inline-start" />
                  }
                >
                  Still needed
                </ActionButton>
              ) : (
                <ActionButton
                  action={purchaseItem}
                  fields={fields}
                  pendingLabel="Saving…"
                  variant="default"
                  ariaLabel={`Mark bought: ${label}`}
                  icon={
                    <CheckIcon aria-hidden="true" data-icon="inline-start" />
                  }
                >
                  Mark bought
                </ActionButton>
              )}
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={`${base}/${item.id}/edit`}
                  aria-label={`Edit: ${label}`}
                >
                  <PencilIcon aria-hidden="true" data-icon="inline-start" />
                  Edit
                </Link>
              </Button>
              <ConfirmActionDialog
                triggerLabel="Remove"
                triggerAriaLabel={`Remove: ${label}`}
                triggerVariant="ghost"
                title={`Remove ${label} from the list?`}
                description="It goes off the list for everyone. The household journal keeps a record that it was added and removed."
                confirmLabel="Remove item"
                cancelLabel="Keep item"
                pendingLabel="Removing…"
                destructive
                action={removeItem}
                fields={fields}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ShoppingSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading the shopping list"
      className="space-y-6"
    >
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-48 w-full" />
      <div className="space-y-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}
