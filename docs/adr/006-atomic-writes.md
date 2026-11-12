# ADR-006: Atomic money writes through Postgres functions that also write the journal

- **Status:** Confirmed (2026-11-02), amended 2026-11-11 (see below). Decision A3.

## Context

An expense, its splits, and its activity event must never be partly saved. A missing journal entry would break auditability.

## Options

1. Several inserts from the client.
2. Server Actions that make separate database calls.
3. One Postgres function per operation.

## Decision

Server Actions validate input with Zod, then call Postgres functions:

- `create_household`
- `accept_invite`
- `create_expense`, `update_expense`, `delete_expense`
- `record_settlement`, `void_settlement`
- `leave_household`

Each function does three things in one transaction:

- checks that the payer and all participants are active members of the household
- checks the money invariants
- writes the change and its `activity_events` row

**Permissions**

- Functions run as `SECURITY INVOKER` wherever possible, so RLS still applies.
- Only `create_household` and `accept_invite` are `SECURITY DEFINER`. Each one checks the user and token explicitly.

## Amendment (2026-11-11, approved by the owner)

The "SECURITY INVOKER wherever possible" rule turned out to conflict with the journal guarantee. A
function running with the caller's rights can only write a table the caller can also write
directly through the Data API, and a direct write skips the function's checks and its journal
entry (D6).

So these functions are `SECURITY DEFINER`, and signed-in users have **no** direct insert, update
or delete privileges on the tables they write:

- **Membership (Phase 6):** `leave_household`, `remove_member`, `transfer_ownership`,
  `delete_household`, alongside `create_household` and `accept_invite`.
- **Expenses (Phase 8):** `create_expense`, `update_expense`, `delete_expense`, `restore_expense`.

Each one takes the caller from `auth.uid()` (never an argument), checks the caller's own active
membership and role, checks the money invariants, writes the change and its `activity_events` row,
and has `EXECUTE` granted to `authenticated` only. As defence in depth, a deferred constraint
trigger re-checks that shares add up at commit, whatever the write path (even the service role).

Settlement functions (Phase 10) follow the same pattern. Implemented 2026-11-12:
`record_settlement` and `void_settlement` are `SECURITY DEFINER`, signed-in users have no write
privileges on `settlements`, and a trigger refuses any change other than voiding, whatever the
write path.

## Consequences

- There is more SQL to maintain and test.
- The journal is guaranteed to be complete.
- `activity_events` is append-only.

## Repository evidence

None in code (see [phase-0 audit](../audits/phase-0.md)). Sources: TRD §3, §4 and §5.
