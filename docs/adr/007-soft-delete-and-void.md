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
None in code (see [phase-0 audit](../audits/phase-0.md)). Sources: PRD §11, TRD §12.
