# ADR-007: Soft-delete expenses; void settlements, never edit them

- **Status:** Confirmed (2026-11-02). Decisions D6, D7 and D9.

## Context

PRD §11 and TRD §12 leave two questions open: should deletion be hard or soft, and how is a settlement reversed? We need balances that can be explained and a journal that can be audited.

## Options

- Hard delete
- Soft delete
- Full revision history

## Decision

**Expenses**

- Expenses get `deleted_at` and `deleted_by` columns.
- The creator, the payer or the owner can edit or delete an expense.
- The owner can restore a deleted expense.
- Every change writes a journal event with the old and new values.

**Settlements**

- Settlements get `voided_at` and `voided_by` columns.
- A settlement can't be edited. To fix one, void it and record it again.
- The payer, the recipient or the owner can void a settlement.

## Consequences

- Every balance and list query must filter out deleted or voided rows.
- RLS tests cover these filters.
- Full revision history is deferred.

## Repository evidence

Sources: PRD §11, TRD §12.

- **Expenses** (Phase 8): `deleted_at` / `deleted_by`, `delete_expense` and `restore_expense`
  (owner only); see [database.md](../database.md#expenses-and-splits-phase-8).
- **Settlements** (roadmap Phase 10, 2026-11-12): `voided_at` / `voided_by` and `void_settlement`
  (payer, recipient or owner). There's no edit function, and the `settlements_protect` trigger
  refuses any update other than voiding once, and any delete except the household's own cascade
  (D14), for every role. See [database.md](../database.md#settlements-roadmap-phase-10).
- Balance and list queries filter deleted and voided rows themselves; the database tests cover it.
