# ADR-004: Split rounding

- **Status:** Confirmed (2026-11-02). Decision D2.

## Context

TRD §5 requires three things:

- Equal splits distribute any remainder in a deterministic way.
- Percentage splits total 100%.
- Custom splits add up exactly to the expense total.

## Options

How to handle the leftover remainder:

- Give it to the payer.
- Give it to the first participant.
- Use the largest-remainder method.

## Decision

- **Equal:** each participant gets `floor(total / n)`. The leftover units are given out one each, in the order members joined the household.
- **Percentage:** percentages are stored as integer basis points that must total exactly 10000. Amounts are allocated with the largest-remainder method. Ties are broken by the order members joined.
- **Custom:** the amounts must add up exactly to the total.

The engine is a pure TypeScript module (`src/domain/money`). It is used for the form preview and by the server. The database write function checks again that the shares reconcile to the total.

## Consequences

- The same input always produces the same output.
- Unit tests cover rounding, zero or one participant, and the payer being included or excluded.

## Repository evidence

Implemented in Phases 7–8, hardened in Phase 9. See [money.md](../money.md).

- **Code:** `src/domain/money/split.ts` (`computeSplit`).
- **Unit and property tests:** `split.test.ts` and `split.property.test.ts`, the latter with
  thousands of seeded generated cases per method.
- **Database checks:** `private.assert_expense_valid` and its deferred triggers. They check that
  shares reconcile and that equal and percentage shares are within one unit of their exact value.
  Which participants get the leftover units is left to the engine.
- **Cross-check:** `supabase/tests/split-engine.test.ts` confirms the database stores exactly what
  the engine produces.
- **Join order** is read from Postgres (`joined_at, user_id`).

Source: TRD §5.
