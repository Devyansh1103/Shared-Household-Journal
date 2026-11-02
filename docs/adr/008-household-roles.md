# ADR-008: Household roles: Owner and Member

- **Status:** Confirmed (2026-11-02). Decisions D3, D4 and D13.

## Context
Shared households are mostly groups of equals. PRD §11 left the roles open.

## Options
- Owner and Member
- Owner, Admin and Member

## Decision
Each household has exactly one owner.

**Owner can:**
- rename or delete the household
- remove members
- revoke any invite
- transfer ownership
- restore deleted expenses
- void any settlement

**Any member can:**
- create invite links
- record expenses
- use the shared tools

**Leaving a household:**
- A member can leave only when their balance is zero.
- After they leave, their name stays on past records with a "(left)" label.
- The owner must transfer ownership before leaving, or delete the household if they are the only member.

## Consequences
- The memberships table needs a `role` column and a `left_at` column.
- A database rule ensures there is exactly one active owner per household.
- An Admin role can be added later without breaking existing data.

## Repository evidence
None in code (see [phase-0 audit](../audits/phase-0.md)). Source: PRD §11.
