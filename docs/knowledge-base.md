# Shared Household Journal — Knowledge Base

This is the Markdown version of `roommate_knowledgebase.pdf` (Draft v2). The PDF is kept unchanged as the original. Update this file when a verified fact or decision changes.

Never record an unconfirmed assumption here as a fact.

## Product identity

- **Name:** Shared Household Journal.
- **Purpose:** help people who share a home manage shared costs and home coordination, transparently and in a friendly way.
- **Experience:** warm, calm, practical, human, home-oriented.
- **Primary users:** roommates and other shared households.
- **Boundary:** the app records and explains shared finances. It is not a bank and does not move money.

## Feature map

**Core features**
- Household and membership
- Expenses
- Equal, percentage, and custom splits
- Derived balances
- Settlement records
- Activity journal
- Recurring bills
- Shopping list
- Chores
- Budgets and summaries
- Notification preferences
- Profile and settings

**Optional (needs explicit approval and a privacy review):** receipt OCR, assisted categorization, debt simplification, export. OCR and AI are currently **not approved** (D15).

## Visual language

**Palette**

| Role | Colour |
|---|---|
| Primary | `#4F7CAC` |
| Secondary | `#7FB069` |
| Accent | `#F4A259` |
| Page background | `#FAF8F5` |
| Surfaces | `#FFFFFF` |
| Main text | `#2D3748` |
| Success | `#22C55E` |
| Warning | `#F59E0B` |
| Danger | `#EF4444` |

**Rules**
- These colours are for fills, icons, and large text.
- Body-size text needs darker shades so it meets WCAG AA (D16).
- **Font:** Plus Jakarta Sans (F1).
- Light mode only (D19).
- English, with `en-IN` formatting (D18).

## Domain glossary

- **Household:** a shared workspace. It is the authorization boundary and has its own currency and timezone.
- **Member:** an authenticated user who belongs to a household. A member is either an Owner or a Member.
- **Expense:** a recorded cost with a payer, amount (in minor units), date, category, and split participants. Deleting an expense is a soft delete.
- **Split:** how an expense's amount is divided among participants. The shares always add up exactly to the amount.
- **Balance:** a net obligation calculated from expenses and settlements. It is never stored as the source of truth.
- **Settlement:** a record inside the app that an obligation was settled. It does not prove or start an external transfer. A settlement can be voided but not edited.
- **Recurring bill:** a reminder template. Each period is recorded as an expense at most once.
- **Journal event:** an append-only record of a meaningful household action.
- **RLS:** Postgres Row Level Security, the policies that control which rows each user can access.

## Important product rules

1. Subscription or Stripe billing is not part of the product baseline.
2. Never claim that the app transfers money.
3. Expense split totals must reconcile exactly to the original amount.
4. Balances must be explainable from the underlying expenses and settlements.
5. Household data must be isolated from non-members.
6. Manual correction must always remain possible for any optional AI or OCR suggestions.
7. Fake demo data must never be presented as live user data without a clear label.
8. Existing repository code and verified decisions take precedence over assumptions in this document.

## Repository facts

Last verified: 2026-11-02, after Phase 1. Planned items are marked **(planned)** until Phase 2 verifies them.

- **Framework/version:** none yet. Next.js App Router + TypeScript **(planned, A1)**.
- **Package manager and lockfile:** npm **(planned, A2)**. No lockfile yet.
- **Main source directory:** none yet.
- **Route structure:** none yet.
- **Database/auth provider:** Supabase **(planned, A3/A4)**. Not configured.
- **Schema/migration location:** none yet.
- **UI library and design tokens:** Tailwind + shadcn/ui **(planned, A5)**. No tokens yet.
- **Test/lint/typecheck/build commands:** none yet.
- **Implemented features:** none.
- **Known blockers:**
  - The Supabase CLI is not installed. It will be added as a dev dependency (A4).
  - `npx --version` produced unexpected output and needs a check.
- **Deployment target:** Open (O1).
- **Environment variable names:** none defined yet. They will be listed in `.env.example`.
- **Git:** `main` tracks `origin/main` (`github.com/Devyansh1103/Shared-Household-Journal`).

## Decisions

See [decisions.md](decisions.md) for the register and [adr/](adr/) for the reasoning.

## Working conventions

- Start each phase with an audit of the repository. Work in bounded phases and tasks.
- Preserve existing working code and any uncommitted changes.
- Never expose secrets or print environment values. Document variable names only.
- Never run destructive migrations without explicit approval. Migrations must be additive.
- Use the repository's actual scripts, and report which commands were run.
- Never fabricate test results, features, or claims that work is complete.
- **Git:** commits use the owner's identity only, with no AI co-author trailers or tool attribution. Commits may be made locally; the owner does all pushing.
- Update these docs when a verified architecture or product decision changes.

## Phase sequence

See [roadmap.md](roadmap.md).

## Task completion checklist

- [ ] Existing behaviour and working files were preserved.
- [ ] Requirements and assumptions were reviewed.
- [ ] Code changes are scoped and understandable.
- [ ] Input validation and authorization were considered.
- [ ] Tests and checks were run where available.
- [ ] Results are reported honestly, and any checks not run are disclosed.
- [ ] Migration and environment changes are documented.
- [ ] Docs and the decision register are updated where needed.
- [ ] The next step is identified.
