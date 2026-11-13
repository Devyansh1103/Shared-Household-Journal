# Database

Schema and access rules as built. The planned model for later phases is in
[requirements-notes.md](requirements-notes.md) §3–§4; this file describes only what exists.

- **Provider:** Supabase (Postgres 17, Auth, PostgREST), local in Docker (A3, A4).
- **Migrations:** [supabase/migrations/](../supabase/migrations/). Additive only.
- **Generated types:** [src/lib/supabase/database.types.ts](../src/lib/supabase/database.types.ts), from `npm run db:types`. Never edit by hand.
- **RLS tests:** [supabase/tests/](../supabase/tests/), run with `npm run test:db`.

## Local workflow

| Command             | Purpose                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `npm run db:start`  | Start local Supabase (needs Docker). A fresh database applies all migrations. |
| `npm run db:status` | Show local URLs. Also prints local keys, so don't paste its output anywhere.  |
| `npm run db:types`  | Regenerate `database.types.ts` from the local database.                       |
| `npm run test:db`   | RLS and constraint tests against the local stack.                             |
| `npm run db:stop`   | Stop the stack. Local data is kept for the next start.                        |

New migrations: `npx supabase migration new <name>`, then apply locally with
`npx supabase migration up`. Nothing in this repo links to or pushes to a hosted project (O1).

## Tables (Phase 4)

| Table               | Purpose                    | Key constraints                                                                                                                                                                                                                                                    |
| ------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profiles`          | One row per auth user      | `id` → `auth.users` (**restrict**, see D14 below). `display_name` 1–80 chars, trimmed. No email column.                                                                                                                                                            |
| `households`        | The authorization boundary | `currency_code` `^[A-Z]{3}$`, default `INR` (D1), and not a code without an ISO 4217 minor unit such as XDR (`households_currency_has_minor_unit`, Phase 9; see [money.md](money.md)). `timezone` must be in `pg_timezone_names` (D11). `created_by` → `profiles`. |
| `household_members` | Membership history         | `role` enum `owner`/`member` (D3). One active row per user per household; at most one active owner (partial unique indexes); an owner can't have `left_at`; at least one active owner while there are active members (deferred constraint trigger).                |
| `invitations`       | Invite links (D5)          | `token_hash` unique, lowercase hex SHA-256. Defaults: expires in 7 days, `max_uses` 10. `0 ≤ use_count ≤ max_uses`. `created_by` defaults to `auth.uid()`.                                                                                                         |

## Tables and columns (Phase 6)

| Table / column            | Purpose                                                                               | Key constraints                                                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `households.creation_key` | Makes `create_household` idempotent                                                   | Unique per (`created_by`, `creation_key`) when not null. The create form sends a fresh uuid per page visit, so a repeated submission returns the first household.                                                                                  |
| `activity_events`         | Append-only household journal (feed: [Phase 13](#household-journal-roadmap-phase-13)) | `type` enum `activity_event_type`, `entity_type` enum `activity_entity_type`, `summary` must be a JSON object (ids and minimal context only, no emails or tokens). `actor_id` is null only for changes made outside a user session (service role). |

Events written so far: `household_created`, `member_joined`, `member_left`, `member_removed`,
`ownership_transferred` (from the functions below) and `invitation_created`, `invitation_revoked`
(from the `invitations_log_activity` trigger); the `expense_*` events since Phase 8 and
`settlement_recorded`, `settlement_voided` since roadmap Phase 10. A `before update or delete` trigger rejects every
change, for every role, except the cascade from deleting the household itself.

## Functions (Phase 6)

All are `SECURITY DEFINER` with `search_path = ''`, executable by `authenticated` only (EXECUTE is
revoked from `anon` and `public`). Each takes the caller from `auth.uid()`, never from an argument.

| Function                                                              | Who                     | What                                                                                                                                                                     |
| --------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create_household(household_name, currency, time_zone, request_key?)` | Any signed-in user      | Inserts the household and the caller's `owner` membership in one transaction. A repeated `request_key` returns the existing household.                                   |
| `get_invite_preview(token)`                                           | Any signed-in user      | `valid` + household name + inviter's display name; `member` + household id if already in; otherwise `invalid` with nothing else.                                         |
| `accept_invite(token)`                                                | Any signed-in user      | Locks the invite row, checks revocation, expiry and use limit, inserts a `member` row, increments `use_count`. Already a member: returns the household, consumes no use. |
| `leave_household(household_id)`                                       | Active non-owner member | Sets `left_at`, revokes the leaver's still-active invites. The owner gets `HJ002`.                                                                                       |
| `remove_member(household_id, user_id)`                                | Owner                   | Sets the member's `left_at`, revokes their still-active invites.                                                                                                         |
| `transfer_ownership(household_id, user_id)`                           | Owner                   | Demotes the caller to `member`, promotes the target (an active member) to `owner`.                                                                                       |
| `delete_household(household_id)`                                      | Owner, only member left | Deletes the household (D14). Memberships, invitations and events cascade.                                                                                                |

