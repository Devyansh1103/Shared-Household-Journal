# Decision Register

This replaces the Knowledge Base decision log. Statuses: **Confirmed**, **Proposed**, **Open**, **Superseded**.
A proposal never becomes Confirmed without the owner's approval. Phase numbers follow [roadmap.md](roadmap.md).

All Confirmed entries below were approved by the project owner on **2026-11-02** (Phase 1).

## Product decisions

| ID  | Decision                                                                                                                                                                                                                                                                | Status    | Needed by | ADR                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------- | ------------------------------------------------------------------------ |
| D1  | One currency per household, chosen when the household is created and locked once the first expense exists. Default: **INR**. No currency conversion.                                                                                                                    | Confirmed | Phase 4   | [003](adr/003-money-representation.md)                                   |
| D2  | Money is stored as bigint whole numbers in the smallest unit (e.g. paise). Each currency's decimal places come from its ISO 4217 code. Rounding rules are below.                                                                                                        | Confirmed | Phase 4   | [003](adr/003-money-representation.md), [004](adr/004-split-rounding.md) |
| D3  | Household roles are **Owner** and **Member** only. No Admin role.                                                                                                                                                                                                       | Confirmed | Phase 4   | [008](adr/008-household-roles.md)                                        |
| D4  | Any member can create invite links. Only the owner can revoke other people's invites or remove members.                                                                                                                                                                 | Confirmed | Phase 6   | [008](adr/008-household-roles.md)                                        |
| D5  | Invites are links that can be used several times, with expiry and a use limit, and that can be revoked. Details below.                                                                                                                                                  | Confirmed | Phase 4   | [009](adr/009-invitations.md)                                            |
| D6  | The expense's creator, its payer, or the household owner can edit or delete it. Every change is written to the journal with the old and new values.                                                                                                                     | Confirmed | Phase 8   | [007](adr/007-soft-delete-and-void.md)                                   |
| D7  | Expenses are **soft-deleted** (`deleted_at`). They stop counting towards balances, stay visible in the journal, and the owner can restore them.                                                                                                                         | Confirmed | Phase 4   | [007](adr/007-soft-delete-and-void.md)                                   |
| D8  | Expenses that already have settlements can still be deleted. Settlements are between two people, not linked to an expense, so balances just recalculate. If someone has then paid more than they owe, it shows as money owed back to them.                              | Confirmed | Phase 10  | [005](adr/005-derived-balances.md)                                       |
| D9  | Settlements are recorded by hand and can be voided but not edited. Details below.                                                                                                                                                                                       | Confirmed | Phase 10  | [007](adr/007-soft-delete-and-void.md)                                   |
| D10 | Recurring bills are reminders only; "Record this bill" pre-fills an expense. Only one expense can be recorded per bill per period. Details below.                                                                                                                       | Confirmed | Phase 14  | [010](adr/010-recurring-bills.md)                                        |
| D11 | Each household has an IANA timezone (e.g. `Asia/Kolkata`). Business dates are stored as `date`. Event times are stored as `timestamptz` in UTC.                                                                                                                         | Confirmed | Phase 4   | [010](adr/010-recurring-bills.md)                                        |
| D12 | Notifications are in-app only for the first release, with an on/off switch per user and per type. Email and push come later.                                                                                                                                            | Confirmed | Phase 17  | [011](adr/011-notifications.md)                                          |
| D13 | Members can leave only when their balance is zero. Their name stays on past records with a "(left)" label. The owner must transfer ownership first, or delete the household if they're the only member.                                                                 | Confirmed | Phase 6   | [008](adr/008-household-roles.md)                                        |
| D14 | The owner can delete a household once they're the only member left (permanent). Deleting an account anonymises the profile to "Former member" and keeps the financial records other members rely on. Export is deferred to Phase 21.                                    | Confirmed | Phase 18  | —                                                                        |
| D15 | OCR and AI are deferred and **not approved**. No household data goes to external AI or OCR services. Manual entry always stays available.                                                                                                                               | Confirmed | —         | —                                                                        |
| D16 | Keep the PRD palette for buttons, backgrounds, and icons. Add darker shades for text, and for white text on coloured buttons, so both meet WCAG AA. Details below. Implemented 2026-11-03; enforced by `src/app/tokens.test.ts` ([design-system.md](design-system.md)). | Confirmed | Phase 2   | —                                                                        |
| D17 | Categories are a fixed list: Rent, Utilities, Groceries, Household supplies, Internet, Dining, Transport, Other. Custom categories come later.                                                                                                                          | Confirmed | Phase 8   | —                                                                        |
| D18 | English only. Amounts and dates are formatted with `Intl` using locale `en-IN`.                                                                                                                                                                                         | Confirmed | Phase 2   | —                                                                        |
| D19 | Light mode only for the first release.                                                                                                                                                                                                                                  | Confirmed | Phase 2   | —                                                                        |
| D20 | New accounts must confirm their email address before they can sign in. A duplicate sign-up shows the same "check your email" message as a new one. Confirmed 2026-11-04.                                                                                                | Confirmed | Phase 5   | —                                                                        |
| D21 | Password recovery is included: request a reset link by email, then choose a new password. The request always gets the same neutral answer. Confirmed 2026-11-04.                                                                                                        | Confirmed | Phase 5   | —                                                                        |
| D22 | Passwords need at least 8 characters, with no composition rules. No avatar upload (initials only). The email address can't be changed in the app yet. Stated as Phase 5 defaults on 2026-11-04; awaiting explicit approval.                                             | Proposed  | Phase 5   | —                                                                        |
| D23 | Features that aren't built yet may appear on the household dashboard as non-clickable cards with a visible "Coming soon" text label (not colour alone), with no links and no figures. Navigation lists only routes that exist. Confirmed 2026-11-10.                    | Confirmed | Phase 11  | —                                                                        |
| F1  | Typeface: **Plus Jakarta Sans**, loaded with `next/font`.                                                                                                                                                                                                               | Confirmed | Phase 2   | —                                                                        |

