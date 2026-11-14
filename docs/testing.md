# Testing guide

Three layers of automated tests ([ADR-012](adr/012-testing.md)), plus the quality gates that run
before every commit. Commands are npm scripts; none needs a variable set by hand.

| Layer      | Command            | Where                                  | Needs                                                    | Size (2026-11-14)                                 |
| ---------- | ------------------ | -------------------------------------- | -------------------------------------------------------- | ------------------------------------------------- |
| Unit       | `npm test`         | `src/**/*.test.ts` (Vitest)            | Nothing                                                  | 47 files, 482 tests                               |
| Database   | `npm run test:db`  | `supabase/tests/**/*.test.ts` (Vitest) | The local stack (`npm run db:start`, Docker)             | 16 files, 291 tests                               |
| End to end | `npm run test:e2e` | `e2e/*.spec.ts` (Playwright)           | The local stack and a production build (`npm run build`) | 10 files, 100 runs (50 tests × desktop and phone) |

## Quality gates

`npm run check` runs the fast ones in order: `format:check`, `lint`, `typecheck`, `npm test`.
Before a commit, also run what the change touches: `npm run test:db` for database changes,
`npm run build` and `npm run test:e2e` for pages, and `npm audit --omit=dev` when dependencies
change (it must report 0 vulnerabilities; see [security.md](security.md) S5–S6 for the development
tools).

There is no CI pipeline in the repository yet. A pipeline would run the same commands: `npm ci`,
`npm run check`, `npm run build`, then the database and end-to-end tests against a Supabase stack
started in the job.

**Coverage isn't measured:** no coverage tool is installed (`@vitest/coverage-v8` would add it).
What is covered is listed below instead of as a percentage.

## Unit tests

Pure code, no network: the split engine (including seeded property tests), money parsing and
formatting, balances (a TypeScript reference the database is checked against), dates and periods,
every payload parser and checker, Zod schemas, wording, the safe return path, the configuration
checks ([src/lib/env.test.ts](../src/lib/env.test.ts)) and the colour tokens' contrast
([src/app/tokens.test.ts](../src/app/tokens.test.ts)).

## Database tests

Run as real signed-in users through the Data API, against the local stack. Each file creates its
own users and households (names include a random run id) and removes them afterwards. Keys come
from `supabase status`, held in memory, never written or printed
([supabase/tests/support/local-supabase.ts](../supabase/tests/support/local-supabase.ts)).

| File                                                                                   | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rls.test.ts`                                                                          | RLS and constraints on the first four tables; former members lose access.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `auth.test.ts`                                                                         | Sign-up with email confirmation (through Mailpit), sign-in, recovery, profiles.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `households.test.ts`                                                                   | Creating, joining, leaving, removing, handing over and deleting households.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `expenses.test.ts`, `split-engine.test.ts`                                             | Expense writes, their rights (D6, D7) and the database agreeing with the split engine.                                                                                                                                                                                                                                                                                                                                                                                           |
| `balances.test.ts`, `settlements.test.ts`                                              | Balances against the TypeScript reference; settlements (D9).                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `expense-history.test.ts`, `journal.test.ts`                                           | The history and journal reads.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `bills.test.ts`, `shopping-chores.test.ts`, `budgets.test.ts`, `notifications.test.ts` | Each module's functions, rights, journal events and notifications.                                                                                                                                                                                                                                                                                                                                                                                                               |
| **`authorization.test.ts`** (Phase 18)                                                 | The catalog (RLS everywhere, no views, exact table, column and function privileges, pinned `search_path`, the private schema not exposed); 48 attacks with another household's ids by an outsider, a former member and a signed-out visitor, each refused with the expected code and every row unchanged (compared with a superuser snapshot); an ordinary member trying the owner's and other people's actions; people and records from another household used inside your own. |
| **`financial-invariants.test.ts`** (Phase 18)                                          | 120 random operations (seeded; `FINANCE_SEED` to vary) of expenses with all three split methods, edits, deletes, restores, payments within and over what's owed, voids and retries, then a recorded bill with retries: shares add up for every expense, balances net to zero and match paid − share + payments from the raw rows, pairs agree with nets, retries record once, budgets and analytics equal direct sums. Also run with seeds 1, 77 and 4242.                       |
| **`operations.test.ts`** (Phase 18)                                                    | The health check; account deletion (D14) end to end: refusals (`HJ033`, `HJ034`, not for signed-in or signed-out roles), the hard delete refused, the soft delete ending sign-in, the profile anonymised, every record unchanged, and what other members see.                                                                                                                                                                                                                    |

## End-to-end tests

A real browser (set `PLAYWRIGHT_CHANNEL=msedge` or `chrome` to use an installed one) against
`next start` on port 3100, one test at a time, each in a desktop and a phone (Pixel 7) viewport.
Start the server yourself to reuse it, or let Playwright start it.

The workflows of the Phase 18 brief, all executed on 2026-11-14 (100 of 100 passed):

| Workflow                    | Tests                                                                                                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. New user                 | `workflows.spec.ts` A: sign up in the app (with a validation error first), not signed in and unable to sign in until confirmed, confirm from the email Supabase sends, arrive home, profile name, `HttpOnly`/`Secure` cookies, a used link refused. |
| B. Household creation       | `workflows.spec.ts` B: create a household in the app, see it listed as owner, open it, create an invite link, a second account joins in its own browser, members on both sides.                                                                     |
| C. Expense management       | `expenses.spec.ts`: add an expense (everyone in the split by default, the extra paisa shown), the stored amount and shares, edit to custom amounts, delete and restore.                                                                             |
| D. Balances and settlements | `workflows.spec.ts` D (expense, balance, payment back, settled, expense unchanged in the page and in the database) and `settlements.spec.ts`, `balances.spec.ts`. There is no "completed" step: a payment counts once recorded (D9; O10 is open).   |
| E. Budgets and analytics    | `budgets.spec.ts`: an overall and a category budget, used and left, over the limit, a changed limit, analytics totals, categories, people and filters.                                                                                              |
| F. Household collaboration  | `shopping-chores.spec.ts` (items: add, buy, reopen, edit, remove; chores: assign, complete, reassign, rights), `notifications.spec.ts`, `journal.spec.ts`.                                                                                          |
| G. Authorization            | `workflows.spec.ts` G (26 pages of another household by URL: each "We couldn't find that…", nothing of it in the page), each module's "a non-member sees…" test, the rights tests for bills and chores, and `authorization.test.ts` above.          |

`workflows.spec.ts` also checks every response's security headers, the absence of `X-Powered-By`,
`/api/health`, and that the browser reports no Content Security Policy violation on any page those
tests open.

## Writing tests

- Create what a test needs with throwaway users and households, and remove it in `afterAll`.
- Never print keys, tokens or `.env` values; never commit them.
- Tests share one local database: the end-to-end tests run one at a time.
- Match visible text only (`locator("visible=true")`): Next.js keeps the previous page mounted
  but hidden.
- A refused call must be checked for its error **code**, and for nothing having changed.