Invite tokens: 32 random bytes as unpadded base64url (43 characters). The app stores
`sha256(raw bytes)` as hex; `private.invite_token_hash(token)` computes the same hash on redemption,
so the raw token never needs to reach the database and the stored hash can't be used to join.

Error codes (mapped to messages in `src/lib/households/errors.ts`): `HJ001` invite not valid,
`HJ002` owner must transfer first, `HJ003` target isn't an active member, `HJ004` other members
remain, `HJ005` can't target yourself, `42501` not signed in / not a member / not the owner.

Deletion behaviour:

- `households` → `household_members`, `invitations`, `activity_events`: **cascade** (D14: deleting a household is permanent).
- Everything → `profiles`, and `profiles` → `auth.users`: **restrict**. Deleting an auth user fails while
  their profile exists. The anonymising account-deletion flow is Phase 18 (D14).

Triggers:

- `on_auth_user_created` (on `auth.users`) creates the profile. The name comes from sign-up metadata
  `display_name`, falling back to "New member". It never uses the email.
- `*_set_updated_at` maintains `updated_at`.

## Expenses and splits (Phase 8)

Money is `bigint` minor units with the `_minor` suffix, in the household's currency (D1, D2,
ADR-003). There is no float anywhere: the app parses typed amounts as text into `BigInt`
([src/domain/money/amount.ts](../src/domain/money/amount.ts)), and the split engine
([src/domain/money/split.ts](../src/domain/money/split.ts), ADR-004) works in `BigInt` too.

| Table            | Purpose                  | Key constraints                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expenses`       | A shared cost            | `amount_minor` 1 – 999,999,999,999 (keeps every amount and sum inside JavaScript's safe-integer range). `description` 1–120 chars, trimmed. `category` enum (D17). `expense_date` is a `date` (D11). `split_method` enum `equal`/`percentage`/`custom`. `deleted_at` and `deleted_by` set together (D7). `creation_key` makes `create_expense` idempotent. |
| `expense_splits` | Each participant's share | Primary key (`expense_id`, `user_id`). `share_minor ≥ 0`. `percentage_bp` 0–10000, percentage splits only. Composite key (`expense_id`, `household_id`) → `expenses`, so a split can't point at another household's expense.                                                                                                                               |

Money invariants (ADR-004), checked by the functions straight away and again at commit by the
deferred constraint triggers `expenses_check_invariants` / `expense_splits_check_invariants`, for
every write path including the service role:

- at least one participant, and the shares add up exactly to `amount_minor`;
- percentage splits: every share has basis points, they total 10000, and each share is its exact
  percentage floored, or that plus one leftover unit;
- equal splits: shares differ by at most one unit; other methods carry no percentages.

Functions (all `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` for `authenticated` only; ADR-006
as amended). Each takes the caller from `auth.uid()` and writes an `activity_events` row with old
and new values (D6):

| Function                                                                                                                 | Who                          | What                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_expense(target_household_id, title, amount, expense_category, spent_on, payer_id, method, shares, request_key?)` | Active member                | Payer and every participant must be active members. `shares` is `[{user_id, share_minor, percentage_bp}]`. A repeated `request_key` returns the first expense.                                                                |
| `update_expense(target_expense_id, …same fields…, expected_updated_at?)`                                                 | Creator, payer or owner (D6) | Replaces every field and the whole split. Refuses deleted expenses, refuses with `HJ010` if `updated_at` changed since the form loaded, and (since Phase 9, D24) refuses with `HJ007` if the payer or a participant has left. |
| `delete_expense(target_expense_id)`                                                                                      | Creator, payer or owner (D6) | Soft delete (D7): sets `deleted_at`/`deleted_by`; the row and its splits stay readable.                                                                                                                                       |
| `restore_expense(target_expense_id)`                                                                                     | Owner (D7)                   | Clears the delete. Refused if the payer or a participant has since left.                                                                                                                                                      |

Other rules added in Phase 8:

- **Currency lock (D1):** `households_lock_currency` rejects a currency change (`HJ012`) once the
  household has any expense, deleted ones included.
- **Zero balance to leave or be removed (D13, O8):** `leave_household` and `remove_member` now
  refuse with `HJ006` while `private.member_net_minor` (paid minus shares, over non-deleted
  expenses) isn't zero. Since Phase 9 it uses the same definition as the balances people see
  (below).

