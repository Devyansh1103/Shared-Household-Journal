# Notifications

In-app notifications, built in roadmap Phase 17. Decisions: D12 and ADR-011 (in-app only, each
notification linked to a journal event, on/off per household and per type), D9 (the other party
hears about a payment), D13 (people who have left), D30 (who each event concerns, and Needs
attention; decided by the owner on 2026-11-13) in [decisions.md](decisions.md). Code:
[src/lib/notifications/](../src/lib/notifications/), the page
[src/app/(app)/notifications/](<../src/app/(app)/notifications/>), the settings
[src/app/(app)/profile/notifications/](<../src/app/(app)/profile/notifications/>), the bell
[src/components/shell/notification-bell.tsx](../src/components/shell/notification-bell.tsx), the
migration [20261120120000_notifications.sql](../supabase/migrations/20261120120000_notifications.sql).

## Channels: in the app only

| Channel      | State                                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In the app   | **Built**: the bell with the unread count, the notification centre, the settings                                                                           |
| Email        | Not built. No provider is configured; D12 and ADR-011 need a new ADR and a privacy review first                                                            |
| Browser push | Not built, for the same reason; nothing asks for notification permission                                                                                   |
| Real-time    | Not used. The bell refreshes on navigation, when the window comes back into view, after a notification action, and once a minute while the page is visible |

Nothing in the app says or implies that a notification was emailed or pushed.

## What notifies whom (D30)

Every notification comes from a real journal event, and goes to the people the event concerns:

| Events                                                                | Who is notified                                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| A member joins, leaves or is removed; ownership moves                 | Everyone in the household                                                                     |
| An expense is added, changed, deleted or restored                     | Its payer and everyone in its split (before and after a change)                               |
| A payment is recorded or voided                                       | Both people in it, so the other one (D9)                                                      |
| A recurring bill is added, changed, paused, resumed, ended or skipped | Who usually pays it and everyone in its default split (and the previous payer after a change) |
| A shopping item is added, changed, put back or removed                | Its assignee (before and after a change)                                                      |
| A shopping item is bought                                             | Its assignee, and who added it                                                                |
| A chore is added, changed, reopened or removed                        | Its assignee (before and after a change)                                                      |
| A chore is completed                                                  | Its assignee, and who added it                                                                |
| A budget is set, changed or removed                                   | Everyone in the household                                                                     |
| Invite links; creating the household                                  | No one                                                                                        |

Always: **never the person who did it**, never someone who isn't an active member of the
household (D13), and never a type the person switched off there (D12). There's no "invitation
received" notification: invites are links shared by hand, not addressed to anyone (D5). There's no
"payment completed": a payment counts once it's recorded (D9; O10 is open).

## How they're made

- **In the event's transaction.** An `AFTER INSERT` trigger on `activity_events` writes the
  notifications. Every change already writes its event inside its own function's transaction
  (ADR-006), so a change, its event and its notifications commit together or not at all: a change
  that fails notifies no one.
- **No duplicates.** A retried request returns the first result without writing a second event
  (request keys); a repeated action that changes nothing writes no event; and
  `unique (user_id, activity_event_id)` makes two for one person impossible anyway.
- **Only from now on.** Events written before the migration have no notifications; nothing is
  made up afterwards. Switching a type back on doesn't bring back what was missed.
- **No scheduler** (ADR-010): nothing is sent later. See Needs attention below.

## What a notification shows

