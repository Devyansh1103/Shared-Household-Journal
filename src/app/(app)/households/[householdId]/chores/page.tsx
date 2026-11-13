import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { io } from "next/cache";
import {
  ArrowLeftIcon,
  CheckIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { personName } from "@/lib/bills/board";
import {
  boardIsEmpty,
  canFinishChore,
  canManageChore,
  CHORE_VIEW_LABELS,
  CHORE_VIEWS,
  choreBoard,
  choreDue,
  choreDueLabel,
  choresHref,
  readChoreQuery,
  type Chore,
} from "@/lib/chores/board";
import { CHORE_PRIORITIES, PRIORITY_LABELS } from "@/lib/chores/form";
import { COMPLETED_LIMIT, getChores, OPEN_LIMIT } from "@/lib/chores/queries";
import { todayIn } from "@/lib/expenses/dates";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  getHousehold,
  listHouseholdPeople,
  listMembersInJoinOrder,
  type Household,
} from "@/lib/households/queries";
import { whoChips } from "@/lib/shopping/list";
import { completeChore, removeChore, reopenChore } from "./actions";

export const metadata: Metadata = { title: "Chores" };

export default function ChoresPage({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/chores">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<ChoresSkeleton />}>
        <Chores params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function Chores({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/chores">) {
  const { householdId } = await params;
  // Not a member (or no such household): the same 404, from the data layer.
  const household = await getHousehold(householdId);
  const [members, people, view, search] = await Promise.all([
    listMembersInJoinOrder(household.id),
    listHouseholdPeople(household.id),
    getChores(household.id),
    searchParams,
  ]);
  const base = `/households/${household.id}/chores`;
  const query = readChoreQuery(
    search,
    people.map((p) => p.userId),
  );
  // "Overdue" and "due today" are the household's own days (D11), worked out
  // at request time.
  await io();
  const today = todayIn(household.timezone);

  const addButton = (
    <Button asChild>
      <Link href={`${base}/new`}>
        <PlusIcon aria-hidden="true" data-icon="inline-start" />
        Add a chore
      </Link>
    </Button>
  );

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
        title="Chores"
        description={`What needs doing in ${household.name}, who's doing it and when it's due.`}
        actions={view.ok && view.chores.length > 0 ? addButton : undefined}
      />
      {search.created === "1" ? (
        <FormAlert tone="success">The chore is added.</FormAlert>
      ) : null}
      {search.updated === "1" ? (
        <FormAlert tone="success">The chore is saved.</FormAlert>
      ) : null}
    </>
  );

  if (!view.ok) {
    return (
      <div className="space-y-8">
        {header}
        <ErrorState
          title="Chores can't be shown right now"
          description="The chores didn't pass the checks that make sure every one belongs to this household, so nothing is shown. Nothing has been changed. Reload the page to try again."
        />
      </div>
    );
  }

  if (view.chores.length === 0) {
    return (
      <div className="space-y-8">
        {header}
        <EmptyState
          icon={<ListChecksIcon />}
          title="No chores yet"
          description="Add what needs doing around the home, like taking out the bins, and choose who's doing it and when."
          action={addButton}
        />
      </div>
    );
  }

  const board = choreBoard(view.chores, {
    today,
    viewerId: household.myUserId,
    query,
  });
  const activeIds = new Set(members.map((m) => m.userId));
  const name = (userId: string) =>
    personName(people, userId, household.myUserId);
  const rows = (chores: Chore[]) => (
    <ChoreRows
      chores={chores}
      household={household}
      base={base}
      today={today}
      name={name}
      activeIds={activeIds}
    />
  );

  return (
    <div className="space-y-8">
      {header}
      <p className="type-help">
        Today is {formatDate(today)} in the household&apos;s timezone. Chores
        show here as they come due; the app doesn&apos;t send reminders or
        notifications.
      </p>

      <div className="space-y-3">
        <FilterChips
          label="Show chores"
          chips={CHORE_VIEWS.map((show) => ({
            key: show,
            href: choresHref(base, { ...query, show }),
            label: CHORE_VIEW_LABELS[show],
            active: query.show === show,
          }))}
        />
        <FilterChips
          label="Whose chores"
          chips={whoChips(people, household.myUserId, query.who).map(
            (chip) => ({
              ...chip,
              href: choresHref(base, { ...query, who: chip.key }),
            }),
          )}
        />
        <FilterChips
          label="Priority"
          chips={(["any", ...CHORE_PRIORITIES] as const).map((priority) => ({
            key: priority,
            href: choresHref(base, { ...query, priority }),
            label:
              priority === "any" ? "Any priority" : PRIORITY_LABELS[priority],
            active: query.priority === priority,
          }))}
        />
      </div>

      {boardIsEmpty(board) ? (
        <p className="type-body">
          No chores match these filters.{" "}
          <Link
            href={base}
            className="rounded-sm text-primary underline underline-offset-4"
          >
            Show everything to do
          </Link>
        </p>
      ) : null}
      {board.mine.length > 0 ? (
        <Section title="My tasks" description="Assigned to you, soonest first.">
          {rows(board.mine)}
        </Section>
      ) : null}
      {board.overdue.length > 0 ? (
        <Section
          title="Overdue"
          description="Their due date has passed and they aren't done."
        >
          {rows(board.overdue)}
        </Section>
      ) : null}
      {board.dueToday.length > 0 ? (
        <Section title="Due today">{rows(board.dueToday)}</Section>
      ) : null}
      {board.upcoming.length > 0 ? (
        <Section title="Upcoming">{rows(board.upcoming)}</Section>
      ) : null}
      {board.anytime.length > 0 ? (
        <Section title="Any time" description="No due date.">
          {rows(board.anytime)}
        </Section>
      ) : null}
      {view.openTruncated ? (
        <p className="type-help">
          Showing the first {OPEN_LIMIT} chores to do, soonest due first.
        </p>
      ) : null}
      {board.completed.length > 0 ? (
        <Section
          title="Done"
          description={`The most recently done first${view.completedTruncated ? `, up to ${COMPLETED_LIMIT}` : ""}.`}
        >
          {rows(board.completed)}
        </Section>
      ) : null}
    </div>
  );
}

const DUE_BADGES = {
  overdue: { status: "danger", label: "Overdue" },
  today: { status: "warning", label: "Due today" },
  upcoming: { status: "neutral", label: "Upcoming" },
} as const;

/** Priority in words: colour is never the only signal. */
function PriorityBadge({ priority }: { priority: Chore["priority"] }) {
  if (priority === "high") {
    return <StatusBadge status="warning">High priority</StatusBadge>;
  }
  return <Badge variant="outline">{PRIORITY_LABELS[priority]} priority</Badge>;
}

function ChoreRows({
  chores,
  household,
  base,
  today,
  name,
  activeIds,
}: {
  chores: Chore[];
  household: Household;
  base: string;
  today: string;
  name: (userId: string) => string;
  activeIds: ReadonlySet<string>;
}) {
  const viewer = {
    userId: household.myUserId,
    isOwner: household.myRole === "owner",
  };
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {chores.map((chore) => {
        const done = chore.completedAt !== null;
        const due = done ? null : choreDue(chore.dueOn, today);
        const dueBadge = due && due !== "anytime" ? DUE_BADGES[due] : null;
        const dueText = choreDueLabel(chore, today);
        const manage = canManageChore(chore, viewer);
        const finish = canFinishChore(chore, viewer, activeIds);
        const fields = {
          householdId: household.id,
          choreId: chore.id,
          choreTitle: chore.title,
        };
        return (
          <li key={chore.id} className="flex flex-col gap-3 p-4">
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 type-card-title wrap-break-word">
                  {chore.title}
                </span>
                {done ? <StatusBadge status="success">Done</StatusBadge> : null}
                {dueBadge ? (
                  <StatusBadge status={dueBadge.status}>
                    {dueBadge.label}
                  </StatusBadge>
                ) : null}
                <PriorityBadge priority={chore.priority} />
              </div>
              <p className="type-secondary">
                {chore.assigneeId
                  ? `For ${name(chore.assigneeId)}`
                  : "Assigned to nobody"}
                {chore.dueOn
                  ? ` · due ${formatDate(chore.dueOn)}${dueText ? ` (${dueText.toLowerCase()})` : ""}`
                  : ""}
                {` · added by ${name(chore.createdBy)}`}
              </p>
              {done && chore.completedBy && chore.completedAt ? (
                <p className="type-secondary">
                  Done by {name(chore.completedBy)},{" "}
                  {formatDateTime(chore.completedAt, household.timezone)}
                </p>
              ) : null}
              {chore.description ? (
                <p className="type-body wrap-break-word whitespace-pre-line">
                  {chore.description}
                </p>
              ) : null}
            </div>
            {finish || manage ? (
              <div className="flex flex-wrap items-center gap-2">
                {finish ? (
                  done ? (
                    <ActionButton
                      action={reopenChore}
                      fields={fields}
                      pendingLabel="Saving…"
                      ariaLabel={`Not done: ${chore.title}`}
                      icon={
                        <Undo2Icon
                          aria-hidden="true"
                          data-icon="inline-start"
                        />
                      }
                    >
                      Not done
                    </ActionButton>
                  ) : (
                    <ActionButton
                      action={completeChore}
                      fields={fields}
                      pendingLabel="Saving…"
                      variant="default"
                      ariaLabel={`Mark done: ${chore.title}`}
                      icon={
                        <CheckIcon
                          aria-hidden="true"
                          data-icon="inline-start"
                        />
                      }
                    >
                      Mark done
                    </ActionButton>
                  )
                ) : null}
                {manage && !done ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link
                      href={`${base}/${chore.id}/edit`}
                      aria-label={`Edit: ${chore.title}`}
                    >
                      <PencilIcon aria-hidden="true" data-icon="inline-start" />
                      Edit
                    </Link>
                  </Button>
                ) : null}
                {manage ? (
                  <ConfirmActionDialog
                    triggerLabel="Remove"
                    triggerAriaLabel={`Remove: ${chore.title}`}
                    triggerVariant="ghost"
                    title={`Remove “${chore.title}”?`}
                    description="It goes off the chores page for everyone. The household journal keeps a record that it was added and removed."
                    confirmLabel="Remove chore"
                    cancelLabel="Keep chore"
                    pendingLabel="Removing…"
                    destructive
                    action={removeChore}
                    fields={fields}
                  />
                ) : null}
              </div>
            ) : (
              <p className="type-help">
                Only {name(chore.assigneeId ?? chore.createdBy)}, the person who
                added it or the owner can change this chore.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ChoresSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading chores"
      className="space-y-6"
    >
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-9 w-40" />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-20" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}