## Architecture decisions

| ID  | Decision                                                                                                                                                                                                        | Status    | ADR                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------- |
| A1  | Next.js (App Router) + TypeScript in strict mode, at the current stable version, verified at install time                                                                                                       | Confirmed | [001](adr/001-stack.md)                                         |
| A2  | npm as the package manager                                                                                                                                                                                      | Confirmed | [001](adr/001-stack.md)                                         |
| A3  | Supabase: Postgres, Auth, and RLS as the main access control. All money writes go through atomic Postgres functions. Amended 2026-11-11: membership and expense functions are `SECURITY DEFINER` (see ADR-006). | Confirmed | [002](adr/002-supabase-rls.md), [006](adr/006-atomic-writes.md) |
| A4  | Local Supabase in Docker for development; Supabase CLI installed as a project dev dependency, not globally                                                                                                      | Confirmed | [002](adr/002-supabase-rls.md)                                  |
| A5  | Tailwind CSS + shadcn/ui + lucide icons                                                                                                                                                                         | Confirmed | [001](adr/001-stack.md)                                         |
| A6  | Vitest for domain logic and RLS tests; Playwright for end-to-end tests from Phase 8                                                                                                                             | Confirmed | [012](adr/012-testing.md)                                       |
| R1  | Reordered roadmap                                                                                                                                                                                               | Confirmed | [roadmap.md](roadmap.md)                                        |

## Open items

| ID  | Item                                                                                                                                                                                                                                       | Status    | Needed by |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | --------- |
| O1  | Production hosting. Vercel + hosted Supabase is suggested.                                                                                                                                                                                 | Open      | Phase 18  |
| O2  | Data-retention periods                                                                                                                                                                                                                     | Open      | Phase 18  |
| O3  | Who may edit budgets. Proposed: owner only.                                                                                                                                                                                                | Proposed  | Phase 16  |
| O4  | Supabase public key: the **publishable** key, as `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (with `NEXT_PUBLIC_SUPABASE_URL`). Resolved 2026-11-04.                                                                                            | Confirmed | Phase 5   |
| O5  | Whether React Hook Form is needed for the split editor. **No:** plain React state with the existing Server Action pattern; no form library. Resolved 2026-11-11.                                                                           | Confirmed | Phase 8   |
| O6  | D5 says invites default to 7 days and 10 uses. Are those also maximums a member cannot exceed? The database currently enforces only `max_uses > 0` and expiry after creation. Phase 6 left this open: the app only ever uses the defaults. | Open      | Phase 6   |
| O7  | Should a removed member be blocked from rejoining? Today their own invite links are revoked on removal, but they can rejoin with any other active link. Raised in Phase 6.                                                                 | Open      | Phase 17  |
| O8  | Can the owner remove a member whose balance isn't zero? **No:** the same rule as leaving (D13); removal needs a zero balance. Enforced in `remove_member`. Resolved 2026-11-11.                                                            | Confirmed | Phase 8   |

## Details

### D2 — Rounding

- **Equal split:** each person gets `floor(total / n)`. The leftover minor units are given out one at a time, in a fixed order (order of joining the household). Example: ₹100.00 split 3 ways is 33.34, 33.33, 33.33.
- **Percentage split:** percentages are stored as basis points (whole numbers) that must total exactly 10000. They are converted to amounts with the largest-remainder method, so the shares add up exactly to the total.
- **Custom split:** amounts must add up exactly to the total, in minor units.

### D5 — Invitations

- **Token:** 32 random bytes. Only its SHA-256 hash is stored. The raw link is shown once, when it's created.
- **Defaults:** expires after 7 days; can be used at most 10 times; can be revoked.
- **Joining:** requires signing in. Expiry, use limit, and revocation are checked in one transaction.
- **Expired or revoked link message:** "This invite is no longer valid — ask a household member for a new one."

### D9 — Settlements

- **Who can record:** only the payer or the recipient. The other party gets an in-app notification.
- **No editing:** a settlement can only be voided (`voided_at`, `voided_by`) and recorded again. The payer, the recipient, or the owner can void it.
- **Partial amounts:** allowed. The app warns if the amount is more than what's currently owed.
- **Wording:** "A recorded a payment of ₹500 to B."
- **Notice:** every settlement surface shows "Recorded in the app — no money is moved."

### D10 — Recurring bills

- **Patterns:** weekly, monthly, or yearly, repeating every N periods.
- **Short months:** a monthly bill due on the 29th–31st falls on the last day of shorter months.
- **No duplicates:** `unique(recurring_bill_id, recurrence_period)` on expenses.
- **Edits:** apply to future periods only. Expenses already recorded are not changed.
- **Disabling:** stops future reminders.

### D16 — Palette contrast

These are approximate values, hand-calculated in Phase 1. They will be checked again with a contrast tool in Phase 2.

| Colour                                                                      | Contrast vs white | Meets AA 4.5:1 for normal text? |
| --------------------------------------------------------------------------- | ----------------- | ------------------------------- |
| Primary `#4F7CAC`                                                           | ≈ 4.4:1           | No (passes for large text)      |
| Danger `#EF4444`                                                            | ≈ 3.8:1           | No                              |
| Secondary `#7FB069`, accent `#F4A259`, success `#22C55E`, warning `#F59E0B` | ≈ 2–2.4:1         | No                              |
| Text `#2D3748` on background `#FAF8F5`                                      | High              | Yes                             |
