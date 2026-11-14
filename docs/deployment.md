# Deployment guide

**Hosting (O1, decided by the owner on 2026-11-14): Vercel for the app, a hosted Supabase project
for the database and Auth** ([ADR-013](adr/013-hosting.md)). Nothing has been deployed yet: this is
the procedure for whoever does it. It needs accounts and settings only the owner can create, and
nothing here is automated.

Related: [environment.md](environment.md), [migrations.md](migrations.md),
[operations.md](operations.md), [backup-recovery.md](backup-recovery.md),
[production-readiness.md](production-readiness.md).

## What you need

- A Supabase organisation, and a plan with daily backups for the production project (see
  [backup-recovery.md](backup-recovery.md)).
- A Vercel account with access to the GitHub repository.
- An SMTP service for Auth emails (confirmation and password reset), with a sending address on a
  domain you control.
- Optional: your own domain.
- Locally: Node 22 and npm (the repository's `engines`), and the Supabase CLI, which is a dev
  dependency (`npx supabase`).

Use a **separate Supabase project for staging** (and for Vercel preview deployments), never the
production one.

## 1. Create the Supabase project

1. Create the project in the region nearest your households (for example Mumbai for India). Keep
   the database password in a password manager.
2. From the project's API settings, note the **project URL** and the **publishable key**. Those two
   are all the app needs. The **secret (service-role) key** is never given to the app or to Vercel;
   only an operator uses it, for account deletion ([operations.md](operations.md#deleting-an-account-d14)).

## 2. Apply the database migrations

```sh
npx supabase login
npx supabase link --project-ref <project ref>
npx supabase db push --dry-run   # lists the migrations it would apply; read the list
npx supabase db push
```

All 16 migrations in `supabase/migrations/` apply in order. They are additive (they create, never
drop or rewrite data). Never run `supabase db reset` against a hosted project: it wipes it. See
[migrations.md](migrations.md) for later releases.

Then check the result in the dashboard's SQL editor (read-only queries):

```sql
-- Expect no rows: every table has RLS.
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- Expect exactly one row, health_check: the only function a signed-out visitor may run.
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'EXECUTE');
```

## 3. Configure Auth

`supabase/config.toml` configures only the local stack. In the hosted project:

| Setting (Authentication)        | Value                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Site URL                        | The production origin, e.g. `https://your-domain.example` (email links are built from it)                   |
| Redirect URLs                   | The production origin (and the staging one in the staging project)                                          |
| Email provider                  | On, with **Confirm email** on (D20)                                                                         |
| Secure password change          | On                                                                                                          |
| Minimum password length         | 8 (D22, proposed)                                                                                           |
| Access token (JWT) expiry       | 3600 seconds (the default; the account deletion runbook assumes it)                                         |
| Refresh token rotation          | On (the default), reuse interval 10 seconds                                                                 |
| Email templates: Confirm signup | Subject "Confirm your email for Shared Household Journal", body from `supabase/templates/confirmation.html` |
| Email templates: Reset password | Subject "Reset your Shared Household Journal password", body from `supabase/templates/recovery.html`        |

Both templates link to `{{ .SiteURL }}/auth/confirm?token_hash=…`, which the app handles; the
default templates' links don't work with it. Sign-ups through other providers, phone and anonymous
sign-ins stay off.

### Email

Set up custom SMTP (Authentication → SMTP settings) before anyone signs up. Supabase's built-in
sender is limited to a few messages an hour and is meant for testing only. Set the sender address,
and the domain's SPF and DKIM records as your SMTP service describes, so the messages aren't
treated as spam.

### Security settings

- **Turn off GraphQL** (S8): remove `graphql_public` from the Data API's exposed schemas, leaving
  `public`. The app doesn't use it.
- **Rate limits** (S4): review Authentication → Rate limits, and add rate-limit rules in Vercel's
  Firewall for `POST` requests to `/sign-in`, `/sign-up` and `/forgot-password`. Supabase counts
  per IP address, and those calls come from the app's servers. Consider Supabase Auth's CAPTCHA
  support for sign-up.
- **Leaked-password protection:** turn it on if the plan offers it (I3).
- **Database network restrictions:** the app reaches the database only through the HTTPS Data API,
  so direct Postgres connections can be limited to operators' addresses. Keep SSL enforced.
- Keep the Data API's maximum rows at 1000 (every list in the app is paged below that).

## 4. Create the Vercel project

1. Import the repository. Vercel detects Next.js and npm (from `package-lock.json`); keep the
   default build (`next build`) and output settings.
2. Node.js version: 22.x (from `engines` in `package.json`).
3. Environment variables, for **Production** (and, pointing at the staging project, **Preview**):

   | Name                                   | Value                         |
   | -------------------------------------- | ----------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`             | The project URL (`https://…`) |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The publishable key           |

   Nothing else. The build stops if a secret key is put in a public variable, and the server
   refuses to start with a missing or invalid value ([environment.md](environment.md)).

4. Set the functions' region next to the Supabase project's region (Project settings →
   Functions). Every page makes a few database calls, so distance adds up.

## 5. Domain and HTTPS

Add the domain in Vercel and create the DNS records it shows; Vercel issues and renews the
certificate and redirects HTTP to HTTPS. The app adds HSTS (two years) itself. Session cookies are
`Secure` in production, so the app must be served over HTTPS (browsers make an exception only for
`localhost`). Then set Supabase's Site URL and Redirect URLs to the final domain.

## 6. Deploy and check

Deploy, then go through this list on the production URL:

1. `curl -i https://<domain>/api/health` → `200` and `{"status":"ok","database":"ok"}`.
2. `curl -sI https://<domain>/sign-in` shows `content-security-policy`, `x-frame-options: DENY`,
   `strict-transport-security`, and no `x-powered-by`.
3. Sign up with a real address, receive the email, open the link: you arrive at Home, confirmed.
4. In the browser's developer tools, the `sb-…-auth-token` cookie is `HttpOnly` and `Secure`, and
   the console shows no Content Security Policy errors.
5. Create a household, invite a second account and join with it, add an expense, record the
   payment back, and see the balances settle.
6. Request a password reset and complete it.
7. The host's logs show no `"event":"request_error"` lines.
8. Set up the monitoring in [operations.md](operations.md#monitoring).

## Rolling back

- **The app:** in Vercel, promote the previous production deployment (instant). The database
  stays as it is: because migrations are additive, the previous version keeps working with it.
- **The database:** never edit or remove an applied migration; fix forward with a new one
  ([migrations.md](migrations.md)). Restoring a backup is the last resort, since it loses
  everything recorded since ([backup-recovery.md](backup-recovery.md)).

## Troubleshooting

| Problem                                                  | Cause and fix                                                                                                          |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Build fails: "The app's configuration isn't safe to run" | A secret is in a `NEXT_PUBLIC_` variable. Remove it, and rotate that key in Supabase, since it may have been exposed.  |
| Every request fails at start with the same message       | A variable is missing or invalid; the message names it. Fix it in Vercel and redeploy (changes need a new deployment). |
| `/api/health` answers `degraded`                         | The project is paused or unreachable, or the URL or key is wrong.                                                      |
| Email links go to "That link is invalid or has expired"  | The link was used already (some mail scanners open links), is over an hour old, or the Site URL is wrong.              |
| Signed out straight after signing in                     | The site is served over plain HTTP: `Secure` cookies are never sent back. Use HTTPS.                                   |
| No emails arrive                                         | Custom SMTP isn't set, or the sender domain isn't verified; check the Auth logs.                                       |
