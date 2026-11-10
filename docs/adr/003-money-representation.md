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

Implemented in Phase 8 and hardened in Phase 9. See [money.md](../money.md).

- `expenses.amount_minor` and `expense_splits.share_minor` are `bigint`.
- The ISO 4217 exponents are pinned in `src/domain/money/currency.ts` rather than read from `Intl`,
  whose CLDR data differs from ISO for some currencies and between runtimes.
- The currency lock is `households_lock_currency`.
- Codes without a minor unit are refused by `households_currency_has_minor_unit`.

Sources: TRD §3 and §5, PRD §11.
