# Authentication and profiles

Built in Phase 5. Supabase Auth with email and password (A3), sessions in cookies through
`@supabase/ssr` (ADR-002). Decisions: O4, D20, D21, D22 in [decisions.md](decisions.md).

## How it fits together

| Piece                                                             | Role                                                                                                                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/proxy.ts](../src/proxy.ts)                                   | Refreshes the session cookie on every request and passes the requested path on as `x-return-path`. **Never** decides access.                                |
| [src/lib/auth/session.ts](../src/lib/auth/session.ts)             | The session check. `getCurrentUser()` asks Supabase Auth (`getUser()`), `requireUser()` redirects to sign-in, `getMyProfile()` reads the profile under RLS. |
| [src/lib/supabase/server.ts](../src/lib/supabase/server.ts)       | Per-request Supabase client acting as the signed-in user. There is no browser client yet.                                                                   |
| [src/app/(auth)/actions.ts](<../src/app/(auth)/actions.ts>)       | Server Actions: sign in, sign up, request a password reset.                                                                                                 |
| [src/app/(app)/actions.ts](<../src/app/(app)/actions.ts>)         | Server Actions: sign out, update profile, set a new password. Each re-checks the user itself.                                                               |
| [src/app/auth/confirm/route.ts](../src/app/auth/confirm/route.ts) | Target of email links. Exchanges the token hash for a session.                                                                                              |
| [src/lib/auth/](../src/lib/auth/)                                 | Zod schemas, error messages, the safe return-path helper. Unit-tested.                                                                                      |

## Routes

| Route                                                                         | Access    | Purpose                                                                                       |
| ----------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------- |
| `/`                                                                           | Public    | Landing page with "Create an account" and "Sign in".                                          |
| `/sign-up`                                                                    | Public    | Name, email, password. Ends with "check your email".                                          |
| `/sign-in`                                                                    | Public    | Email and password. Honours a safe `?next=`. Signed-in visitors are sent on.                  |
| `/forgot-password`                                                            | Public    | Requests a reset link. Always the same neutral answer.                                        |
| `/auth/confirm`                                                               | Public    | Email link handler (`type=email` → `/home?confirmed=1`, `type=recovery` → `/reset-password`). |
| `/home`                                                                       | Signed in | Welcome page and the list of your households (or an empty state).                             |
| `/households/new`                                                             | Signed in | Create a household (name, currency, timezone). Phase 6.                                       |
| `/households/[id]`                                                            | Member    | Household overview: details, members, invite links, leave/delete. Non-members get a 404.      |
| `/invite/[token]`                                                             | Public    | Signed out: asks to sign in, reveals nothing. Signed in: preview and "Join household".        |
| `/households/[id]/expenses` (and `/new`, `/[expenseId]`, `/[expenseId]/edit`) | Member    | Expenses (Phase 8). Non-members get a 404. Edit/delete per D6; restore for the owner.         |
| `/profile`                                                                    | Signed in | Edit display name. Shows your own email (read-only).                                          |
| `/reset-password`                                                             | Signed in | Set a new password (reached from the recovery email).                                         |

Signed-in routes live in the `(app)` route group. Its layout renders the page only after
`requireUser()` succeeds on the server. Because of `cacheComponents`, that check sits inside a
`<Suspense>` boundary, so a signed-out request gets a streamed redirect (a 200 response that
contains a `<meta refresh>` and a client redirect, with no protected content), not an HTTP 307.

## Security boundaries

- **Authorization is on the server.** The `(app)` layout, each page that reads data, and each
  Server Action call `requireUser()`. Database access then runs under RLS as that user. Hiding a
  link is never the protection.
- **User ids come from the session.** The profile update uses the id from `getUser()`, never
  from the form. RLS (`profiles` update policy and column grants) enforces the same.
- **Sessions:** cookies set by `@supabase/ssr`, `SameSite=Lax`, path `/`. They aren't `HttpOnly`;
  that's the library's design, so a future browser client can read them. Access tokens last 1 hour
  (`jwt_expiry`); refresh tokens rotate.
- **Sign-out** ends this device's session on the server (`scope: "local"`) and clears the cookies.
  `getUser()` then rejects the old access token.
- **Return paths:** `safeReturnPath()` allows only same-origin paths. It rejects `//host`,
  backslashes, control characters, absolute URLs and auth pages.
- **Account existence:** sign-in says "Email or password is incorrect." for both cases. Sign-up
  and password reset show the same message whether or not the account exists.
- **Errors:** Supabase error codes map to plain messages in `src/lib/auth/errors.ts`. Raw
  provider messages and stack traces are never shown.
- **Keys:** the app reads only `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. No service-role or secret key is used.

## Local setup

1. `npm run db:start` (Docker). Mailpit, which catches all Auth emails, runs at
   http://127.0.0.1:54324.
2. Copy `.env.example` to `.env.local` and fill in the API URL and publishable key from
   `npm run db:status`. Don't paste the status output anywhere: it also prints secret keys.
3. `npm run dev` and open http://localhost:3000. Email links point at `localhost:3000`
   (`site_url`), so use `localhost` rather than `127.0.0.1`, or the session cookie lands on the other host.

Local Auth settings live in [supabase/config.toml](../supabase/config.toml):
`enable_confirmations = true`, `minimum_password_length = 8`, `secure_password_change = true`, and
custom templates in [supabase/templates/](../supabase/templates/).

## Hosted project checklist (O1, not done)

`config.toml` only configures the local stack. A hosted Supabase project needs the same settings in
its dashboard:

- Site URL set to the production origin; email confirmations on; minimum password length 8;
  secure password change on.
- The confirmation and recovery templates from `supabase/templates/` (they link to
  `/auth/confirm?token_hash=…`).
- Custom SMTP. The built-in sender is heavily rate-limited and not meant for production.

## Known limitations

- **The Auth API itself reveals duplicate sign-ups.** Supabase Auth (local v2.197) answers a
  sign-up for an existing email with `user_already_exists`. The app hides this, but anyone calling the
  Auth API directly with the publishable key can tell whether an email is registered.
- **Email link scanners** that open links automatically can use up a one-time token before the
  person clicks it. They then see "That link is invalid or has expired" and can request a new one.
- **No resend button.** Signing up again with the same address sends a new confirmation link.
- **Account deletion and email change** are not built (D14, Phase 18; D22).
- Changing your password while signed in is only reachable through the recovery email. With
  `secure_password_change` on, Supabase requires re-authentication for a password change from a
  session that wasn't started recently. A fresh recovery session passes (tested in
  `supabase/tests/auth.test.ts`); the exact window is Supabase's and isn't tested here.
