import Link from "next/link";
import { io } from "next/cache";
import {
  BanIcon,
  CalendarCogIcon,
  CalendarPlusIcon,
  CalendarXIcon,
  CircleCheckIcon,
  CirclePauseIcon,
  CirclePlayIcon,
  CrownIcon,
  HandCoinsIcon,
  HouseIcon,
  Link2OffIcon,
  LinkIcon,
  ListPlusIcon,
  LogOutIcon,
  NotebookTextIcon,
  PencilIcon,
  ReceiptIcon,
  RotateCcwIcon,
  SearchXIcon,
  ShoppingBasketIcon,
  SkipForwardIcon,
  Trash2Icon,
  Undo2Icon,
  UserMinusIcon,
  UserPlusIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SettlementNotice } from "@/components/settlement-notice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Household } from "@/lib/households/queries";
import {
  entryTimeLabel,
  groupByDay,
  instantFromMicroseconds,
  type DayGroup,
  type DayKind,
} from "@/lib/journal/days";
import { entryDescriber, type EntryDescription } from "@/lib/journal/describe";
import {
  entryCategory,
  nextCursor,
  type JournalEntry,
  type JournalEntryType,
} from "@/lib/journal/payload";
import {
  journalHref,
  type JournalCategory,
  type JournalQuery,
} from "@/lib/journal/query";
import { getJournal } from "@/lib/journal/queries";
import { RetryButton } from "./retry-button";

const ICONS: Record<JournalEntryType, LucideIcon> = {
  household_created: HouseIcon,
  member_joined: UserPlusIcon,
  member_left: LogOutIcon,
  member_removed: UserMinusIcon,
  ownership_transferred: CrownIcon,
  invitation_created: LinkIcon,
  invitation_revoked: Link2OffIcon,
  expense_created: ReceiptIcon,
  expense_updated: PencilIcon,
  expense_deleted: Trash2Icon,
  expense_restored: RotateCcwIcon,
  settlement_recorded: HandCoinsIcon,
  settlement_voided: BanIcon,
  bill_created: CalendarPlusIcon,
  bill_updated: CalendarCogIcon,
  bill_paused: CirclePauseIcon,
  bill_resumed: CirclePlayIcon,
  bill_ended: CalendarXIcon,
  bill_skipped: SkipForwardIcon,
  bill_unskipped: Undo2Icon,
  shopping_item_added: ShoppingBasketIcon,
  shopping_item_updated: PencilIcon,
  shopping_item_purchased: CircleCheckIcon,
  shopping_item_reopened: Undo2Icon,
  shopping_item_removed: Trash2Icon,
  chore_created: ListPlusIcon,
  chore_updated: PencilIcon,
  chore_completed: CircleCheckIcon,
  chore_reopened: Undo2Icon,
  chore_removed: Trash2Icon,
};

/** Token pairs checked by tokens.test.ts; the category is also said in words. */
const TONES: Record<JournalCategory, string> = {
  expenses: "bg-info-subtle text-info",
  settlements: "bg-secondary text-secondary-foreground",
  bills: "bg-muted text-muted-foreground",
  shopping: "bg-success-subtle text-success",
  chores: "bg-accent text-accent-foreground",
  household: "bg-highlight-subtle text-highlight-foreground",
};

const EMPTY: Record<JournalCategory, { title: string; description: string }> = {
  expenses: {
    title: "No expense activity yet",
    description:
      "When someone adds, edits or deletes an expense, it will appear here.",
  },
  settlements: {
    title: "No payments recorded yet",
    description: "When someone records a payment, it will appear here.",
  },
  bills: {
    title: "No bill activity yet",
    description:
      "When someone adds, changes, pauses or ends a bill, or skips a period, it will appear here. Recording a bill adds an expense.",
  },
  shopping: {
    title: "No shopping list activity yet",
    description:
      "When someone adds, changes, buys or removes an item on the shopping list, it will appear here.",
  },
  chores: {
    title: "No chore activity yet",
    description:
      "When someone adds, changes, completes or removes a chore, it will appear here.",
  },
  household: {
    title: "No household activity yet",
    description:
      "When someone joins, leaves or creates an invite link, it will appear here.",
  },
};

const UNAVAILABLE: Record<JournalCategory, string> = {
  expenses: "This expense is no longer available.",
  settlements: "This payment is no longer available.",
  bills: "This bill is no longer available.",
  shopping: "This item is no longer available.",
  chores: "This chore is no longer available.",
  household: "This is no longer available.",
};

/** Said at the end, when there's nothing older. */
const END: Record<JournalQuery["filter"], string> = {
  all: "That's the start of the journal.",
  expenses: "That's all the expense activity.",
  settlements: "That's all the payment activity.",
  bills: "That's all the bill activity.",
  shopping: "That's all the shopping list activity.",
  chores: "That's all the chore activity.",
  household: "That's all the household activity.",
};

/**
 * One page of the household's journal, newest first, under day headings in
 * the household's timezone (D11). Everything shown comes from one call (one
 * snapshot) and has passed checkJournal; otherwise no entries are shown.
 */
