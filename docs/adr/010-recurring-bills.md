# ADR-010: Recurring bills as reminders with idempotent recording; household timezone

- **Status:** Confirmed (2026-11-02). Decisions D10 and D11.

## Context
- PRD FR-08 requires protection against generating duplicate bills.
- TRD §12 left timezone handling and recurrence rules undecided.

## Options
1. Create expenses automatically with a scheduled job.
2. Show reminders, and record the expense only when a member confirms it.

## Decision

**Recurrence**
- A bill can repeat weekly, monthly or yearly, every N periods.
- Monthly bills set to the 29th–31st fall on the last day of shorter months.

**Dates and timezones**
- Each household has an IANA timezone.
- Due dates are calendar dates (`date`), worked out in the household's timezone.
- Event timestamps are stored as `timestamptz` in UTC.

**Recording a bill**
- "Record this bill" pre-fills an expense.
- `unique(recurring_bill_id, recurrence_period)` on expenses blocks duplicates.

**Changes to a bill**
- Edits apply to future periods only.
- Disabling a bill stops future reminders.
- Expenses already recorded are never changed.

## Consequences
- The first release needs no scheduler.
- Automatic creation can be added later by reusing the same uniqueness rule.

## Repository evidence
None in code (see [phase-0 audit](../audits/phase-0.md)). Sources: PRD FR-08, TRD §12.