Error codes: `HJ006` balance not zero, `HJ007` payer or participant not an active member, `HJ008`
invalid split, `HJ009` no such expense (also for other households' ids), `HJ010` changed since
loaded, `HJ011` deleted / not deleted, `HJ012` currency locked.

## Balances (roadmap Phase 9)

Migration `20261113120000_balances.sql`. Balances are worked out from the records on every read
and are never stored (FR-05, ADR-005). The rules and sign convention are in
[money.md](money.md#balances).

| Function                                                  | Kind                                               | What                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `household_balances(target_household_id, focus_user_id?)` | `security invoker`, `stable`; `authenticated` only | Raises `42501` unless the caller is an active member; RLS applies as well. Returns JSON: the counted expenses and their total, every person's paid / share / net, the pairs (who owes whom), and, with `focus_user_id`, the counted expenses behind that person's balance (newest 200, plus the full count). Money is text. |
| `private.balance_people(household_id)`                    | `security invoker`, `stable`                       | Per person, paid and shares over non-deleted expenses. Covers active members and anyone else in a counted expense (someone who has left). Sums are `numeric`. Since roadmap Phase 10 it's the expense half of `private.person_balances`, which adds settlements (below).                                                    |
| `private.assert_balances_reconcile(household_id)`         | `security invoker`, `stable`                       | Raises `HJ013` (DETAIL = expense id) if a counted expense has no participants or its shares don't add up to its amount.                                                                                                                                                                                                     |
| `private.member_net_minor(household_id, user_id)`         | Replaced; still `SECURITY DEFINER`                 | Now `assert_balances_reconcile`, then paid − shares from `balance_people`. Used by `leave_household` and `remove_member`.                                                                                                                                                                                                   |
| `update_expense(…)`                                       | Replaced; same signature and grants                | Also refuses (`HJ007`) an expense whose payer or a participant has left (D24). `delete_expense` is unchanged: deleting such an expense is allowed.                                                                                                                                                                          |

- **One snapshot.** `household_balances` is `stable`, so every part of the answer is read from the
  same snapshot and the parts agree. The app checks that they do (`checkBalances`, `checkEntries`).
- **Access.** The two private helpers are `EXECUTE` for `authenticated`, because the invoker
  function needs them. The `private` schema isn't exposed through the Data API, so they can't be
  called directly (PostgREST answers `PGRST106`).
- **Money as text.** Totals aren't capped like a single expense, and JSON numbers are doubles.
- **No new tables, no stored balances, no data changes.**

New error code: `HJ013` balances can't be calculated (a counted expense doesn't add up).

## Settlements (roadmap Phase 10)

Migration `20261114120000_settlements.sql` (D9, ADR-005, ADR-006, ADR-007). A settlement records
that one member paid another back **outside the app**. The app never moves money and never checks
that a payment happened.

| Table         | Purpose                                     | Key constraints                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settlements` | Who paid whom, how much, when, and its fate | `from_user` (paid), `to_user` (received), different people. `amount_minor` 1 – 999,999,999,999, like an expense. `settled_on` is a `date` (D11). `note` null or 1–200 chars, trimmed. `recorded_by` must be `from_user` or `to_user` (D9). `voided_at` and `voided_by` set together, never before `created_at`. `creation_key` makes `record_settlement` idempotent (unique per recorder). Every person column → `profiles` (restrict). |

- **Never edited, never deleted** (D9, ADR-007). The `settlements_protect` trigger refuses every
  update and delete, for every role including the service role. The only exceptions are voiding,
  once (`voided_at`/`voided_by` from null to set, nothing else changing), and the cascade from
  deleting the household itself (D14).
- **Indexes:** counted settlements by household and date, voided ones by `voided_at`, and each
  person column.
- **Currency lock (D1):** `households_lock_currency` now also refuses (`HJ012`) once the household
  has a settlement, voided ones included, even with no expenses.

Functions (`SECURITY DEFINER`, `search_path = ''`, `EXECUTE` for `authenticated` only). Each takes
the caller from `auth.uid()` and writes an `activity_events` row (`settlement_recorded` with
`after`, `settlement_voided` with `before`; entity type `settlement`):

| Function                                                                                                                   | Who                                | What                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `record_settlement(target_household_id, payer_id, recipient_id, amount, paid_on, memo?, request_key?, acknowledged_owed?)` | The payer or the recipient (D9)    | Both people must be different active members (`HJ016`; O9). Settlements in a household are recorded one at a time (`FOR NO KEY UPDATE` on the household row, which doesn't block expense or member inserts). A repeated `request_key` returns the first settlement. If `amount` is more than the payer owes the recipient right now, it refuses with `HJ017` (DETAIL: that figure) unless `acknowledged_owed` equals it. |
| `void_settlement(target_settlement_id)`                                                                                    | The payer, the recipient, or owner | Locks the row, refuses a second void (`HJ015`), sets `voided_at`/`voided_by`. The row stays readable. Other households' ids get `HJ014`, as if they didn't exist.                                                                                                                                                                                                                                                        |

Balances now include settlements (ADR-005: a settlement from A to B that isn't voided reduces what
A owes B; net = paid − shares + settlements paid − settlements received):

| Function                                | Kind                         | What                                                                                                                                                                                                                                                      |
| --------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `private.person_balances(household_id)` | `security invoker`, `stable` | **The one definition of a balance from this phase on.** `balance_people` (expenses) joined with `settlement_people` (settlements paid and received, not voided), and `net_minor`. Covers active members and anyone else in a counted record.              |
| `private.balance_pairs(household_id)`   | `security invoker`, `stable` | **The one definition of who owes whom.** Expense shares owed to the payer, plus each counted settlement as the recipient owing the payer its amount; the two directions offset within each pair.                                                          |
| `public.household_balances(…)`          | Replaced; same signature     | Uses both. Adds `settlement_count`, `settlement_total_minor`, each person's `settlements_paid_minor` / `settlements_received_minor` and counts, and, with `focus_user_id`, `settlement_entries` (newest 200) and `settlement_entry_count`. Money is text. |
| `private.member_net_minor(…)`           | Replaced; same signature     | Now from `person_balances`, so leaving or removal (D13, O8) needs a zero balance including settlements.                                                                                                                                                   |

Error codes: `HJ014` no such settlement, `HJ015` already voided, `HJ016` the payer and the recipient
must be two different active members, `HJ017` more than what's owed (DETAIL: the current figure,
signed minor units as text).

No stored balances and no data changes. Expenses and their splits are never touched by a
settlement (D8).

## Expense history (roadmap Phase 12)

Migration `20261115120000_expense_history.sql`: one read function, no tables, columns, indexes or
data changes.

`public.expense_history(target_household_id, search_text?, search_categories?, date_from?, date_to?, categories?, payers?, amount_min?, amount_max?, deleted_only?, sort_order?, page_size?, page_number?)`
is `security invoker` and `stable`, `EXECUTE` for `authenticated` only. It raises `42501` unless
the caller is an active member, and RLS applies as well. Everything in its answer comes from one
snapshot:

- **Rows:** one page of the household's counted expenses (D7), or only the deleted ones, filtered
  by every argument given (all of them together):
  - the search text anywhere in the description, ignoring case, or a category the app matched
    from D17's labels. Plain string functions on a parameter (`strpos(lower(…), lower(…))`), so
    `%`, `_` or anything else typed is never a wildcard or SQL;
  - inclusive calendar dates, categories, payers, and an inclusive minimum and maximum in minor
    units.
- **Order:** deterministic, with the id as the last tie-breaker, so each row has one position and
  pages never overlap or skip (while the data stays the same):

  | `sort_order` | Order                           |
  | ------------ | ------------------------------- |
  | `newest`     | date ↓, added ↓, id ↓ (default) |
  | `oldest`     | date ↑, added ↑, id ↑           |
  | `highest`    | amount ↓, then as `newest`      |
  | `lowest`     | amount ↑, then as `newest`      |
  | `recent`     | added ↓, then as `newest`       |

- **Pages:** offset pages of `page_size` (the app uses 25). A page past the end is answered with the
  last page, so a stale link or a narrower filter never shows an empty page by mistake.
- **Summary of what matches:** count, total, average (rounded to the nearest minor unit, halves away
  from zero) and the largest expense. **Household figures, whatever the filters:** counted
  expenses and their total, and how many are deleted.
- **Money as text**, ids, dates, and each row's `created_us` (microseconds since the epoch, so the
  app can check the order exactly).

Refused with `22023`: an unknown sort, a page size outside 1–100, a page below 1, a search over 120
characters, or a range whose start is after its end. Bad categories or ids fail as casts (`22P02`).
The app validates all of this first ([src/lib/expenses/history.ts](../src/lib/expenses/history.ts))
and checks the answer before showing it
([history-payload.ts](../src/lib/expenses/history-payload.ts)): every row is this household's, once,
matches the filters and is in the promised order; the page arithmetic holds; and the summary adds up
(exactly equal to the household's figures when nothing filters).

**Indexes.** None added. The household's rows are read once, through the Phase 8 partial indexes on
`(household_id, expense_date, created_at) where deleted_at is null` and
`(household_id, deleted_at) where deleted_at is not null`: each branch of the read repeats its
index's predicate, so generic and custom plans both use them (checked with `EXPLAIN ANALYZE` on a
household of 5,000 expenses next to one of 20,000: no sequential scans). The payer's name is one
primary-key lookup per row on the page.

**Performance, measured 2026-11-13** on committed, vacuumed local data: about 70–90 ms per call for a
household with 5,000 expenses, and about 13 ms for the same call with RLS bypassed. Most of the time
is the RLS policy on `expenses` (`private.is_household_member(household_id)`), checked once per row.
Typical households, with a few hundred expenses, take a few milliseconds. If households ever grow
much larger, an equivalent set-based policy would remove that cost; that changes a security policy,
so it needs the owner's approval (Phase 18 hardening).

Tests: [history.test.ts](../src/lib/expenses/history.test.ts) and
[history-payload.test.ts](../src/lib/expenses/history-payload.test.ts) (the URL rules, dates,
amounts, URLs, chips and every check),
[supabase/tests/expense-history.test.ts](../supabase/tests/expense-history.test.ts) (search, each
filter, each sort against plain Postgres ordering, pages, the summary against an independent tally,
access, refused input, and that reading history changes nothing), and
[e2e/expense-history.spec.ts](../e2e/expense-history.spec.ts) (in a browser, desktop and phone).

## Household journal (roadmap Phase 13)

Migration `20261116120000_household_journal.sql`: one read function and three pure helpers. No
tables, columns, indexes, policies or data changes. The events themselves have been written since
Phase 6, in the same transaction as each change; see [journal.md](journal.md) for what's shown, the
consistency guarantees and the visibility rules.

`public.household_journal(target_household_id, category_filter?, before_us?, before_id?, page_size?)`
is `security invoker` and `stable`, `EXECUTE` for `authenticated` only. It raises `42501` unless the
caller is an active member, and RLS applies as well. One answer, one snapshot:

- **Rows:** one page (default 25, at most 100) of the household's events, newest first by
  `(created_at, id)`, strictly older than the cursor (`before_us`, microseconds since the epoch, and
  `before_id`), optionally only `expenses`, `settlements` or `household` events. Only an allowlist of
  the existing types (13 in Phase 13, 20 with the bill events of Phase 14); invite links revoked in the same transaction as their creator leaving or
  being removed are left out (they stay stored).
- **Each row:** its id, household, type, actor, `created_us` (exact, as text) and only the fields its
  entry shows, from the stored summary: no settlement notes, split shares, invite settings or raw
  summary. For expense and payment events, whether the record is still in this household (`entity`:
  `{ available, id, state }`, `state` being `active`, `deleted` or `voided`).
- **`has_more`:** whether older rows exist (one extra row is read to know).
- **`people`:** display name and active status of everyone the rows mention.

Helpers `private.journal_expense`, `journal_expense_change` and `journal_settlement` pick the fields
from a stored snapshot. They're `immutable`, read no table, and are `EXECUTE` for `authenticated`
because the invoker function calls them; the `private` schema isn't exposed through the Data API.

Refused with `22023`: an unknown category, a page size outside 1–100, half a cursor, or a cursor time
outside 0 to 9999-12-31. The app validates all of this first ([query.ts](../src/lib/journal/query.ts))
and checks the answer before showing it ([payload.ts](../src/lib/journal/payload.ts)).

**Indexes.** None added. Pages scan the Phase 6 index on `(household_id, created_at desc)` and sort
ties by id incrementally. Measured 2026-11-13 with 20,000 events in one household next to 50,000 in
another: 7–28 ms for a first page, 10–30 ms filtered, 4–14 ms deep in the history. A filter with few
or no matching events in such a household takes about 0.5 s: the RLS check runs on each event scanned,
and since `enum_eq` isn't leakproof, Postgres can't narrow the scan by type under RLS, so an index on
the type doesn't help (tried). The set-based policy noted for Phase 18 above would fix both; it needs
the owner's approval.

Tests: [supabase/tests/journal.test.ts](../supabase/tests/journal.test.ts) (an entry for every
operation; none for refused ones; one for retries, repeated transitions and concurrent calls; a failed
event write stops the operation and a rollback removes both; order against Postgres, ties, pages of
every size, filters, cursors; access; privacy; no money changes) and the unit tests in
[src/lib/journal/](../src/lib/journal/).

## Recurring bills (roadmap Phase 14)

Migrations `20261117120000_recurring_bill_types.sql` (the `bill_frequency` enum and the journal's
new event types, in a file of their own because a new enum value can't be used in the transaction
that adds it) and `20261117120100_recurring_bills.sql`. What bills are and the rules: [bills.md](bills.md).

| Table / column                                    | Purpose                               | Key constraints                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recurring_bills`                                 | A bill's definition (a reminder, D10) | `description` 1–120 chars and `notes` 1–500, trimmed; `amount_minor` 1 – 999,999,999,999 (expected); `frequency` `week`/`month`/`year`, `interval_count` 1–52; `anchor_on` (the schedule's first due date) and `next_index` (periods before it are stored); `ends_on`; `paused_at`/`paused_by` together; `creation_key` unique per creator. |
| `recurring_bill_shares`                           | Its default split                     | Primary key (`bill_id`, `user_id`); composite key to the bill with the household; `percentage_bp` 0–10000 for percentage splits, `share_minor ≥ 0` for custom ones, neither for equal ones. Percentages total 10000 and custom amounts the expected amount (checked by the functions).                                                      |
| `bill_occurrences`                                | A stored period                       | `unique (bill_id, due_on)`; composite key to the bill with the household; `expected_amount_minor` as it was when stored; `skipped_at`/`skipped_by` together. `bill_occurrences_protect` refuses every other change and every delete, for every role, except the cascade from deleting the household (D14).                                  |
| `expenses.recurring_bill_id`, `recurrence_period` | The period an expense records (D10)   | Both or neither; foreign key `(recurring_bill_id, recurrence_period, household_id)` → the stored period, so only a real period of a bill in the same household; unique `(recurring_bill_id, recurrence_period)` for expenses that aren't deleted (D7). Set only by `record_bill_payment`.                                                   |

