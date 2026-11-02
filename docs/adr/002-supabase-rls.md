# ADR-002: Supabase, with Row Level Security as the main access control

- **Status:** Confirmed (2026-11-02). Decisions A3 and A4.

## Context
- PRD FR-12 and TRD §4 make household membership the boundary for who can see what.
- TRD §4 says hiding things in the UI is not security.

## Options
- Supabase: Postgres, Auth, and RLS
- Postgres with Auth.js, with authorization checked only in application code
- Firebase

## Decision
Use Supabase. Every table has RLS enabled and denies access by default.

**Helper functions**
- `is_household_member(household_id)` and `household_role(household_id)`.
- Both are `SECURITY DEFINER` with a fixed `search_path`, and they check only `auth.uid()`.

**Sessions**
- `@supabase/ssr` keeps the session in cookies.
- Middleware only refreshes the session. Authorization is never decided in middleware.

**Local development and keys**
- Local development uses Supabase in Docker. The Supabase CLI is installed as a project dev dependency.
- The service-role key is never sent to the browser, and normal user requests don't need it.

## Consequences
- Data stays isolated even if application code has a bug.
- Policies need their own automated tests (see [ADR-012](012-testing.md)).
- Local development requires Docker.

## Repository evidence
None in code (see [phase-0 audit](../audits/phase-0.md)). Sources: PRD FR-12, TRD §1 and §4.
