# Shared Household Journal

A shared record of money and home life for people who live together. It covers shared costs and fair splits, who owes whom, payments back, bills, shopping, chores, budgets and receipts, all in one place that everyone in the household can see.

> **The app never moves money.** Housemates pay each other outside the app. The app only records those payments, so that everyone's balance stays clear.

**Status:** under active development and not deployed yet. It runs locally against Supabase in Docker. The planned hosting is Vercel with a hosted Supabase project ([ADR-013](docs/adr/013-hosting.md)).

## Features

- **Households**
  - Each household has its own currency (any ISO 4217 currency, INR by default) and timezone.
  - Invite people with links that expire and can be revoked.
  - Members are owners or members. People can leave or be removed, ownership can be handed over, and an owner can delete the household.
- **Expenses**
  - Split equally, by percentage or by exact amounts. Shares always add up to the total, to the last paisa.
  - Expenses can be edited, deleted and restored.
  - The full history can be searched, filtered and sorted.
- **Balances and payments**
  - See who owes whom and why, worked out from the records.
  - Record a payment back, with a warning if it's more than what's owed. A mistaken payment can be voided.
- **Receipts**
  - Photograph or upload a receipt (JPEG, PNG, WebP or a one-page PDF).
  - It's read on your own device with Tesseract.js. No OCR or AI service is involved.
  - What it reads fills in the expense form for you to check, and the receipt stays attached to the expense.
- **Recurring bills**
  - Reminders every so many weeks, months or years.
  - Record a period as an expense, or skip, pause, resume or end a bill.
- **Shopping list and chores**
  - One shared shopping list.
  - One-off chores with an assignee, a due date and a priority.
- **Budgets and analytics**
  - Weekly, monthly or quarterly budgets, for all spending or for one category.
  - Spending by category and over time, and what each person paid against their share.
- **Household journal:** a timeline of what changed and who did it.
- **Notifications**
  - In-app notifications go to the people an event concerns.
  - Settings per household and per type.
  - A "Needs attention" list for what's due.
- **Accessibility:** every page is checked against WCAG 2.2 AA with axe at six screen widths. Layouts are designed phone-first, and everything works with a keyboard.

## Tech stack

| Area           | Choice                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------- |
| Framework      | Next.js 16 (App Router, Partial Prerendering), React 19, TypeScript (strict)             |
| UI             | Tailwind CSS 4, shadcn/ui (Radix), lucide icons, Plus Jakarta Sans                       |
| Data and auth  | Supabase: Postgres 17 with Row Level Security, Auth (email and password), Storage        |
| Validation     | Zod                                                                                      |
| Receipts       | Tesseract.js 7 (runs in the browser), pdf.js 6                                           |
| Tests          | Vitest (unit and database tests), Playwright (end-to-end, desktop and phone)             |
| Tooling        | npm, ESLint, Prettier, Supabase CLI (installed as a dev dependency)                      |

## How it's built

- **The household is the security boundary.**
  - Row Level Security is on for every table.
  - Every write goes through a Postgres function that checks membership and role.
  - The browser never talks to Supabase directly. Pages and Server Actions do, acting as the signed-in user.
- **Money is exact.**
  - Amounts are stored as whole numbers in the smallest unit (bigint), never as floats.
  - Each currency's decimal places come from ISO 4217.
  - Splits always add up exactly; the rounding rules are in [ADR-004](docs/adr/004-split-rounding.md).
- **Balances are worked out, never stored.** They are calculated from expenses and payments each time, and never trusted from the client.
- **Writes are atomic.** Each money change is one database function call in one transaction, and constraints check the books when it commits.
- **Records aren't erased.**
  - Deleted expenses can be restored by the household owner.
  - Payments are voided, never edited.
  - The journal can only be added to.
- **Decisions are written down** in [docs/decisions.md](docs/decisions.md) and the [ADRs](docs/adr/).

## Getting started

### Prerequisites

- Node.js 22 and npm.
- Docker, running. The first start downloads the Supabase images.

### Setup

```bash
git clone https://github.com/Devyansh1103/Shared-Household-Journal.git
cd Shared-Household-Journal
npm install
npm run db:start      # starts local Supabase in Docker and applies the migrations
cp .env.example .env.local
```

1. Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local`.
2. Take both values from `npm run db:status` (the API URL and the publishable key).
3. Don't share that command's output: it also prints the secret keys. The app never needs a secret key.

Then start the app:

```bash
npm run dev
```

- **App:** http://localhost:3000. Use `localhost`, not `127.0.0.1`, because email links point there.
- **Emails:** sign-up confirmations and password resets go to Mailpit at http://127.0.0.1:54324.
- **Supabase Studio:** http://127.0.0.1:54323.

## Scripts

| Command                                   | What it does                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`                             | Development server (copies the receipt-reading files into `public/vendor` first) |
| `npm run build` / `npm start`             | Production build and server                                                      |
| `npm run check`                           | Format check, lint, typecheck and unit tests in one go                           |
| `npm run lint` / `npm run typecheck`      | ESLint / TypeScript                                                              |
| `npm run format` / `npm run format:check` | Prettier                                                                         |
| `npm test`                                | Unit tests                                                                       |
| `npm run test:db`                         | Database tests (needs the local stack)                                           |
| `npm run test:e2e`                        | End-to-end tests (needs a build and the local stack)                             |
| `npm run db:start` / `db:stop` / `db:status` | Start, stop or inspect local Supabase                                         |
| `npm run db:types`                        | Regenerate the database types after a migration                                  |

