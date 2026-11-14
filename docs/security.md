# Security audit (roadmap Phase 18)

An internal review of the app before deployment, done on 2026-11-14 against the local stack and a
production build. It is **not** a certification, a penetration test by a third party, or a
compliance assessment. Every "Verified" below points at a test or a command that can be re-run.

Related: [production-readiness.md](production-readiness.md) (the checklist),
[known-limitations.md](known-limitations.md), [testing.md](testing.md),
[operations.md](operations.md).

## Scope and method

- **Code:** every page, layout, Route Handler and Server Action under `src/app` (48 entry points:
  43 check the session with `requireUser()`; 5 are public by design: sign in, sign up, request a
  password reset, the email-link handler `GET /auth/confirm`, and sign out), the proxy, the
  Supabase clients, and the Zod schemas at each Server Action.
- **Database:** all 16 migrations, the catalog (RLS, table, column and function privileges,
  `SECURITY DEFINER` settings, default privileges), and every one of the 47 functions in `public`.
- **Attacks run as tests:** another household's ids against every function and table (an outsider,
  a former member and a signed-out visitor), an ordinary member trying the owner's actions, and
  people from another household used inside your own
  ([supabase/tests/authorization.test.ts](../supabase/tests/authorization.test.ts)).
- **Money:** a seeded random run of 120 operations with the books checked against the raw rows
  ([supabase/tests/financial-invariants.test.ts](../supabase/tests/financial-invariants.test.ts)).
- **Browser:** response headers, cookies and Content Security Policy violations in a real browser
  ([e2e/workflows.spec.ts](../e2e/workflows.spec.ts)), and a sweep of every page at six widths.
- **Dependencies:** `npm audit`.

## Summary

| Severity      | Found | Fixed in this phase | Open (documented)                   |
| ------------- | ----- | ------------------- | ----------------------------------- |
| Critical      | 0     | —                   | —                                   |
| High          | 0     | —                   | —                                   |
| Medium        | 4     | 3 (S1, S2, S3)      | 1 (S4, needs hosting configuration) |
| Low           | 7     | 3 (S5, S7, S10)     | 4 (S6, S8, S9, S11)                 |
| Informational | 6     | 1 (I1)              | 5                                   |

No finding allowed one household to read or change another's data, and none allowed money records
to stop adding up.

## Findings

### Medium

**S1 — No security headers.** Responses had no Content Security Policy, framing protection,
`nosniff`, referrer policy, HSTS or permissions policy.
_Fixed:_ [next.config.ts](../next.config.ts) sends on every response:

