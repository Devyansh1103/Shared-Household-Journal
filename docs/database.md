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

## Tables and columns (Phase 6)

| Table / column            | Purpose                                     | Key constraints                                                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `households.creation_key` | Makes `create_household` idempotent         | Unique per (`created_by`, `creation_key`) when not null. The create form sends a fresh uuid per page visit, so a repeated submission returns the first household.                                                                                  |
| `activity_events`         | Append-only household journal (feed UI: 13) | `type` enum `activity_event_type`, `entity_type` enum `activity_entity_type`, `summary` must be a JSON object (ids and minimal context only, no emails or tokens). `actor_id` is null only for changes made outside a user session (service role). |

Events written so far: `household_created`, `member_joined`, `member_left`, `member_removed`,
`ownership_transferred` (from the functions below) and `invitation_created`, `invitation_revoked`
(from the `invitations_log_activity` trigger). A `before update or delete` trigger rejects every
change, for every role, except the cascade from deleting the household itself.

## Functions (Phase 6)

All are `SECURITY DEFINER` with `search_path = ''`, executable by `authenticated` only (EXECUTE is
revoked from `anon` and `public`). Each takes the caller from `auth.uid()`, never from an argument.

| Function                                                              | Who                     | What                                                                                                                                                                     |
| --------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create_household(household_name, currency, time_zone, request_key?)` | Any signed-in user      | Inserts the household and the caller's `owner` membership in one transaction. A repeated `request_key` returns the existing household.                                   |
| `get_invite_preview(token)`                                           | Any signed-in user      | `valid` + household name + inviter's display name; `member` + household id if already in; otherwise `invalid` with nothing else.                                         |
| `accept_invite(token)`                                                | Any signed-in user      | Locks the invite row, checks revocation, expiry and use limit, inserts a `member` row, increments `use_count`. Already a member: returns the household, consumes no use. |
| `leave_household(household_id)`                                       | Active non-owner member | Sets `left_at`, revokes the leaver's still-active invites. The owner gets `HJ002`.                                                                                       |
| `remove_member(household_id, user_id)`                                | Owner                   | Sets the member's `left_at`, revokes their still-active invites.                                                                                                         |
| `transfer_ownership(household_id, user_id)`                           | Owner                   | Demotes the caller to `member`, promotes the target (an active member) to `owner`.                                                                                       |
| `delete_household(household_id)`                                      | Owner, only member left | Deletes the household (D14). Memberships, invitations and events cascade.                                                                                                |

Invite tokens: 32 random bytes as unpadded base64url (43 characters). The app stores
`sha256(raw bytes)` as hex; `private.invite_token_hash(token)` computes the same hash on redemption,
so the raw token never needs to reach the database and the stored hash can't be used to join.

Error codes (mapped to messages in `src/lib/households/errors.ts`): `HJ001` invite not valid,
`HJ002` owner must transfer first, `HJ003` target isn't an active member, `HJ004` other members
remain, `HJ005` can't target yourself, `42501` not signed in / not a member / not the owner.

Deletion behaviour:

- `households` → `household_members`, `invitations`, `activity_events`: **cascade** (D14: deleting a household is permanent).
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
| `households`        | Active members                                               | No (`create_household`)                                                     | Owner; `name`, `currency_code`, `timezone` only                         | No     |
| `household_members` | Active members of that household (all rows, incl. left)      | No (functions only)                                                         | No                                                                      | No     |
| `activity_events`   | Active members                                               | No (functions and triggers only)                                            | No                                                                      | No     |
| `invitations`       | Active members                                               | Active members; `household_id`, `token_hash`, `expires_at`, `max_uses` only | Set `revoked_at` on an unrevoked invite: its creator, or the owner (D4) | No     |

"No" means there is no policy **and** no table privilege, so the request fails with `42501`.
Column-level grants stop an allowed row update from also changing ids, creators or counters.

Members who leave or are removed lose access immediately, because every check requires `left_at is null`.

## Not built yet

- **D13 zero-balance check in `leave_household`.** No balances exist until expenses do, so every
  balance is zero today. It must be added to `leave_household` with the expenses table (Phase 8/9).
- Invitation caps (O6, still Open): the DB enforces `max_uses > 0` and expiry after creation, but no
  upper bound. The app always uses the defaults (7 days, 10 uses) and offers no other values, but a
  member calling the Data API directly can still insert other values, as since Phase 4.
- Currency lock once an expense exists (Phase 8).
