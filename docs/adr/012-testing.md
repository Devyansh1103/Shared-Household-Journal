# ADR-012: Testing — Vitest for logic and RLS, Playwright for end-to-end tests

- **Status:** Confirmed (2026-11-02). Decision A6.

## Context
PRD §8 and TRD §5 and §8 require:
- money tests checked against independently calculated cases
- verification that one household cannot access another household's data

## Options
- Vitest
- Jest
- pgTAP for database policies
- Playwright
- Cypress

## Decision
**Vitest unit tests** for the split engine and balance reference, covering every case in TRD §5:
- rounding
- zero or one participant
- payer included or excluded
- partial and multiple settlements
- edits and deletions

They also check that net balances in a household add up to zero.

**Vitest integration tests** against local Supabase:
- two households and three users
- confirm that cross-household access is denied for select, insert, update and delete on every table
- confirm that members who have left lose access

**Playwright end-to-end smoke tests**, from Phase 8.

## Consequences
- RLS tests need Docker and local Supabase running.
- If they cannot run, they are reported as **not run**, never as passed.

## Repository evidence
None in code (see [phase-0 audit](../audits/phase-0.md)). Sources: PRD §8, TRD §5 and §8.
