# Household journal

The shared record of what happened in a household: who added, edited or deleted an expense, who
recorded or voided a payment, who joined, left, was removed, became the owner, or created or revoked
an invite link. Built in roadmap Phase 13 on the events written since Phase 6. Decisions: D6, D9,
D11, D13 and D26 (proposed) in [decisions.md](decisions.md). Code: [src/lib/journal/](../src/lib/journal/),
the page in [src/app/(app)/households/[householdId]/journal/](<../src/app/(app)/households/[householdId]/journal/>),
the read function in
[supabase/migrations/20261116120000_household_journal.sql](../supabase/migrations/20261116120000_household_journal.sql).

The journal is a history, not a source of figures. Balances, totals and splits are always worked
out from the expenses, splits and settlements themselves ([money.md](money.md)); nothing reads an
amount from the journal to calculate anything, and writing or reading the journal changes no money.

## What it shows

| Filter      | Event                                                | Entry (as Pat sees it)                                                                            | Links to                             |
| ----------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Household   | `household_created`                                  | Olive created the household “Flat 4B”                                                             | —                                    |
|             | `member_joined`                                      | Raj joined the household · Invited by Olive                                                       | Members (`/households/[id]#members`) |
|             | `member_left`                                        | Quin left the household                                                                           | Members                              |
|             | `member_removed`                                     | Olive removed Quin from the household                                                             | Members                              |
|             | `ownership_transferred`                              | Olive made you the owner                                                                          | Members                              |
|             | `invitation_created`                                 | Olive created an invite link                                                                      | Invite links (`#invite-links`)       |
|             | `invitation_revoked`                                 | Olive revoked an invite link · Created by Raj                                                     | Invite links                         |
| Expenses    | `expense_created`                                    | Olive added an expense · Groceries — ₹1,250.00                                                    | The expense                          |
|             | `expense_updated`                                    | Olive edited an expense, and what changed (D6)                                                    | The expense                          |
|             | `expense_deleted`                                    | Olive deleted an expense                                                                          | The expense ("View deleted expense") |
|             | `expense_restored`                                   | Olive restored an expense                                                                         | The expense                          |
| Settlements | `settlement_recorded`                                | You recorded a payment of ₹500.00 to Olive (D9)                                                   | The payment                          |
|             | `settlement_voided`                                  | Olive voided a payment · It no longer counts                                                      | The payment ("View voided payment")  |
| Bills       | `bill_*` (seven types)                               | See [bills.md](bills.md#the-journal)                                                              | The bill                             |
| Shopping    | `shopping_item_added`                                | Olive added an item to the shopping list · Milk (2) · For you to get                              | The shopping list (not once removed) |
|             | `shopping_item_updated`                              | Olive changed an item on the shopping list, and what changed                                      | The shopping list                    |
|             | `shopping_item_purchased`                            | You bought an item on the shopping list · Not recorded as an expense                              | The shopping list                    |
|             | `shopping_item_reopened`, `shopping_item_removed`    | Olive put an item back on / removed an item from the shopping list                                | The shopping list (not once removed) |
| Chores      | `chore_created`                                      | Olive added a chore · Bins · Assigned to you · Due 14 Nov 2026 · High priority                    | Chores                               |
|             | `chore_updated`                                      | Olive changed a chore, and what changed (title, assignee, due date, priority; "Details: changed") | Chores                               |
|             | `chore_completed`, `chore_reopened`, `chore_removed` | Pat completed / reopened / removed a chore                                                        | Chores (not once removed)            |

- **Edits (D6)** list each field that changed, old → new: description, amount, category, date,
  payer, split method, and who was added to or removed from the split. "Shares: changed" appears only
  when nothing else explains a change of shares. The shares themselves aren't repeated.
- **Payments (D9)** use D9's wording ("recorded", never "sent", "transferred" or "completed"). A
  settlement counts as soon as it's recorded and can only be voided: there are no pending, completed
  or cancelled payments (O10 is still open). Any page showing payments carries D9's notice,
  "Recorded in the app — no money is moved."
- **People** are named as everywhere else: "You" for the reader, "(left)" for someone who has left
  (D13), except in the sentence that says they left. A name the page doesn't know is shown as
  "Former member", and a change made outside a user session (no actor) as "Someone".
- **Invite links revoked automatically** when their creator leaves or is removed are part of that
  leave or removal, not entries of their own (they're still stored; see below).

## The events (`activity_events`, since Phase 6)

| Column                | Meaning                                                                                |
| --------------------- | -------------------------------------------------------------------------------------- |
| `id`                  | uuid; the tie-breaker in the journal's order                                           |
| `household_id`        | The household (cascade: deleting a household deletes its journal, D14)                 |
| `actor_id`            | Who did it, from `auth.uid()`; null only for a change outside a user session           |
| `type`, `entity_type` | Enums `activity_event_type` and `activity_entity_type`                                 |
| `entity_id`           | The household, membership, invitation, expense or settlement                           |
| `summary`             | A JSON object with what the event needs: ids and minimal context, no emails or tokens  |
| `created_at`          | `timestamptz`: the transaction's time (`now()`), so events of one transaction share it |

What each type stores in `summary` (written by the functions in Phases 6, 8 and 10): the household's
name, currency and timezone at creation; the member's id (and the invitation they used); both ids of
an ownership transfer; an invitation's expiry and use limit, or its creator when revoked; an
expense's full snapshot before and/or after (description, amount, category, date, payer, method and
every split); a settlement's full snapshot (people, amount, date, note, recorder).

### How events are written, and why they're consistent

- **One transaction.** Every write goes through a `SECURITY DEFINER` function (ADR-006) that changes
  the records and then calls `private.record_activity` before returning; invite links are journalled
  by the `invitations_log_activity` trigger on the same insert or update. A Postgres function call is
  one statement, so the change and its event commit together or not at all. A refused operation
  (any `HJ…` or `42501` error) raises before anything is written, and if writing the event failed,
  the whole operation would fail with it. Both are tested
  ([supabase/tests/journal.test.ts](../supabase/tests/journal.test.ts) makes the event insert fail
  inside a transaction and checks that no expense or settlement was saved).
- **No duplicates.** A repeated form submission or request retry returns the first result before
  writing anything: `create_household`, `create_expense` and `record_settlement` take a request key
  (unique per creator, also under concurrent requests). Repeated transitions are refused: deleting a
  deleted expense (`HJ011`), voiding a voided settlement (`HJ015`, under a row lock, so two voids at
  once give one event). An edit that changes nothing writes no event, and accepting an invite as an
  existing member writes nothing.
- **Never edited.** The `activity_events_append_only` trigger refuses every update and delete, for
  every role including the service role; the only exception is the cascade when a household is
  deleted (D14). When a record changes, a new event is written; old ones stay as they were.
- **Retention** is undecided (O2, open): nothing deletes events except deleting the household. When
  an account is deleted (D14, Phase 18), its profile becomes "Former member" and the events stay.

## Reading it: `public.household_journal`

`household_journal(target_household_id, category_filter?, before_us?, before_id?, page_size?)` is
`security invoker` and `stable`: RLS applies on top of an explicit active-membership check (`42501`
otherwise, including for a household id that doesn't exist), and everything in one answer is one
snapshot. It returns a read model, never raw events:

- **An allowlist of types.** Only the 30 types above (the seven bill types since roadmap Phase 14, the five shopping and five chore types since roadmap Phase 15). A type added in a later phase stays out of the
  journal until it's added to this function and to `ENTRY_CATEGORIES` in
  [payload.ts](../src/lib/journal/payload.ts) (the TypeScript check fails until it is).
- **Only the fields each entry needs:** names of things, amounts as text, dates, and people's ids. No
  settlement notes, split shares or percentages, invite-link expiry or use limits, invitation ids,
  emails or tokens, and no raw `summary`.
- **People:** the display name of everyone the page mentions, and whether they're still an active
  member.
- **Records:** for an expense, payment, bill, item or chore entry, whether that record is still in
  this household and its state now: deleted or voided; paused or ended; bought or removed; done or
  removed.
- **Shopping and chores (roadmap Phase 15):** an item's name, quantity and assignee, a chore's title,
  assignee, due date and priority. Item notes and chore descriptions stay out; an edit says only
  that one changed.

The app parses the answer with strict shapes (an unexpected field, such as a note, fails the parse)
and checks it before showing anything ([payload.ts](../src/lib/journal/payload.ts),
`checkJournal`): every entry is this household's, appears once, fits the filter and the cursor, is in
order, and links only to a record of the right kind. Otherwise the page shows an error and no
entries.

### Order and pages

- **Newest first, by `(created_at, id)`.** Events of one transaction share a timestamp; the id breaks
  the tie, so every entry has exactly one position.
- **Keyset pages** of 25. The cursor is the last entry shown: its time in microseconds since the
  epoch and its id, in the URL as `?before=1763029800123456.<id>`. The next page is everything
  strictly older. A page never repeats or skips an entry, and entries written while someone pages
  through appear at the top, never in the older pages. The function fetches one extra row to know
  whether there are older entries; it never reads the whole history.
- **Filters** (`?show=expenses|settlements|bills|shopping|chores|household`) apply in SQL. Changing the filter goes back to
  the newest entries.
- **Refused input** (`22023`): an unknown filter, a page size outside 1–100, half a cursor, or a cursor
  time outside 0 to 9999-12-31. The app validates the URL first ([query.ts](../src/lib/journal/query.ts))
  and shows an error for a link it can't use, without querying.

## Who can see what

- **Active members of the household, and nobody else**, through RLS on `activity_events` and the
  function's own check. Members see the whole journal, including what happened before they joined,
  the same as every other household record (expenses, settlements and members are all visible to
  every active member). Owner and member see the same journal (D3).
- **Former members see nothing**: leaving or removal ends access straight away. Someone who rejoins
  sees the whole history again, including their own removal.
- **A journal entry grants nothing.** Its link opens the record's own page, which checks access again
  (a 404 for anything outside the household). An event that names a record not in this household
  gets no link, and nothing about that record is returned (tested with a forged event).
- **No ids in the words.** Ids appear only in link targets and the cursor, never in text.

## The page

`/households/[householdId]/journal`, reached from the Household page ("View journal"). The
Household tab stays active on it: the bottom bar has room for five tabs at 360px, as with
settlements under Balances.

- **Header:** "Household journal" and the household's name in the description.
- **Filters:** All activity, Expenses, Settlements, Bills, Shopping, Chores, Household. They're links, so each view has its
  own URL; the current one has `aria-current`, a check icon and a heavier weight.
- **Days**, in the household's timezone (D11): Today, Yesterday, Earlier this week (from the week's
  first day, D25's `WEEK_STARTS_ON`, the same as the expense history's "This week"), then one heading
  per day ("Friday, 6 November 2026"). Each day is a section with an `h2` and an ordered list.
- **Entries:** an icon on a tinted circle (decorative, hidden from screen readers), the sentence, what
  it was about, what changed, then the time (`<time datetime>`), the kind in words (Expense, Payment,
  Household) and a link. Colour is never the only signal.
- **States:** a skeleton while loading; "Nothing in the journal yet" or "No … activity yet" with
  "Show all activity"; "Nothing older" past the end; an error with "Try again" (reloads from the
  server) if the answer fails its checks; the app's error page if loading fails.
- **Older activity:** "Show older activity" at the bottom; on an older page, "Back to the latest" at
  the top and bottom. At the end: "That's the start of the journal."

## Performance

Measured on 2026-11-13 on local data (a household with 20,000 events next to one with 50,000, in a
transaction that was rolled back): a first page in 7–28 ms, a filtered page in about 10–30 ms, and a
page deep in the history in 4–14 ms. The scan uses the Phase 6 index on
`(household_id, created_at desc)` with an incremental sort for the id; no index was added.

**Known limit:** a filter whose entries are rare in a very large household is slow (about 0.5 s with
no matching entries among 20,000), because the RLS check runs on every event scanned. Postgres
applies RLS before any condition that isn't leakproof, and enum equality (`enum_eq`) isn't, so the
type can't be used to narrow the scan, and an index on the type doesn't help (tried and measured).
Typical households have a few hundred events, which takes a few milliseconds. The fix is the
set-based membership policy noted in [database.md](database.md#expense-history-roadmap-phase-12) for
Phase 18; it changes a security policy, so it needs the owner's approval.

## Not built, and limits

- No total count of entries: counting would scan the whole journal (with the same RLS cost) on every
  page.
- No live updates: the page shows the journal as of loading it.
- Comments, reactions, notifications, exports and summaries aren't part of the journal (Phase 17 adds
  in-app notifications, which will read these events, D12).
- Budgets write no events yet (recurring bills do since roadmap Phase 14, the shopping list and
  chores since roadmap Phase 15); each phase adds its own types (and adds them to the allowlist on
  purpose).
- Renaming a household isn't journalled; the app has no way to rename one.
- Folding automatic invite revocations into a leave or removal relies on the two events sharing their
  transaction's timestamp, which holds for every revocation the functions make.

## Tests

| File                                                                    | Covers                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/lib/journal/query.test.ts](../src/lib/journal/query.test.ts)       | URL filters and cursors, canonical links, the function's arguments                                                                                                                                                                                                                                                                            |
| [src/lib/journal/payload.test.ts](../src/lib/journal/payload.test.ts)   | Parsing every type, refusing extra fields (a note) and impossible values, and every check: order and ties, duplicates, other households, filters, record states, page size, cursor                                                                                                                                                            |
| [src/lib/journal/describe.test.ts](../src/lib/journal/describe.test.ts) | The words for every type, "You", "(left)", unknown people, D6's changes, D9's wording, links, and that no text contains an id                                                                                                                                                                                                                 |
| [src/lib/journal/days.test.ts](../src/lib/journal/days.test.ts)         | Day headings in the household's timezone, the week's first day, Monday and month edges, times                                                                                                                                                                                                                                                 |
| [supabase/tests/journal.test.ts](../supabase/tests/journal.test.ts)     | Against the local stack: an entry for every operation, attributed; refused operations write none; retries, repeated transitions and concurrent calls write one; a failed event write stops the operation, and a rollback removes both; order against Postgres, ties, pages of every size, filters, cursors; access; privacy; no money changes |
| [e2e/journal.spec.ts](../e2e/journal.spec.ts)                           | In a browser, desktop and phone: the story with D6 and D9, filters by keyboard, links to the expense, payment and members, older pages without repeats, empty and invalid links, a non-member, 360px                                                                                                                                          |