**No scheduler.** The reads work out each bill's periods from its schedule every time (in the
household's timezone, D11): the ones that have come and aren't stored are open, the next one after
today is upcoming. Periods are stored only inside the action that needs them (record, skip, and
before a pause, an end or a change, every period that has come), under the bill's row lock.

Functions (`SECURITY DEFINER`, `search_path = ''`, `EXECUTE` for `authenticated` only; the caller
from `auth.uid()`; each change journalled):

| Function                                                                                                                                                                              | Who (D27, proposed)                   | What                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_recurring_bill(target_household_id, title, amount, bill_category, bill_payer_id, method, shares, repeat_unit, repeat_every, first_due_on, last_due_on?, memo?, request_key?)` | Any active member                     | First due date within the past year and the next ten; payer and split people active members (`HJ007`); a valid split (`HJ008`). A repeated `request_key` returns the first bill. |
| `update_recurring_bill(target_bill_id, title, amount, bill_category, bill_payer_id, method, shares, last_due_on?, memo?, expected_updated_at?)`                                       | Who added it, who usually pays, owner | Stores the periods that have come first. Not the schedule. `HJ020` if changed since loaded; `HJ019` for an end before a stored period.                                           |
| `reschedule_recurring_bill(target_bill_id, repeat_unit, repeat_every, next_due_on, expected_updated_at?)`                                                                             | Same                                  | A new schedule from `next_due_on`: today or later, after every stored period, not after the end date (`HJ019`).                                                                  |
| `pause_recurring_bill`, `resume_recurring_bill`, `end_recurring_bill(target_bill_id)`                                                                                                 | Same                                  | `HJ021` for a bill already paused or ended / not paused / already ended. Resume moves the cursor to the first period from today.                                                 |
| `skip_bill_occurrence`, `unskip_bill_occurrence(target_bill_id, occurrence_due_on)`                                                                                                   | Same                                  | A period that has come or the next one (`HJ024` otherwise); not recorded (`HJ022`); `HJ023` for the wrong skip state.                                                            |
| `record_bill_payment(target_bill_id, occurrence_due_on, title, amount, expense_category, spent_on, payer_id, method, shares, request_key?)`                                           | Any active member                     | Stores the period, calls `create_expense`, links the expense, in one transaction. `HJ022` already recorded, `HJ023` skipped, `HJ024` not a period that can be recorded.          |
| `restore_expense(target_expense_id)`                                                                                                                                                  | Replaced; same signature and grants   | Also `HJ025` when the expense's period was recorded again or skipped since it was deleted.                                                                                       |

Reads (`security invoker`, `stable`, one snapshot; money as text): `household_bills(target_household_id)`
(`42501` for non-members) returns today, the bills with their next due date, the open periods, and
the periods paid in the last 30 days; `recurring_bill(target_bill_id)` (`HJ018` for a bill the caller
can't see) returns one bill, its default split and its periods newest first (the next one, the open
ones, and the newest 200 stored). The app checks both before showing them
([payload.ts](../src/lib/bills/payload.ts)). `household_journal` is replaced, same signature and
grants, with the bill events under a `bills` filter.

Error codes: `HJ018` no such bill, `HJ019` the schedule isn't valid, `HJ020` changed since loaded,
`HJ021` paused/ended state, `HJ022` period already recorded, `HJ023` skip state, `HJ024` not a
period that can be recorded or skipped, `HJ025` can't restore over a period recorded again or
skipped.

**Indexes:** bills by household, payer, creator and pauser; periods by `(household_id, due_on)` and
skipper; the unique `(bill_id, due_on)`; expenses by `(recurring_bill_id, recurrence_period)` (the
unique one for counted expenses, and one for all). A household has a handful of bills, so a read is a
few small scans plus the date arithmetic.

Tests: [supabase/tests/bills.test.ts](../supabase/tests/bills.test.ts) and the unit tests in
[src/lib/bills/](../src/lib/bills/).

## Shopping list and chores (roadmap Phase 15)

Migrations `20261118120000_shopping_chore_types.sql` (the `chore_priority` enum and the journal's
ten new event types and two entity types, in a file of their own) and
`20261118120100_shopping_and_chores.sql`. What they are and the rules:
[shopping-chores.md](shopping-chores.md).

| Table            | Purpose                         | Key constraints                                                                                                                                                                                                                                                         |
| ---------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shopping_items` | The household's one shared list | `name` 1–120 chars, `quantity` 1–40 and `note` 1–300, all trimmed; `assignee_id`, `added_by`; `purchased_at`/`purchased_by` together; `removed_at`/`removed_by` together; `creation_key` unique per creator. Partial indexes for what's still needed and what's bought. |
| `chores`         | One-off chores (no recurrence)  | `title` 1–120 and `description` 1–1000, trimmed; `assignee_id`; `due_on` a `date` (D11) in 2000–2099; `priority` `low`/`medium`/`high` (default `medium`); `created_by`; `completed_at`/`completed_by` together; `removed_at`/`removed_by` together; `creation_key`.    |

