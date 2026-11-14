# Environment variables

The app reads **two** variables. Both are public by design (O4): they're compiled into the
JavaScript sent to browsers and identify the Supabase project, not grant access to it. What a
visitor may do is decided by RLS and the database functions, not by keeping these secret.

| Name                                   | Required | Where it's used                                     | Value                                                                                                                                             |
| -------------------------------------- | -------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Yes      | Every Supabase client (server, proxy, health check) | The project URL. `https://` (plain `http://` only for a local stack on `localhost`, `127.0.0.1` or `[::1]`), with no user name or password in it. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes      | The same clients                                    | The project's **publishable** key (`sb_publishable_…`), or the legacy anon key. Never a secret or service-role key.                               |

Names only are documented here and in [.env.example](../.env.example). Never commit or paste real
values, and never print them: `npm run db:status` prints the local secret keys too.

## Checks

[src/lib/env.ts](../src/lib/env.ts) checks the configuration; it names variables and never prints
their values.

- **When the app is built** ([next.config.ts](../next.config.ts)): the build stops if
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` holds a secret key (an `sb_secret_…` key, or a JWT whose
  role is `service_role`), or if any non-empty `NEXT_PUBLIC_` variable's name contains `SECRET`,
  `SERVICE_ROLE`, `PRIVATE`, `PASSWORD` or `TOKEN`. Anything public would be compiled into every
  browser's JavaScript.
- **When the server starts** ([src/instrumentation.ts](../src/instrumentation.ts)): the same
  checks, plus both variables present and the URL valid as described above. The server doesn't
  start otherwise, with a message such as:

  ```text
  The app's configuration isn't safe to run:
  - NEXT_PUBLIC_SUPABASE_URL must use https:// (http:// is allowed only for a local stack).
  See .env.example and docs/environment.md.
  ```

## Secrets

- **The Supabase secret (service-role) key** bypasses RLS. The app never reads it, and it must
  never be set in Vercel or in any `NEXT_PUBLIC_` variable. Only an operator uses it, from their
  own computer, for account deletion ([operations.md](operations.md#deleting-an-account-d14)). If
  it may have leaked, rotate it in the Supabase dashboard.
- **The database password** is for operators (migrations with the Supabase CLI). The app doesn't
  use it.
- **SMTP credentials** live only in the Supabase project's Auth settings.

## Per environment

| Environment       | Where the values live                                                                                                             | Supabase project                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Local development | `.env.local` (gitignored, like every `.env*` except `.env.example`)                                                               | The local stack (`npm run db:start`); values from `npm run db:status` |
| Tests             | `npm test`: none. `npm run test:db` and `npm run test:e2e` read the local keys from `supabase status` at run time, in memory only | The local stack                                                       |
| Vercel Preview    | Vercel project settings, Preview scope                                                                                            | A separate staging project                                            |
| Vercel Production | Vercel project settings, Production scope                                                                                         | The production project                                                |

Changing a variable in Vercel takes effect with the next deployment.
