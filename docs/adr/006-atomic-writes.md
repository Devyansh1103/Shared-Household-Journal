# ADR-006: Atomic money writes through Postgres functions that also write the journal

- **Status:** Confirmed (2026-11-02). Decision A3.

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

## Consequences

- There is more SQL to maintain and test.
- The journal is guaranteed to be complete.
- `activity_events` is append-only.

## Repository evidence

None in code (see [phase-0 audit](../audits/phase-0.md)). Sources: TRD §3, §4 and §5.
