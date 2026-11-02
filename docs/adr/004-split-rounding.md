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
None in code (see [phase-0 audit](../audits/phase-0.md)). Source: TRD §5.
