# Database

Schema and access rules as built. The planned model for later phases is in
[requirements-notes.md](requirements-notes.md) §3–§4; this file describes only what exists.

- **Provider:** Supabase (Postgres 17, Auth, PostgREST), local in Docker (A3, A4).
- **Migrations:** [supabase/migrations/](../supabase/migrations/). Additive only.
- **Generated types:** [src/lib/supabase/database.types.ts](../src/lib/supabase/database.types.ts), from `npm run db:types`. Never edit by hand.
- **RLS tests:** [supabase/tests/](../supabase/tests/), run with `npm run test:db`.

## Local workflow

| Command             | Purpose                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `npm run db:start`  | Start local Supabase (needs Docker). A fresh database applies all migrations. |
| `npm run db:status` | Show local URLs. Also prints local keys, so don't paste its output anywhere.  |
| `npm run db:types`  | Regenerate `database.types.ts` from the local database.                       |
| `npm run test:db`   | RLS and constraint tests against the local stack.                             |
| `npm run db:stop`   | Stop the stack. Local data is kept for the next start.                        |

New migrations: `npx supabase migration new <name>`, then apply locally with
`npx supabase migration up`. Nothing in this repo links to or pushes to a hosted project (O1).

## Tables (Phase 4)

| Table               | Purpose                    | Key constraints                                                                                                                                                                                                                                     |
| ------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`          | One row per auth user      | `id` → `auth.users` (**restrict**, see D14 below). `display_name` 1–80 chars, trimmed. No email column.                                                                                                                                             |
| `households`        | The authorization boundary | `currency_code` `^[A-Z]{3}$`, default `INR` (D1). `timezone` must be in `pg_timezone_names` (D11). `created_by` → `profiles`.                                                                                                                       |
| `household_members` | Membership history         | `role` enum `owner`/`member` (D3). One active row per user per household; at most one active owner (partial unique indexes); an owner can't have `left_at`; at least one active owner while there are active members (deferred constraint trigger). |
| `invitations`       | Invite links (D5)          | `token_hash` unique, lowercase hex SHA-256. Defaults: expires in 7 days, `max_uses` 10. `0 ≤ use_count ≤ max_uses`. `created_by` defaults to `auth.uid()`.                                                                                          |

Deletion behaviour:

- `households` → `household_members`, `invitations`: **cascade** (D14: deleting a household is permanent).
- Everything → `profiles`, and `profiles` → `auth.users`: **restrict**. Deleting an auth user fails while
  their profile exists. The anonymising account-deletion flow is Phase 18 (D14).

Triggers:

- `on_auth_user_created` (on `auth.users`) creates the profile. The name comes from sign-up metadata
  `display_name`, falling back to "New member". It never uses the email.
- `*_set_updated_at` maintains `updated_at`.

Money: no money columns exist yet. When they arrive (Phase 8 onwards) they are `bigint` minor units
with the `_minor` suffix (D2, ADR-003). The currency lock (D1) is added with the expenses table.

## Access control

RLS is enabled on every table, with deny by default. Policies apply to `authenticated` only. `anon` has
no table privileges at all. `service_role` bypasses RLS and is for tests and future server-only
admin tasks; it is never sent to the browser.

Helpers live in the `private` schema, which the Data API does not expose. All are `SECURITY DEFINER`,
`stable`, with `search_path = ''`, and they look only at the caller's own membership:

- `private.is_household_member(household_id)`: caller has an active membership.
- `private.household_role(household_id)`: caller's active role, or null.
- `private.shares_household_with(user_id)`: the user has (or had) a membership in a household where
  the caller is active. Used by `profiles`.

| Table               | Select                                                       | Insert                                                                      | Update                                                                  | Delete |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| `profiles`          | Self, and anyone who shares (or shared) a household with you | Trigger only                                                                | Self; `display_name`, `avatar_url` only                                 | No     |
| `households`        | Active members                                               | No (Phase 6 `create_household`)                                             | Owner; `name`, `currency_code`, `timezone` only                         | No     |
| `household_members` | Active members of that household (all rows, incl. left)      | No (Phase 6 functions)                                                      | No                                                                      | No     |
| `invitations`       | Active members                                               | Active members; `household_id`, `token_hash`, `expires_at`, `max_uses` only | Set `revoked_at` on an unrevoked invite: its creator, or the owner (D4) | No     |

"No" means there is no policy **and** no table privilege, so the request fails with `42501`.
Column-level grants stop an allowed row update from also changing ids, creators or counters.

Members who leave or are removed lose access immediately, because every check requires `left_at is null`.

## Not built yet

- `create_household`, `accept_invite`, `leave_household` and the ownership transfer (Phase 6).
- Invitation caps: the DB enforces `max_uses > 0` and expiry after creation, but no upper bound.
  Whether D5's 7 days and 10 uses are caps or only defaults is decided in Phase 6.
- Currency lock once an expense exists (Phase 8).
