import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { io } from "next/cache";
import {
  BellIcon,
  CheckCheckIcon,
  CheckIcon,
  SettingsIcon,
} from "lucide-react";
import { cn } from "cn";
import { ActionButton } from "@/components/action-button";
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
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { instantFromMicroseconds } from "@/lib/journal/days";
import { describeNotifications } from "@/lib/notifications/describe";
import { NOTIFICATIONS_CHANGED } from "@/lib/notifications/events";
import { nextNotificationsCursor } from "@/lib/notifications/payload";
import { getNotifications, getReminders } from "@/lib/notifications/queries";
import {
  notificationsHref,
  parseNotificationsQuery,
  readNotificationsQuery,
  type NotificationsQuery,
} from "@/lib/notifications/query";
import {
  markAllNotificationsRead,
  markNotificationRead,
  openNotification,
} from "./actions";

export const metadata: Metadata = { title: "Notifications" };

const BASE = "/notifications";

export default function NotificationsPage({
  searchParams,
}: PageProps<"/notifications">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<NotificationsSkeleton />}>
        <Notifications searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function Notifications({
  searchParams,
}: Pick<PageProps<"/notifications">, "searchParams">) {
  await requireUser();
  const search = await searchParams;
  const parsed = parseNotificationsQuery(readNotificationsQuery(search));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Notifications"
        description="What's happened in your households that concerns you. They're shown here, in the app only: nothing is emailed or sent to your phone."
        actions={
          <Button variant="outline" asChild>
            <Link href="/profile/notifications">
              <SettingsIcon aria-hidden="true" data-icon="inline-start" />
              Notification settings
            </Link>
          </Button>
        }
      />
      {search.missing === "1" ? (
        <FormAlert tone="info">
          That notification isn&apos;t available any more.
        </FormAlert>
      ) : null}

      {parsed.ok && parsed.query.before === null ? (
        <Suspense fallback={<RemindersSkeleton />}>
          <NeedsAttention />
        </Suspense>
      ) : null}

      {parsed.ok ? (
        // A new key for every view, so a new filter or page shows the
        // loading state rather than the previous notifications.
        <Suspense
          key={notificationsHref(BASE, parsed.query)}
          fallback={<ListSkeleton />}
        >
          <NotificationList query={parsed.query} />
        </Suspense>
      ) : (
        <FormAlert tone="error">
          That link doesn&apos;t point to a list of notifications, so nothing is
          shown.{" "}
          <Link
            href={BASE}
            className="rounded-sm text-primary underline underline-offset-4"
          >
            Show your notifications
          </Link>
        </FormAlert>
      )}
    </div>
  );
}

/** The live list (D30): not notifications, nothing to mark read. */
async function NeedsAttention() {
  // "Today" is each household's own date (D11), at request time.
  await io();
  const { reminders, incomplete } = await getReminders();
  return (
    <Section
      title="Needs attention"
      description="Bills and chores due today or overdue, and budgets near or over their limit, as they are now. They go away once they're dealt with."
    >
      {reminders.length === 0 ? (
        <p className="type-body">
          Nothing is overdue, due today or near a budget limit.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {reminders.map((reminder) => (
            <li key={reminder.key} className="flex flex-col gap-1 p-4">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <StatusBadge status={reminder.tone}>
                  {reminder.label}
                </StatusBadge>
                <Link
                  href={reminder.href}
                  className="min-w-0 rounded-sm type-card-title wrap-break-word underline-offset-4 hover:underline"
                >
                  {reminder.title}
                </Link>
              </div>
              <p className="type-secondary">
                {reminder.detail} · {reminder.householdName}
              </p>
            </li>
          ))}
        </ul>
      )}
      {incomplete.length > 0 ? (
        <p className="type-help">
          Some of {incomplete.join(", ")} couldn&apos;t be checked just now.
          Reload the page to try again.
        </p>
      ) : null}
    </Section>
  );
}

