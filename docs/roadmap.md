# Roadmap

Confirmed 2026-11-02 (decision R1). This replaces PRD §9 and the Knowledge Base phase sequence.

Rules for every phase:

- Each phase starts with an audit of the relevant code and a short plan.
- Accessibility, loading/empty/error states, and tests are part of every phase, not left for the end.

| #   | Phase                                         | Notes                                                                                                                                                             |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Repository audit & baseline                   | Done — [audits/phase-0.md](audits/phase-0.md)                                                                                                                     |
| 1   | Product decisions & architecture confirmation | Done — [decisions.md](decisions.md), [adr/](adr/)                                                                                                                 |
| 2   | Project setup & UI/UX foundation              | Done — [design-system.md](design-system.md). Next.js/TypeScript/Tailwind/shadcn with npm, ESLint, Prettier, Vitest, accessible tokens (D16), Plus Jakarta Sans.   |
| 3   | Application shell & navigation                | Responsive layout: bottom navigation on mobile, sidebar on desktop                                                                                                |
| 4   | Core database & security foundation           | Done — [database.md](database.md). Tables: profiles, households, household_members, invitations. RLS helper functions and the RLS test harness on local Supabase. |
| 5   | Authentication & user profiles                | Supabase Auth with email and password                                                                                                                             |
| 6   | Household creation, membership & invitations  | Activity events are written from this phase onwards; a simple household home page                                                                                 |
| 7   | Split calculation engine                      | Pure TypeScript with full unit tests. Moved ahead of expenses.                                                                                                    |
| 8   | Expense management                            | Atomic `create_expense` / `update_expense` / `delete_expense` functions                                                                                           |
| 9   | Balances & debt explanation                   | SQL-derived pairwise balances, checked against a TypeScript reference implementation                                                                              |
| 10  | Settlement tracking                           | Record and void                                                                                                                                                   |
| 11  | Household dashboard                           | Moved here so it has real data to show                                                                                                                            |
| 12  | Expense history & filtering                   | Pagination; filters stored in the URL                                                                                                                             |
| 13  | Household journal & activity feed             | Feed UI over events recorded since Phase 6                                                                                                                        |
| 14  | Recurring bills & reminders                   | Reminders, plus one recorded expense per bill per period                                                                                                          |
| 15  | Shopping list & chores                        |                                                                                                                                                                   |
| 16  | Budgets & household analytics                 |                                                                                                                                                                   |
| 17  | Notifications, accessibility & UX polish      | In-app notifications; accessibility audit pass                                                                                                                    |
| 18  | Security, testing & deployment                | Hardening pass; hosting decision (O1)                                                                                                                             |

Optional (each requires explicit approval):

| #   | Phase                        |
| --- | ---------------------------- |
| 19  | Receipt OCR                  |
| 20  | AI-assisted categorization   |
| 21  | Debt simplification & export |

## Changes from the original 18-phase list

- Project setup was added to Phase 2. Neither roadmap had a setup step, and the repository was empty.
- Phase 4 covers only the core tables. Each feature phase adds its own tables through additive migrations.
- The split engine now comes before expense management.
- The dashboard moved from Phase 7 to Phase 11.
- Journal events are written from Phase 6 onwards. Phase 13 builds only the feed UI.