## Testing

- **`npm test`: unit tests.** They need no setup. They cover the split engine (including property tests), money parsing and formatting, every payload check, and receipt reading.
- **`npm run test:db`: database tests** against the local stack. They need `npm run db:start` and cover:
  - RLS and privileges, checked against the database catalog;
  - every database function;
  - an attack matrix that tries every function and table with another household's ids;
  - money invariants under random operations;
  - the Storage rules for receipts.
- **`npm run test:e2e`: Playwright tests** in desktop and phone viewports, against `next start` on port 3100.
  - Run `npm run build` first.
  - To use an installed browser, set `PLAYWRIGHT_CHANNEL=msedge` (or `chrome`). Otherwise run `npx playwright install chromium`.

More in [docs/testing.md](docs/testing.md).

## Project structure

```
src/
  app/            routes: pages, layouts, Server Actions, API routes
  components/     shared UI (shadcn/ui components in components/ui)
  domain/money/   the split engine and money arithmetic
  lib/            feature modules: queries, payload checks, formatting, receipts…
supabase/
  migrations/     schema, database functions and policies (additive only)
  tests/          database tests
e2e/              Playwright tests
scripts/          build helpers
docs/             decisions, ADRs and a guide for each feature
```

## Documentation

| Topic                              | Where                                                                                                                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decisions and architecture records | [decisions.md](docs/decisions.md), [adr/](docs/adr/)                                                                                                                                                                         |
| Roadmap                            | [roadmap.md](docs/roadmap.md)                                                                                                                                                                                                 |
| Database, security model and money | [database.md](docs/database.md), [money.md](docs/money.md), [auth.md](docs/auth.md)                                                                                                                                         |
| Features                           | [journal](docs/journal.md), [bills](docs/bills.md), [shopping and chores](docs/shopping-chores.md), [budgets](docs/budgets.md), [notifications](docs/notifications.md), [receipts](docs/receipts.md)                          |
| Design system                      | [design-system.md](docs/design-system.md)                                                                                                                                                                                    |
| Security and testing               | [security.md](docs/security.md), [testing.md](docs/testing.md), [known-limitations.md](docs/known-limitations.md)                                                                                                           |
| Deploying and running              | [deployment.md](docs/deployment.md), [environment.md](docs/environment.md), [migrations.md](docs/migrations.md), [operations.md](docs/operations.md), [backup-recovery.md](docs/backup-recovery.md), [production-readiness.md](docs/production-readiness.md) |
| Original requirements              | `Roommate_PRD.pdf` and `Roommate_TRD.pdf` in the repository root; amendments are in [requirements-notes.md](docs/requirements-notes.md)                                                                                      |

## Deployment

- **Hosting:** the app runs on Vercel and the data on a hosted Supabase project.
- **Configuration:** the app needs only two public environment variables.
- **Guide:** step-by-step in [docs/deployment.md](docs/deployment.md).
- **Readiness:** [docs/production-readiness.md](docs/production-readiness.md) currently assesses the app as ready for a staging deployment. Production needs the hosted settings listed there: Auth URLs and email, rate limits, and backups.

## Security

- Security headers and a Content Security Policy on every response.
- Session cookies that are `HttpOnly` and `Secure`.
- Configuration checked when building and starting.
- A health check at `/api/health`.
- The review is in [docs/security.md](docs/security.md). It is an internal review, not a certification.
- Please report vulnerabilities privately to the maintainer rather than in a public issue.

## Roadmap

- **Done:** phases 0–10 and 12–19, from the foundations to receipts.
- **Not built yet:** phase 11, the household dashboard.
- **Optional, not started:**
  - phase 20, AI-assisted categorisation, which first needs a decision on AI;
  - phase 21, debt simplification and export.

See [docs/roadmap.md](docs/roadmap.md).

## Contributing conventions

- Use npm only, with Node 22.
- Migrations are additive.
  - Never edit an applied migration.
  - Every new table needs RLS and explicit grants; a catalog test enforces this.
- Money:
  - Use integer minor units only.
  - Format money only through `src/lib/format.ts`.
  - Never trust balances sent from the client.
- UI:
  - Use the design tokens and `type-*` utilities.
  - Never use colour as the only signal.
  - Colour contrast is checked by `src/app/tokens.test.ts`.
- Before committing, run `npm run check`, plus the database or end-to-end tests for what you changed.

## Licence

There's no licence file yet, so default copyright applies: others can view the code on GitHub but have no permission to reuse it. Add a `LICENSE` file to change that.
