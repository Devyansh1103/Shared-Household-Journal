# ADR-005: Derived, pairwise, explainable balances

- **Status:** Confirmed (2026-11-02). Decision D8.

## Context

- PRD FR-05 says not to store a mutable balance as the only source of truth.
- TRD §5 says balances calculated on the client are never authoritative.

## Options

- Stored running balances
- A SQL view or function that derives balances
- Balances computed only in the application

## Decision

**Pairwise balances**

- For every expense that isn't deleted, each participant owes the payer their share.
- A settlement from A to B that isn't voided reduces what A owes B.
- Pairwise balances are the main view. Each pair can be expanded to show the expenses and settlements behind it.

**Net balance per member**

- Net = paid − shares + settlements paid − settlements received.
- Within a household, the net balances must add up to zero.

**Where it is calculated**

- Balances are computed in SQL by a `security_invoker` view or function.
- A TypeScript reference implementation is cross-checked against it in tests.

**Settlements and expenses**

- Settlements are not linked to individual expenses.

## Consequences

- Nothing is stored that can go stale.
- If performance needs it later, add a cache that has a reconciliation path.
- Debt simplification is out of scope until Phase 21.

## Repository evidence

None in code (see [phase-0 audit](../audits/phase-0.md)). Sources: PRD FR-05, TRD §3 and §5.
