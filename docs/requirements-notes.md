# Requirements Notes — Amendments to the PRD and TRD

`Roommate_PRD.pdf` and `Roommate_TRD.pdf` (Draft v2) stay unchanged as the original sources. Where this file conflicts with them, **this file takes precedence**.

Everything here was confirmed on 2026-11-02 unless it is marked Open or Proposed.

## PRD amendments

### §7 Product design direction

- The palette stays, but its colours are used as fills, icons, and large text.
- Body-size text and white-on-fill text use darker shades that meet WCAG AA 4.5:1 (D16).
- **Typeface:** Plus Jakarta Sans.
- Light mode only.

### §9 Delivery phases

Replaced by [roadmap.md](roadmap.md).

### §11 Open decisions

Resolved in [decisions.md](decisions.md), except the items that list marks as Open:

- hosting
- data-retention periods
- budget edit permission

## TRD amendments

### §1 Architecture

Confirmed:

- Next.js App Router
- TypeScript (strict)
- npm
- Supabase (Postgres, Auth, RLS)
- Tailwind
- shadcn/ui
- lucide icons
- Zod
- Vitest and Playwright

No state-management library. See [ADR-001](adr/001-stack.md) and [ADR-002](adr/002-supabase-rls.md).

### §3 Domain model

Every table has a uuid `id`, `created_at`, and `updated_at` where relevant.

"M" means an **active member of the same household**. Tables are added in the phase that needs them (see the roadmap).

| Table                      | Key fields and constraints                                                                                                                                                                                                                                                | Access                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `profiles`                 | One row per auth user. `display_name`, `avatar_url`. Email is never shown to other members.                                                                                                                                                                               | Self, plus people who share a household with you                         |
| `households`               | `name`, `currency_code` (ISO 4217; locked once an expense exists), `timezone` (IANA), `created_by`                                                                                                                                                                        | M can read; owner can update                                             |
| `household_members`        | `household_id`, `user_id`, `role` (`owner`/`member`), `joined_at`, `left_at`. One active membership per user per household. Exactly one active owner.                                                                                                                     | M can read; changed only through functions                               |
| `invitations`              | `token_hash` (unique), `created_by`, `expires_at`, `max_uses`, `use_count`, `revoked_at`                                                                                                                                                                                  | M can read (never the raw token) and create; creator or owner can revoke |
| `expenses`                 | `description`, `amount_minor` bigint > 0, `category`, `expense_date` date, `paid_by`, `split_method` (`equal`/`percentage`/`custom`), `created_by`, `deleted_at`, `deleted_by`, `recurring_bill_id`, `recurrence_period`. `unique(recurring_bill_id, recurrence_period)`. | M; writes through functions                                              |
| `expense_splits`           | Primary key (`expense_id`, `user_id`). `share_minor` ≥ 0. `percentage_bp` only for percentage splits. Shares must add up to `amount_minor`.                                                                                                                               | M; writes through functions                                              |
| `settlements`              | `from_user`, `to_user` (must differ), `amount_minor` > 0, `settled_on` date, `note`, `recorded_by` (must be `from_user` or `to_user`), `voided_at`, `voided_by`                                                                                                           | M can read; write and void through functions                             |
| `activity_events`          | `actor_id`, `type`, `entity_type`, `entity_id`, `summary` (jsonb, minimal data). Append-only.                                                                                                                                                                             | M can read; no one can update or delete                                  |
| `recurring_bills`          | `description`, `amount_minor`, `category`, payer, default split, `frequency` (`week`/`month`/`year`), `interval`, `anchor_date`, `active`                                                                                                                                 | M                                                                        |
| `shopping_items`           | `name`, `quantity` (text), `added_by`, `purchased_at`, `purchased_by`                                                                                                                                                                                                     | M                                                                        |
| `chores`                   | `title`, `assignee_id`, `due_date`, `completed_at`, `completed_by`. One-off chores only for the first release.                                                                                                                                                            | M                                                                        |
| `budgets`                  | `category` (null means the overall budget), `monthly_limit_minor`. Unique per household and category.                                                                                                                                                                     | M can read; edit rights are Open (O3, proposed owner only)               |
| `notifications`            | `user_id`, `activity_event_id`, `read_at`                                                                                                                                                                                                                                 | That user only                                                           |
| `notification_preferences` | (`user_id`, `household_id`, `type`) → enabled                                                                                                                                                                                                                             | That user only                                                           |

#### Money rules

- **Representation:** amounts are integer minor units ([ADR-003](adr/003-money-representation.md)). Rounding follows [ADR-004](adr/004-split-rounding.md).
- **Pairwise balances:** each participant in a non-deleted expense owes the payer their share. A non-voided settlement from A to B reduces what A owes B.
- **Net balance** = paid − shares + settlements paid − settlements received. Within a household, net balances add up to zero.
- **Edits and deletes:** balances are always recalculated from the records. The journal keeps the old and new values. Deleted and voided rows stay visible but don't count.

### §4 Security model

1. **RLS on every table**, with deny as the default.
2. **Helper functions:** `is_household_member(household_id)` and `household_role(household_id)`. Both are `SECURITY DEFINER`, have a fixed `search_path`, and check only `auth.uid()`.
3. **Writes through functions:** all money and membership changes go through Postgres functions ([ADR-006](adr/006-atomic-writes.md)).
   - Inside these functions, the payer and every participant must be active members of the same household.
   - Only `create_household` and `accept_invite` use elevated rights, and both check the caller explicitly.
4. **Owner-only actions** are enforced in policies and functions, not just hidden in the UI.
5. **Invite tokens:** 32 random bytes, stored only as a SHA-256 hash. Expiry, use limit, and revocation are checked in a single transaction.
6. **Input validation:** Zod at the Server Action boundary, plus database constraints.
7. **Keys:** only the Supabase URL and public key are sent to the browser. The service-role key is never exposed to the client and is not used for normal requests. `.env*` files are gitignored; only `.env.example` is committed. The exact variable name for the public key is Open (O4).
8. **Auth checks:** sessions are checked on the server. Middleware only refreshes sessions and never makes authorization decisions.
9. **Tests:** two households and three users. Cross-household select, insert, update, and delete must be denied on every table, and removed members must lose access ([ADR-012](adr/012-testing.md)).

### §5 Money logic

Rounding is defined in [ADR-004](adr/004-split-rounding.md):

- **Equal:** floor each share, then give the remainder out in the order members joined.
- **Percentage:** basis points that add up to 10000, allocated with the largest-remainder method.
- **Custom:** shares must add up exactly to the total.

### §9 Workflow — Git rules

- Commits use the owner's git identity only.
- No AI co-author trailers or tool attribution in commits, pull requests, or repository files.
- Local commits are allowed. Only the owner pushes.

### §12 Unconfirmed technical decisions

Resolved in [decisions.md](decisions.md), except:

- O1: hosting
- O2: data retention
- O3: budget edit permission
- O4: Supabase key naming
- O5: React Hook Form
