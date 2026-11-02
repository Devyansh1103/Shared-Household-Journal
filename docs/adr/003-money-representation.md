# ADR-003: Money as integer minor units, one currency per household

- **Status:** Confirmed (2026-11-02). Decisions D1 and D2.

## Context
TRD §3 forbids binary floating point as the source of truth for money. PRD §11 left the currency policy open.

## Options
- Floating point (rejected)
- Postgres `numeric`
- `bigint` minor units
- Multi-currency with conversion

## Decision
- Store every amount as a `bigint` in minor units. Columns use the `_minor` suffix, for example `amount_minor`.
- Each household has a `currency_code` (ISO 4217). It is chosen when the household is created and defaults to INR.
- `currency_code` cannot change once the household has an expense.
- The number of decimal places comes from the currency's ISO 4217 exponent.
- There is no currency conversion.

## Consequences
- Checking that splits add up to the total is exact integer arithmetic.
- Amounts are formatted for display only, using `Intl.NumberFormat`.
- Multi-currency households would need a new ADR.

## Repository evidence
None in code (see [phase-0 audit](../audits/phase-0.md)). Sources: TRD §3 and §5, PRD §11.
