# Roadmap

Confirmed 2026-11-02 (decision R1). This replaces PRD §9 and the Knowledge Base phase sequence.

Rules for every phase:

- Each phase starts with an audit of the relevant code and a short plan.
- Accessibility, loading/empty/error states, and tests are part of every phase, not left for the end.

| #   | Phase                                         | Notes                                                                                                                                                                                      |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | Repository audit & baseline                   | Done — [audits/phase-0.md](audits/phase-0.md)                                                                                                                                              |
| 1   | Product decisions & architecture confirmation | Done — [decisions.md](decisions.md), [adr/](adr/)                                                                                                                                          |
| 2   | Project setup & UI/UX foundation              | Done — [design-system.md](design-system.md). Next.js/TypeScript/Tailwind/shadcn with npm, ESLint, Prettier, Vitest, accessible tokens (D16), Plus Jakarta Sans.                            |
| 3   | Application shell & navigation                | Done (2026-11-10, after Phase 6) — [design-system.md](design-system.md#application-shell). Bottom navigation below 1024px, sidebar from 1024px                                             |
| 4   | Core database & security foundation           | Done — [database.md](database.md). Tables: profiles, households, household_members, invitations. RLS helper functions and the RLS test harness on local Supabase.                          |
| 5   | Authentication & user profiles                | Done — [auth.md](auth.md). Supabase Auth with email and password                                                                                                                           |
| 6   | Household creation, membership & invitations  | Done — [database.md](database.md). Activity events are written from this phase onwards; a simple household home page                                                                       |
| 7   | Split calculation engine                      | Done (2026-11-11, together with Phase 8; hardened the same day: ISO 4217 decimals, structured errors, property tests) — [money.md](money.md). Moved ahead of expenses.                     |
| 8   | Expense management                            | Done (2026-11-11) — [database.md](database.md#expenses-and-splits-phase-8). `create_expense` / `update_expense` / `delete_expense` / `restore_expense`; first Playwright e2e test (A6)     |
| 9   | Balances & debt explanation                   | Done (2026-11-10) — [money.md](money.md#balances). SQL-derived pairwise balances, checked against a TypeScript reference implementation; overview and per-person explanation pages         |
| 10  | Settlement tracking                           | Done (2026-11-12) — [database.md](database.md#settlements-roadmap-phase-10), [money.md](money.md#settlements). Record (with a review step and D9's warning) and void; part of the balances |
| 11  | Household dashboard                           | Moved here so it has real data to show. Not built yet: the owner took Phase 12 first (2026-11-13)                                                                                          |
| 12  | Expense history & filtering                   | Done (2026-11-13) — [database.md](database.md#expense-history-roadmap-phase-12). Search, filters, sorting and pages, all in the URL; a summary of what matches                             |
| 13  | Household journal & activity feed             | Done (2026-11-13) — [journal.md](journal.md). A read model over the events recorded since Phase 6 (`household_journal`): days, filters and keyset pages; D26 (proposed)                    |
| 14  | Recurring bills & reminders                   | Done (2026-11-13) — [bills.md](bills.md). Periods worked out on every read (no scheduler); one recorded expense per period; in-app reminders only (notifications: 17); D27 (proposed)      |
| 15  | Shopping list & chores                        |                                                                                                                                                                                            |
| 16  | Budgets & household analytics                 |                                                                                                                                                                                            |
| 17  | Notifications, accessibility & UX polish      | In-app notifications; accessibility audit pass                                                                                                                                             |
| 18  | Security, testing & deployment                | Hardening pass; hosting decision (O1)                                                                                                                                                      |

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
