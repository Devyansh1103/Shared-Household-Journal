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

| Table / column            | Purpose                                     | Key constraints                                                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `households.creation_key` | Makes `create_household` idempotent         | Unique per (`created_by`, `creation_key`) when not null. The create form sends a fresh uuid per page visit, so a repeated submission returns the first household.                                                                                  |
| `activity_events`         | Append-only household journal (feed UI: 13) | `type` enum `activity_event_type`, `entity_type` enum `activity_entity_type`, `summary` must be a JSON object (ids and minimal context only, no emails or tokens). `actor_id` is null only for changes made outside a user session (service role). |

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

| Table               | Select                                                       | Insert                                                                      | Update                                                                  | Delete |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| `profiles`          | Self, and anyone who shares (or shared) a household with you | Trigger only                                                                | Self; `display_name`, `avatar_url` only                                 | No     |
| `households`        | Active members                                               | No (`create_household`)                                                     | Owner; `name`, `currency_code`, `timezone` only                         | No     |
| `household_members` | Active members of that household (all rows, incl. left)      | No (functions only)                                                         | No                                                                      | No     |
| `activity_events`   | Active members                                               | No (functions and triggers only)                                            | No                                                                      | No     |
| `invitations`       | Active members                                               | Active members; `household_id`, `token_hash`, `expires_at`, `max_uses` only | Set `revoked_at` on an unrevoked invite: its creator, or the owner (D4) | No     |
| `expenses`          | Active members (deleted ones too, D7)                        | No (`create_expense`)                                                       | No (`update_expense`, `delete_expense`, `restore_expense`)              | No     |
| `expense_splits`    | Active members                                               | No (functions only)                                                         | No                                                                      | No     |
| `settlements`       | Active members (voided ones too, D9)                         | No (`record_settlement`)                                                    | No (`void_settlement`; the trigger refuses anything else)               | No     |

"No" means there is no policy **and** no table privilege, so the request fails with `42501`.
Column-level grants stop an allowed row update from also changing ids, creators or counters.

Members who leave or are removed lose access immediately, because every check requires `left_at is null`.

## Not built yet

- Invitation caps (O6, still Open): the DB enforces `max_uses > 0` and expiry after creation, but no
  upper bound. The app always uses the defaults (7 days, 10 uses) and offers no other values, but a
  member calling the Data API directly can still insert other values, as since Phase 4.
- How a former member's balance is settled is still open (O9): new settlements need two active
  members.
- D9's in-app notification to the other party arrives with notifications (Phase 17, D12); the
  `settlement_recorded` event it will use is written now.
- `expenses.recurring_bill_id` / `recurrence_period` and their unique key arrive with recurring
  bills (Phase 14).