async function NotificationList({ query }: { query: NotificationsQuery }) {
  const user = await requireUser();
  const view = await getNotifications(query);
  if (!view.ok) {
    return (
      <ErrorState
        title="Your notifications can't be shown right now"
        description="They didn't pass the checks that make sure each one is yours and about the right record, so none is shown. Nothing has been changed. Reload the page to try again."
      />
    );
  }
  const { page } = view;
  const views = describeNotifications(page, user.id);
  const older = nextNotificationsCursor(page);

  return (
    <Section
      title={query.show === "unread" ? "Unread" : "All notifications"}
      description={
        page.unreadCount === 0
          ? "You're all caught up."
          : page.unreadCount === 1
            ? "1 unread."
            : `${page.unreadCount} unread.`
      }
      actions={
        page.unreadCount > 0 ? (
          <ActionButton
            action={markAllNotificationsRead}
            fields={{}}
            pendingLabel="Marking…"
            broadcast={NOTIFICATIONS_CHANGED}
            icon={
              <CheckCheckIcon aria-hidden="true" data-icon="inline-start" />
            }
          >
            Mark all as read
          </ActionButton>
        ) : undefined
      }
    >
      <FilterChips
        label="Show notifications"
        chips={(["all", "unread"] as const).map((show) => ({
          key: show,
          href: notificationsHref(BASE, { show, before: null }),
          label: show === "all" ? "All" : `Unread (${page.unreadCount})`,
          active: query.show === show,
        }))}
      />

      {views.length === 0 ? (
        query.before ? (
          <p className="type-body">Nothing older.</p>
        ) : query.show === "unread" ? (
          <EmptyState
            icon={<CheckIcon />}
            title="No unread notifications"
            description="You've seen everything so far."
            action={
              <Button variant="outline" asChild>
                <Link href={BASE}>Show all notifications</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<BellIcon />}
            title="No notifications yet"
            description="When someone adds an expense you share, records a payment with you, assigns you a chore or changes a budget, it shows here. Choose what you hear about in your notification settings."
          />
        )
      ) : (
        <ol className="divide-y divide-border rounded-xl border border-border bg-card">
          {views.map(({ item, description }) => {
            const titleId = `notification-${item.id}`;
            const summaryId = `notification-${item.id}-summary`;
            const instant = instantFromMicroseconds(item.createdUs);
            return (
              <li
                key={item.id}
                className={cn(
                  "relative flex flex-col gap-3 p-4 sm:flex-row sm:items-start",
                  !item.read &&
                    "before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-full before:bg-info",
                )}
              >
                <article
                  aria-labelledby={titleId}
                  className="min-w-0 flex-1 space-y-1"
                >
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 type-timestamp">
                    {item.read ? null : <Badge variant="info">New</Badge>}
                    <span className="min-w-0 wrap-break-word">
                      {item.householdName}
                    </span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={instant.toISOString()}>
                      {formatDateTime(instant, item.timeZone)}
                    </time>
                    <span aria-hidden="true">·</span>
                    <span>{description.categoryLabel}</span>
                  </p>
                  <form action={openNotification}>
                    <input
                      type="hidden"
                      name="notificationId"
                      value={item.id}
                    />
                    <button
                      type="submit"
                      id={titleId}
                      aria-describedby={
                        description.summary ? summaryId : undefined
                      }
                      className={cn(
                        "rounded-sm text-left type-card-title wrap-break-word underline-offset-4 hover:underline",
                        item.read && "font-medium",
                      )}
                    >
                      {description.title}
                    </button>
                  </form>
                  {description.summary ? (
                    <p
                      id={summaryId}
                      className="type-secondary wrap-break-word"
                    >
                      {description.summary}
                    </p>
                  ) : null}
                  {description.unavailable ? (
                    <p className="type-help">
                      What it was about isn&apos;t available any more; opening
                      it shows the household&apos;s journal.
                    </p>
                  ) : null}
                </article>
                {item.read ? null : (
                  <div className="flex flex-wrap gap-2 sm:shrink-0">
                    <ActionButton
                      action={markNotificationRead}
                      fields={{ notificationId: item.id }}
                      pendingLabel="Marking…"
                      ariaLabel={`Mark as read: ${description.title}`}
                      broadcast={NOTIFICATIONS_CHANGED}
                    >
                      Mark as read
                    </ActionButton>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {older ? (
        <div>
          <Button variant="outline" asChild>
            <Link
              href={notificationsHref(BASE, {
                show: query.show,
                before: older,
              })}
            >
              Show older notifications
            </Link>
          </Button>
        </div>
      ) : null}
      {query.before ? (
        <p>
          <Link
            href={notificationsHref(BASE, { show: query.show, before: null })}
            className="rounded-sm type-label text-primary underline underline-offset-4"
          >
            Back to the newest
          </Link>
        </p>
      ) : null}
    </Section>
  );
}

function RemindersSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading what needs attention"
      className="space-y-3"
    >
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading notifications"
      className="space-y-3"
    >
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

function NotificationsSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading notifications"
      className="space-y-6"
    >
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