| Header                       | Value                                                                                                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Content-Security-Policy`    | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` (plus `'unsafe-eval'` in `next dev` only) |
| `X-Frame-Options`            | `DENY`                                                                                                                                                                                                                                                                               |
| `X-Content-Type-Options`     | `nosniff`                                                                                                                                                                                                                                                                            |
| `Referrer-Policy`            | `strict-origin-when-cross-origin` (invite tokens are in the path; this keeps them on this origin)                                                                                                                                                                                    |
| `Permissions-Policy`         | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()`                                                                                                                                                                                                   |
| `Cross-Origin-Opener-Policy` | `same-origin`                                                                                                                                                                                                                                                                        |
| `Strict-Transport-Security`  | `max-age=63072000` (two years; browsers ignore it over plain HTTP)                                                                                                                                                                                                                   |

The policy allows inline scripts and styles. Next.js's documented alternative, a per-request nonce,
needs every page rendered on each request, which Partial Prerendering (`cacheComponents`) rules out.
What keeps scripts out instead: React escapes all output, there is no `dangerouslySetInnerHTML`,
`eval` or third-party script anywhere in `src`, and the policy still stops scripts, frames, forms
and connections to any other origin. _Evidence:_ the headers test in `e2e/workflows.spec.ts`; no
CSP violation in any e2e test or on any of the 37 pages at six widths (see
[production-readiness.md](production-readiness.md)).

**S2 — The session cookie could be read by scripts and sent over HTTP.** `@supabase/ssr` sets
`HttpOnly: false` and no `Secure` flag by default (so a browser client could read it). This app
never talks to Supabase from the browser.
_Fixed:_ `AUTH_COOKIE_OPTIONS` in [src/lib/supabase/config.ts](../src/lib/supabase/config.ts),
used by both clients that set cookies (the proxy and the server client): `HttpOnly`, `Secure` in
production, `SameSite=Lax`, path `/`. A script injected into a page can no longer read the session.
_Evidence:_ workflow A in `e2e/workflows.spec.ts` checks every `sb-` cookie, and that
`document.cookie` shows none of them.

**S3 — Accounts couldn't be deleted (D14).**
_Fixed:_ an operator procedure, as the owner decided: the person leaves every household (the
app's own rules, D13), the sign-in is removed with Supabase Auth's soft delete, and
`private.anonymise_account()` turns the profile into "Former member" and removes their
notifications and settings. Only the service role can run it; it is not reachable through the
Data API. See [operations.md](operations.md#deleting-an-account-d14). _Evidence:_
[supabase/tests/operations.test.ts](../supabase/tests/operations.test.ts).

**S4 — No rate limiting of our own.** Sign-in, sign-up and password reset rely on Supabase
Auth's rate limits, which count **per IP address**. These calls run on the app's server, so in
production they count the server's addresses, not each visitor's: one busy visitor can use up the
limit for everyone, and the limit doesn't slow down one attacker in particular. Other Server
Actions and pages have no limit beyond the host's.
_Open: needs hosting configuration before launch._ Add rate-limit rules at the edge (Vercel
Firewall) for `POST` requests to `/sign-in`, `/sign-up` and `/forgot-password`, review the Auth
rate limits in the hosted project, and consider Supabase Auth's CAPTCHA support. See
[deployment.md](deployment.md#security-settings).

### Low

**S5 — Production dependencies with advisories.** The `shadcn` CLI (a code generator, never
imported by the app) was listed under `dependencies`, which brought its subtree's advisories (2
low, 3 moderate, including `deepmerge` below) into the production tree.
_Fixed:_ moved to `devDependencies` (same version). _Evidence:_ `npm audit --omit=dev`: 0
vulnerabilities.

**S6 — Advisories in development tools.** `npm audit` (with dev dependencies) reports 13 (2 low,
11 moderate): `minimatch` (GHSA-g3hv-75wg-m249, denial of service on crafted glob patterns) through
`typescript-eslint` → `eslint-config-next`, and `deepmerge` (GHSA-gcqx-w48m-w2h4, prototype
poisoning) through the `shadcn` CLI. None of these packages is in the production build. The only
fixes npm offers are major downgrades (`eslint-config-next@15`, `shadcn@1`), which would be worse.
_Accepted:_ re-check with `npm audit` when updating those tools.

**S7 — No health check, configuration check or error logs.**
_Fixed:_

- `GET /api/health` answers `{"status":"ok","database":"ok"}` (200) or `degraded` (503), never
  cached, and reveals no versions, configuration or timings. It calls `public.health_check()`,
  the only function a signed-out visitor may run, which reads no table.
- [src/instrumentation.ts](../src/instrumentation.ts) checks the configuration when the server
  starts ([src/lib/env.ts](../src/lib/env.ts)), and refuses to start with a missing or invalid
  Supabase URL, plain HTTP to anything but a local stack, or a secret in a public variable. The
  build ([next.config.ts](../next.config.ts)) refuses a secret in a public variable, so it can
  never be compiled into the browser's JavaScript. Problems name the variable, never its value.
- Server errors are logged as one JSON line (time, method, route, kind, error name and digest),
  without the error message, stack or anything from the request. A new
  [src/app/global-error.tsx](../src/app/global-error.tsx) shows "Something went wrong" with the
  digest as a reference, and says nothing was changed.

**S8 — Supabase's GraphQL endpoint is on.** The local stack exposes `graphql_public` (Supabase's
default). It is subject to the same RLS and privileges as the Data API, and the app doesn't use it.
_Open (recommendation):_ turn it off in the hosted project (remove `graphql_public` from the
exposed schemas). See [deployment.md](deployment.md#security-settings).

**S9 — An access token outlives sign-out and account deletion, at the Data API.** Supabase access
tokens are signed JWTs valid for their lifetime (1 hour, `jwt_expiry`). After sign-out or deletion
the Auth server rejects them at once (`session_not_found`), and the app checks every request with
`getUser()`, so **the app** stops serving that session straight away. Someone who copied their own
token out of the browser before it was revoked could still call the Data API directly until it
expires. With `HttpOnly` cookies (S2) a script can't copy it.
_Accepted:_ inherent to Supabase's stateless tokens. The account deletion runbook waits out the
token lifetime before anonymising, and the procedure refuses if the person has rejoined anything.

**S10 — Supabase's default privileges grant everything on new objects.** In the `public` schema,
each new table, sequence and function is granted to `anon` and `authenticated` in full unless the
migration revokes it (every migration so far does).
_Fixed:_ a catalog regression test fails if any table, column or function is granted beyond the
known set, if any table lacks RLS, if any view appears, or if any function lacks a pinned
`search_path` ([authorization.test.ts](../supabase/tests/authorization.test.ts), "the catalog").

**S11 — Supabase Auth's audit log keeps the email after deletion.** `auth.audit_log_entries`
keeps the address on sign-up, sign-in and deletion entries; the soft delete doesn't clear them.
_Open (operator decision):_ the runbook includes a statement to remove them, run only when the
operator decides to (it deletes data). See [operations.md](operations.md#deleting-an-account-d14).

### Informational

| ID  | Observation                                                                                                                                                                                                                                                                                                 | Status                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| I1  | `X-Powered-By: Next.js` was sent with every response.                                                                                                                                                                                                                                                       | Fixed (`poweredByHeader: false`) |
| I2  | No multi-factor authentication. Supabase Auth supports TOTP; nothing approved asks for it.                                                                                                                                                                                                                  | Not built                        |
| I3  | Leaked-password protection (checking new passwords against known breaches) is a hosted Supabase setting.                                                                                                                                                                                                    | Recommend enabling               |
| I4  | The Auth API answers a sign-up for an existing email with `user_already_exists`. The app hides it; a direct API caller can tell whether an email is registered ([auth.md](auth.md#known-limitations)).                                                                                                      | Known limitation                 |
| I5  | Unused PKCE code-verifier cookies are left after sign-up (`…-code-verifier`). They hold no session, are `HttpOnly`, and are useless once the email is confirmed by its token hash.                                                                                                                          | Harmless                         |
| I6  | `private.is_household_member`, `household_role` and `shares_household_with` are `SECURITY DEFINER` functions signed-in users can execute (RLS policies call them). Each answers only about the caller's own memberships, and the `private` schema isn't exposed through the Data API (checked: `PGRST106`). | By design                        |

## What was checked and held

| Area                         | Result                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Household isolation (IDOR)   | 48 attacks with another household's ids (every write and read function, direct table writes) by an outsider and by a former member: each refused with the expected code (`42501`, or the "no such …" code `HJ009`/`HJ014`/`HJ018`/`HJ026`/`HJ027`/`HJ031`, so ids of other households look like ids that don't exist); every row of the household unchanged, compared row by row. |
| Reads                        | Nothing of another household is readable from any of the 17 tables, its people's profiles, or notifications.                                                                                                                                                                                                                                                                      |
| Signed out                   | Every function but `health_check` and every table refuses `anon` (`42501`).                                                                                                                                                                                                                                                                                                       |
| Roles inside a household     | An ordinary member can't delete the household, transfer ownership, remove someone, restore an expense (owner only, D7), change or delete someone else's expense (D6), record or void a payment between others (D9), or change someone else's chore or bill (D27, D28).                                                                                                            |
| References across households | Paying, splitting with, settling with, assigning to or handing ownership to someone from another household is refused (`HJ007`, `HJ016`, `HJ030`, `HJ003`).                                                                                                                                                                                                                       |
| Privileges                   | RLS on all 17 tables. `anon` and `PUBLIC`: no table or column privilege. `authenticated`: `SELECT` on each table plus ten column grants (household name/currency/timezone update; invitation insert of four columns and revoke; profile name/avatar update). No views.                                                                                                            |
| Functions                    | Every function in `public` and `private` pins `search_path = ''`. No dynamic SQL in any migration. The callers of write functions come from `auth.uid()`, never from arguments.                                                                                                                                                                                                   |
| Server code                  | Every protected page, layout and Server Action calls `requireUser()`; user ids come from the session; input is parsed with Zod; no service-role or secret key anywhere in `src` or the build.                                                                                                                                                                                     |
| CSRF                         | Server Actions accept only `POST` and Next.js compares the `Origin` with the host; cookies are `SameSite=Lax`. No `GET` handler changes data except the one-time email link.                                                                                                                                                                                                      |
| Open redirects               | `safeReturnPath()` allows same-origin paths only (unit-tested).                                                                                                                                                                                                                                                                                                                   |
| Errors                       | Database and Auth errors map to plain messages; raw messages and stacks are never shown or logged.                                                                                                                                                                                                                                                                                |
| Invite links                 | 32 random bytes, stored only as a SHA-256 hash; expiry, use limit and revocation checked in one transaction; the token never leaves this origin in a `Referer`.                                                                                                                                                                                                                   |
| Money                        | See [production-readiness.md](production-readiness.md#financial-integrity): exact shares, zero-sum balances, retries recorded once, budgets and analytics equal direct sums.                                                                                                                                                                                                      |
| SSRF                         | The server only calls the configured Supabase URL; nothing fetches a URL a person supplies.                                                                                                                                                                                                                                                                                       |

## OWASP Top 10 (2021) at a glance

| Category                        | Where it stands                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A01 Broken access control       | RLS plus explicit checks in every write function; attack matrix above. Held.                                  |
| A02 Cryptographic failures      | HTTPS only in production (HSTS, `Secure` cookies); invite tokens hashed; no secrets in the browser.           |
| A03 Injection                   | Parameterised calls only, no dynamic SQL, React escaping, no raw HTML. Held.                                  |
| A04 Insecure design             | Money invariants enforced by the database (constraints, deferred triggers); random-operation test.            |
| A05 Security misconfiguration   | Headers, no `X-Powered-By`, configuration checked at build and start, catalog test. GraphQL: S8.              |
| A06 Vulnerable components       | Production tree: 0 advisories. Dev tools: S6.                                                                 |
| A07 Identification and auth     | Supabase Auth, confirmed email, rotating refresh tokens, neutral messages. Rate limiting: S4. No MFA: I2.     |
| A08 Software and data integrity | Lockfile; no scripts from other origins (CSP). There is no CI pipeline in the repository yet.                 |
| A09 Logging and monitoring      | Structured error lines and a health check; alerting is set up at deployment ([operations.md](operations.md)). |
| A10 Server-side request forgery | No fetch of a supplied URL.                                                                                   |

## Remaining risks

S4 and S8 need settings in the hosted projects before launch, and S11 needs an operator decision.
The rest are accepted and listed in [known-limitations.md](known-limitations.md).
