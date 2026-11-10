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

Implemented 2026-11-10 (roadmap Phase 9). Sources: PRD FR-05, TRD §3 and §5.

- **SQL:** `public.household_balances` in
  [20261113120000_balances.sql](../../supabase/migrations/20261113120000_balances.sql) is a
  `security invoker` function, so RLS applies, and it checks membership explicitly too. It returns
  everyone's paid, share and net, the pairs, and the expenses behind one person's balance, all from
  one snapshot. `private.balance_people` is the one definition of a balance; `member_net_minor`
  (D13, O8) uses it too.
- **Reference:** [src/domain/money/balances.ts](../../src/domain/money/balances.ts)
  (`computeBalances`, `entriesFor`). `supabase/tests/balances.test.ts` cross-checks SQL and
  TypeScript on generated expenses with edits, deletes and restores.
- **Verified before display:** `checkBalances` and `checkEntries` run on what the database returns.
  If anything doesn't add up, the pages show an error instead of figures.
- **Pairs:** "between two people the directions offset" was read as netting within each pair only;
  nothing moves between pairs.
- **People who have left (D24):** they stay in the balances while they're in counted expenses. Their
  balance can change only if such an expense is deleted. Settling it is open (O9).
- **Not stored:** nothing is cached, so there's nothing to reconcile.

See [money.md](../money.md#balances) and [database.md](../database.md#balances-roadmap-phase-9).