export async function JournalTimeline({
  household,
  query,
  base,
}: {
  household: Household;
  query: JournalQuery;
  base: string;
}) {
  const view = await getJournal(household.id, query);
  if (!view.ok) {
    return (
      <ErrorState
        title="The journal can't be shown right now"
        description="The entries didn't pass the checks that make sure each one belongs to this household and is in order, so nothing is shown. Nothing has been changed."
        action={<RetryButton />}
      />
    );
  }

  const { page } = view;
  const latestHref = journalHref(base, { ...query, before: null });

  if (page.entries.length === 0) {
    if (query.before) {
      return (
        <EmptyState
          icon={<NotebookTextIcon />}
          title="Nothing older"
          description="There's no activity before this point."
          action={
            <Button variant="outline" asChild>
              <Link href={latestHref}>Back to the latest</Link>
            </Button>
          }
        />
      );
    }
    return query.filter !== "all" ? (
      <EmptyState
        icon={<SearchXIcon />}
        title={EMPTY[query.filter].title}
        description={EMPTY[query.filter].description}
        action={
          <Button variant="outline" asChild>
            <Link href={base}>Show all activity</Link>
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={<NotebookTextIcon />}
        title="Nothing in the journal yet"
        description="Household activity will appear here as members add expenses, record payments and join the household."
      />
    );
  }

  // The day headings depend on today's date in the household's timezone,
  // worked out at request time.
  await io();
  const now = new Date();
  const describe = entryDescriber({
    householdId: household.id,
    viewerId: household.myUserId,
    currency: household.currencyCode,
    people: page.people,
  });
  const groups = groupByDay(
    page.entries,
    (entry) => instantFromMicroseconds(entry.createdUs),
    { now, timeZone: household.timezone },
  );
  const showsPayments =
    query.filter === "settlements" ||
    page.entries.some((entry) => entryCategory(entry) === "settlements");
  const older = nextCursor(page);

  return (
    <div className="space-y-8">
      {query.before ? (
        <p className="type-secondary">
          You&apos;re looking at older activity.{" "}
          <Link
            href={latestHref}
            className="rounded-sm type-label text-primary underline underline-offset-4"
          >
            Back to the latest
          </Link>
        </p>
      ) : null}

      {showsPayments ? (
        <SettlementNotice>
          Payments in the journal are records people made, not transfers.
        </SettlementNotice>
      ) : null}

      {groups.map((group) => (
        <DaySection
          key={group.key}
          group={group}
          describe={describe}
          timeZone={household.timezone}
        />
      ))}

      {/* A landmark only when it holds a link. */}
      {older || query.before ? (
        <nav
          aria-label="Journal pages"
          className="flex flex-wrap items-center gap-3"
        >
          {older ? (
            <Button variant="outline" asChild>
              <Link href={journalHref(base, { ...query, before: older })}>
                Show older activity
              </Link>
            </Button>
          ) : (
            <p className="type-secondary">{END[query.filter]}</p>
          )}
          {query.before ? (
            <Link
              href={latestHref}
              className="rounded-sm type-label text-primary underline-offset-4 hover:underline"
            >
              Back to the latest
            </Link>
          ) : null}
        </nav>
      ) : (
        <p className="type-secondary">{END[query.filter]}</p>
      )}
    </div>
  );
}

function DaySection({
  group,
  describe,
  timeZone,
}: {
  group: DayGroup<JournalEntry>;
  describe: (entry: JournalEntry) => EntryDescription;
  timeZone: string;
}) {
  const headingId = `journal-day-${group.key}`;
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="type-section-title">
        {group.label}
      </h2>
      <ol className="divide-y divide-border rounded-xl border border-border bg-card">
        {group.entries.map((entry) => (
          <JournalItem
            key={entry.id}
            entry={entry}
            description={describe(entry)}
            kind={group.kind}
            timeZone={timeZone}
          />
        ))}
      </ol>
    </section>
  );
}

function JournalItem({
  entry,
  description,
  kind,
  timeZone,
}: {
  entry: JournalEntry;
  description: EntryDescription;
  kind: DayKind;
  timeZone: string;
}) {
  const Icon = ICONS[entry.detail.type];
  const instant = instantFromMicroseconds(entry.createdUs);
  const about = [description.summary, ...description.context].filter(
    (part): part is string => Boolean(part),
  );

  return (
    <li className="flex min-w-0 gap-3 p-4">
      <span
        aria-hidden="true"
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          TONES[description.category],
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="type-card-title wrap-break-word">{description.title}</p>
        {about.length > 0 ? (
          <p className="type-secondary wrap-break-word">
            {about.map((part, i) => (
              <span key={i}>
                {i > 0 ? <span aria-hidden="true"> · </span> : null}
                {i > 0 ? <span className="sr-only">. </span> : null}
                {part}
              </span>
            ))}
          </p>
        ) : null}
        {description.changes.length > 0 ? (
          <ul
            aria-label="What changed"
            className="space-y-0.5 type-secondary wrap-break-word"
          >
            {description.changes.map((change) => (
              <li key={change.label}>
                <span className="font-medium text-foreground">
                  {change.label}:
                </span>{" "}
                {change.kind === "value" ? (
                  <>
                    {change.from} <span aria-hidden="true">→</span>
                    <span className="sr-only">to</span> {change.to}
                  </>
                ) : (
                  change.text
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {description.unavailable ? (
          <p className="type-help">{UNAVAILABLE[description.category]}</p>
        ) : null}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 type-timestamp">
          <time dateTime={instant.toISOString()}>
            {entryTimeLabel(instant, kind, timeZone)}
          </time>
          <span aria-hidden="true">·</span>
          <span>{description.categoryLabel}</span>
          {description.link ? (
            <>
              <span aria-hidden="true">·</span>
              <Link
                href={description.link.href}
                aria-label={
                  description.link.accessibleLabel === description.link.label
                    ? undefined
                    : description.link.accessibleLabel
                }
                className="rounded-sm type-label text-primary underline-offset-4 hover:underline"
              >
                {description.link.label}
              </Link>
            </>
          ) : null}
        </p>
      </div>
    </li>
  );
}

export function TimelineSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading activity"
      className="space-y-3"
    >
      <Skeleton className="h-6 w-24" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