Every person column references `profiles` (`on delete restrict`, as everywhere); the household
cascades (D14). Nothing is ever deleted otherwise: removal sets `removed_at`.

Functions (`SECURITY DEFINER`, `search_path = ''`, `EXECUTE` for `authenticated` only; the caller
from `auth.uid()`; each change journalled in the same transaction):

| Function                                                                                                                                         | Who (D28, proposed)                                                         | What                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_shopping_item(target_household_id, item_name, item_quantity?, item_note?, item_assignee_id?, request_key?)`                                 | Any active member                                                           | A repeated `request_key` returns the first item (also concurrently). The assignee is an active member or nobody (`HJ030`).                         |
| `update_shopping_item(target_item_id, item_name, item_quantity?, item_note?, item_assignee_id?, expected_updated_at?)`                           | Any active member                                                           | Replaces all four fields. `HJ029` if changed since loaded; a former member may stay assigned but not be chosen again. No event if nothing changed. |
| `purchase_shopping_item`, `reopen_shopping_item`, `remove_shopping_item(target_item_id)`                                                         | Any active member                                                           | Under a row lock; already that way: nothing happens, no event. `HJ028` for a removed item (except removing it again).                              |
| `create_chore(target_household_id, chore_title, chore_description?, chore_assignee_id?, chore_due_on?, chore_priority_level?, request_key?)`     | Any active member                                                           | As for items.                                                                                                                                      |
| `update_chore(target_chore_id, chore_title, chore_description?, chore_assignee_id?, chore_due_on?, chore_priority_level?, expected_updated_at?)` | Who added it, its assignee, the owner (`42501` otherwise)                   | Also how it's reassigned. `HJ029`, `HJ030`, `HJ028` as for items.                                                                                  |
| `complete_chore`, `reopen_chore(target_chore_id)`                                                                                                | The same, or anyone when it's assigned to nobody or to someone who has left | Already that way: nothing happens, no event.                                                                                                       |
| `remove_chore(target_chore_id)`                                                                                                                  | Who added it, its assignee, the owner                                       | Already removed: nothing happens.                                                                                                                  |

Ids of items or chores in another household get the same answer as ids that don't exist (`HJ026`,
`HJ027`). Reads are plain selects under RLS (members of the household only); the app reads every
item still needed (up to 500), the latest 100 bought, every open chore (up to 500) and the latest 50
done. `household_journal` is replaced, same signature and grants, with `shopping` and `chores`
filters and each item's (active, purchased, removed) or chore's (active, completed, removed) state.

Error codes: `HJ026` no such item, `HJ027` no such chore, `HJ028` removed, `HJ029` changed since
loaded, `HJ030` the assignee isn't an active member.

Tests: [supabase/tests/shopping-chores.test.ts](../supabase/tests/shopping-chores.test.ts) and the
unit tests in [src/lib/shopping/](../src/lib/shopping/) and [src/lib/chores/](../src/lib/chores/).

## Budgets and analytics (roadmap Phase 16)

Migrations `20261119120000_budget_types.sql` (the `budget_period` enum, three journal event types
and the `budget` entity type) and `20261119120100_budgets_and_analytics.sql`: tables `budgets` and
`budget_limits`, the write functions `create_budget`, `update_budget` and `archive_budget` (any
active member, O3; journalled), and the reads `household_budgets` and `household_analytics`
(`security invoker`, one snapshot, every sum in Postgres). `household_journal` is replaced again,
same signature and grants, with a `budgets` filter. Error codes: `HJ031` no such budget, `HJ032`
already a budget for that category and period; `HJ028` and `HJ029` reused. The rules, the tables,
the functions and rolling back: [budgets.md](budgets.md#database). Tests:
[supabase/tests/budgets.test.ts](../supabase/tests/budgets.test.ts).

## Notifications (roadmap Phase 17)

Migration `20261120120000_notifications.sql`: the `notification_category` type (the journal's
categories), tables `notifications` and `notification_preferences`, the `activity_events_notify`
trigger, which writes an event's notifications in its transaction to the people D30 names, and
the functions `my_notifications`, `my_unread_notification_count`, `mark_notifications_read` and
`set_notification_preferences`. The journal's projection moved into shared helpers
(`private.journal_detail`, `journal_mentions`, `journal_entity`, `journal_category`), and
`household_journal` was replaced, same signature, grants and output, built on them (its output
for every event type and page was compared byte for byte before and after). The rules:
[notifications.md](notifications.md#database). Tests:
[supabase/tests/notifications.test.ts](../supabase/tests/notifications.test.ts).

## Access control

RLS is enabled on every table, with deny by default. Policies apply to `authenticated` only. `anon` has
no table privileges at all. `service_role` bypasses RLS and is for tests and future server-only
admin tasks; it is never sent to the browser.

Helpers live in the `private` schema, which the Data API does not expose. All are `SECURITY DEFINER`,
`stable`, with `search_path = ''`, and they look only at the caller's own membership:

- `private.is_household_member(household_id)`: caller has an active membership.
- `private.household_role(household_id)`: caller's active role, or null.
- `private.shares_household_with(user_id)`: the user has (or had) a membership in a household where
  the caller is active. Used by `profiles`.

| Table                                      | Select                                                       | Insert                                                                      | Update                                                                  | Delete |
| ------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| `profiles`                                 | Self, and anyone who shares (or shared) a household with you | Trigger only                                                                | Self; `display_name`, `avatar_url` only                                 | No     |
| `households`                               | Active members                                               | No (`create_household`)                                                     | Owner; `name`, `currency_code`, `timezone` only                         | No     |
| `household_members`                        | Active members of that household (all rows, incl. left)      | No (functions only)                                                         | No                                                                      | No     |
| `activity_events`                          | Active members                                               | No (functions and triggers only)                                            | No                                                                      | No     |
| `invitations`                              | Active members                                               | Active members; `household_id`, `token_hash`, `expires_at`, `max_uses` only | Set `revoked_at` on an unrevoked invite: its creator, or the owner (D4) | No     |
| `expenses`                                 | Active members (deleted ones too, D7)                        | No (`create_expense`)                                                       | No (`update_expense`, `delete_expense`, `restore_expense`)              | No     |
| `expense_splits`                           | Active members                                               | No (functions only)                                                         | No                                                                      | No     |
| `settlements`                              | Active members (voided ones too, D9)                         | No (`record_settlement`)                                                    | No (`void_settlement`; the trigger refuses anything else)               | No     |
| `recurring_bills`, `recurring_bill_shares` | Active members                                               | No (`create_recurring_bill`)                                                | No (the bill functions)                                                 | No     |
| `bill_occurrences`                         | Active members                                               | No (the bill functions)                                                     | No (skip and un-skip only; the trigger refuses anything else)           | No     |
| `shopping_items`, `chores`                 | Active members (removed ones too)                            | No (`add_shopping_item`, `create_chore`)                                    | No (the shopping and chore functions)                                   | No     |
| `budgets`, `budget_limits`                 | Active members (removed budgets too)                         | No (`create_budget`)                                                        | No (`update_budget`, `archive_budget`)                                  | No     |
| `notifications`                            | Their recipient, while an active member of the household     | No (the `activity_events` trigger)                                          | No (`mark_notifications_read`)                                          | No     |
| `notification_preferences`                 | Their owner, while an active member of the household         | No (`set_notification_preferences`)                                         | No (`set_notification_preferences`)                                     | No     |

"No" means there is no policy **and** no table privilege, so the request fails with `42501`.
Column-level grants stop an allowed row update from also changing ids, creators or counters.

Members who leave or are removed lose access immediately, because every check requires `left_at is null`.

## Not built yet

- Invitation caps (O6, still Open): the DB enforces `max_uses > 0` and expiry after creation, but no
  upper bound. The app always uses the defaults (7 days, 10 uses) and offers no other values, but a
  member calling the Data API directly can still insert other values, as since Phase 4.
- How a former member's balance is settled is still open (O9): new settlements need two active
  members.
- Nothing schedules anything (no cron, no job runner): bill periods don't need it (see above), and
  notifications don't either: they're written with their events, and what's due is worked out
  when it's shown (D30).
- Notification retention is undecided (O2): nothing deletes them but deleting the household or the
  account.