Exactly what the journal shows for its event, as the recipient sees it ("Pat added an expense ·
Groceries — ₹1,250.00"; "Olive (left) recorded a payment of €50.00 to you"), with the household's
name, the time in the household's timezone (D11) and the type in words. The text comes from the
journal's own projection (`private.journal_detail`, shared with `household_journal`): no payment
notes, split shares, item notes, chore descriptions or invite settings. The app parses it with the
journal's strict shapes, so a field the journal doesn't show fails the check and nothing is shown.

## The notification centre (`/notifications`)

- **The bell** in the top bar (phones and tablets) and the sidebar (from 1024px), with the unread
  count as a badge (99+ above 99). Its name says the count: "Notifications, 3 unread".
- **All or Unread**, in the URL (`?show=unread`), newest first, 20 to a page, with "Show older
  notifications" (a cursor, as in the journal) and "Back to the newest".
- **Opening one** marks it read, then goes to what it's about: the expense, payment, bill,
  shopping list, chores, budgets, or members. That page checks access itself (a 404 outside the
  household). If the record isn't in the household any more, it opens the household's journal.
  Where it leads is worked out on the server from the notification, never taken from the page.
- **Mark as read** (one, named "Mark as read: Pat added an expense") and **Mark all as read**.
  Unread ones have a "New" badge and a bar at the edge, not colour alone.
- **Empty and error states:** "No notifications yet", "No unread notifications", "Nothing older",
  and an error with no list if the answer fails its checks.

## Needs attention (D30)

Above the list, worked out each time the page is shown, for all the person's households: bills
that are overdue or due today, chores that are overdue or due today and are theirs or nobody's,
and budgets near or over their limit in the current week, month or quarter. These are states, not
events: nothing is stored, nothing is read or unread, and each goes away once it's dealt with. It
uses the same reads as the Bills, Chores and Budgets pages.

## Settings (`/profile/notifications`)

One card per household with a tick for each type (Expenses, Payments, Recurring bills, Shopping
list, Chores, Budgets, Members), each with what it covers. Everything is on until switched off (no
row means on). Saved per person and per household (`notification_preferences`), read back on every
visit. There are no security or account notifications to keep on: the app sends none.

## Security and privacy

- A person reads and marks only their **own** notifications, and only in households they're an
  **active member** of (RLS and the functions both check). Leaving hides that household's
  notifications; rejoining shows them again, as with the journal.
- Marking someone else's notification does nothing and says nothing about whether it exists.
- Settings can only be read and changed for yourself, in a household you're in.
- Nobody writes either table directly: the trigger writes notifications, and
  `set_notification_preferences` writes settings.
- A notification holds ids only (recipient, household, event); its words are worked out when read,
  under RLS, from the journal's projection.
- Logs record the reason a check failed, never names, amounts or ids.

## Database

| Object                                                                                        | What                                                                                                                                                       |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notifications`                                                                               | `user_id`, `household_id`, `activity_event_id`, `category` (the type), `created_at` (the event's time), `read_at`; unique (`user_id`, `activity_event_id`) |
| `notification_preferences`                                                                    | (`user_id`, `household_id`, `category`) → `enabled`                                                                                                        |
| `activity_events_notify` trigger                                                              | `private.notify_on_activity`, with `private.notification_recipients` (the table above)                                                                     |
| `my_notifications(unread_only?, before_us?, before_id?, page_size?, target_notification_id?)` | A page of the caller's own, with each event's projection, its record's state and the people it names (per household)                                       |
| `my_unread_notification_count()`                                                              | For the bell, through `GET /api/notifications/unread` (no caching)                                                                                         |
| `mark_notifications_read(ids?)`                                                               | The caller's own, given or all; returns how many changed                                                                                                   |
| `set_notification_preferences(household, muted)`                                              | Everything not muted is on                                                                                                                                 |

Notifications and settings go with the household when it's deleted (D14), and with the person's
account. Indexes: the caller's notifications by time, and unread ones.

## Known limits

- No email, push or real-time delivery (see Channels).
- Retention is undecided (O2): nothing deletes notifications except deleting the household or the
  account.
- No "mark as unread", and no grouping of several events into one notification.
- The bell's count can be up to a minute behind while a page sits open; opening the notification
  centre always shows the current list.
- Needs attention reads each household's bills, chores and budgets when it's shown; with many
  households that's several reads.

## Tests

| File                                                                                  | Covers                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/lib/notifications/payload.test.ts](../src/lib/notifications/payload.test.ts)     | Strict parsing (a note fails), types against events, unread only, order, cursor, people per household, the words and links                                                                         |
| [src/lib/notifications/query.test.ts](../src/lib/notifications/query.test.ts)         | The URL, the database arguments, which types a form switches off                                                                                                                                   |
| [src/lib/notifications/reminders.test.ts](../src/lib/notifications/reminders.test.ts) | What needs attention: overdue and due today, yours or nobody's, budgets near and over, the order and the words                                                                                     |
| [supabase/tests/notifications.test.ts](../supabase/tests/notifications.test.ts)       | Against the local stack: every recipient rule; the switches; a failed or repeated operation; reading, paging and marking only your own; leaving; privacy; no direct writes; deleting the household |
| [e2e/notifications.spec.ts](../e2e/notifications.spec.ts)                             | In a browser: the bell's count, opening, marking, the unread filter, Needs attention, the settings, the keyboard path, reduced motion, 320–1366px                                                  |
