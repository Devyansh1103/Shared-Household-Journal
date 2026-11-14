# Production readiness (roadmap Phase 18)

The checklist for releasing the first version, as of 2026-11-14. Each line has a status and the
evidence behind it:

- **Verified:** checked, with a command or test anyone can re-run (results from 2026-11-14).
- **Failed:** checked and not met.
- **Not tested:** not checked yet, usually because it needs the hosted projects, which don't exist.
- **N/A:** doesn't apply to this app.

Nothing has been deployed. This is an internal review, not a certification
([security.md](security.md)).

## Decision

**Ready for staging deployment.**

Every check that can run without the hosted projects passes, and the audit found nothing critical
or high. Production needs, first, the manual configuration in [deployment.md](deployment.md) done
and checked on a staging project: Auth URLs and templates, SMTP, edge rate limiting (S4), GraphQL
off (S8), backups and a restore test, monitoring. It also needs a privacy policy and terms of use,
and the owner's approval of the proposed decisions (D22, D25–D28, parts of D29) or their
replacements. See [Before production](#before-production).

## Security

| Check                                                                                    | Status     | Evidence                                                                                                                  |
| ---------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| No critical or high findings open                                                        | Verified   | [security.md](security.md)                                                                                                |
| RLS on every table; no views                                                             | Verified   | `authorization.test.ts` › the catalog                                                                                     |
| `anon` can't read or write any table; runs only `health_check`                           | Verified   | the catalog test; the signed-out attack test (every function and table refused with `42501`)                              |
| `authenticated`: `SELECT` plus exactly ten column grants                                 | Verified   | the catalog test                                                                                                          |
| Every function pins `search_path`; no dynamic SQL                                        | Verified   | the catalog test; a search of all 16 migrations                                                                           |
| Another household's records refused by every function and table, and left unchanged      | Verified   | `authorization.test.ts`: 48 attacks by an outsider and by a former member, a superuser snapshot compared before and after |
| An ordinary member can't do the owner's or other people's actions                        | Verified   | `authorization.test.ts` › a member's role                                                                                 |
| People and records from another household refused inside your own                        | Verified   | `authorization.test.ts` › references across households                                                                    |
| Another household's pages show nothing                                                   | Verified   | `workflows.spec.ts` G (26 pages), each module's non-member test                                                           |
| Every page, layout and Server Action checks the session; ids from the session; Zod input | Verified   | code audit of 48 entry points ([security.md](security.md#scope-and-method))                                               |
| Security headers and CSP on every response; no `X-Powered-By`                            | Verified   | `workflows.spec.ts` › headers test                                                                                        |
| No CSP violations                                                                        | Verified   | all 100 e2e runs; the six-width sweep (see Accessibility)                                                                 |
| Session cookies `HttpOnly`, `Secure` (production), `SameSite=Lax`                        | Verified   | `workflows.spec.ts` A                                                                                                     |
| No secret in the app, the build or a public variable                                     | Verified   | code search; `src/lib/env.test.ts`; the build and start-up checks                                                         |
| Production dependencies: no known vulnerabilities                                        | Verified   | `npm audit --omit=dev`: 0                                                                                                 |
| Development dependencies                                                                 | Failed     | `npm audit`: 13 (2 low, 11 moderate), no non-breaking fix; none ships in the app (accepted, S6)                           |
| Rate limiting at the edge (S4)                                                           | Not tested | needs the Vercel project ([deployment.md](deployment.md#security-settings))                                               |
| GraphQL turned off in the hosted project (S8)                                            | Not tested | needs the hosted project                                                                                                  |
| Leaked-password protection, CAPTCHA (I3)                                                 | Not tested | hosted settings; optional                                                                                                 |
| Multi-factor authentication                                                              | N/A        | not in the approved scope (I2)                                                                                            |

## Financial integrity

| Check                                                                                        | Status   | Evidence                                                                                                  |
| -------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| Every expense's shares add up exactly to its amount (deleted ones too)                       | Verified | `financial-invariants.test.ts` (seed 20261114, and seeds 1, 77, 4242); database constraints since Phase 8 |
| Balances net to zero; each net = paid − share + payments made − payments received (raw rows) | Verified | the same test, checked every 20 of 120 operations                                                         |
| Who owes whom agrees with everyone's net                                                     | Verified | the same test                                                                                             |
| More than what's owed needs the acknowledgement (D9)                                         | Verified | the same test (`HJ017` with the current figure)                                                           |
| A retried submission records once (expenses, payments, bill periods)                         | Verified | the same test                                                                                             |
| A payment never changes the expense it pays back (D8)                                        | Verified | `workflows.spec.ts` D (page and database row)                                                             |
| Budgets and analytics equal direct sums; payments and unrecorded bills aren't spending       | Verified | `financial-invariants.test.ts`                                                                            |
| Integer minor units only; formatting only through `src/lib/format.ts`                        | Verified | unit tests; earlier phases' audits                                                                        |
| The app never moves money                                                                    | Verified | no payment provider or transfer code exists; every payment screen says so                                 |

## Tests and quality gates

| Check                                        | Status     | Evidence                                              |
| -------------------------------------------- | ---------- | ----------------------------------------------------- |
| `npm run format:check`                       | Verified   | all files pass                                        |
| `npm run lint`                               | Verified   | no problems                                           |
| `npm run typecheck`                          | Verified   | no errors                                             |
| `npm test` (unit)                            | Verified   | 47 files, 482 tests passed                            |
| `npm run test:db` (database)                 | Verified   | 16 files, 291 tests passed                            |
| `npm run build` (production)                 | Verified   | compiled; 44 pages generated                          |
| `npm run test:e2e` (Edge, desktop and phone) | Verified   | 100 of 100 passed on the final build (18.9 min)       |
| Workflows A–G executed                       | Verified   | [testing.md](testing.md#end-to-end-tests)             |
| Test coverage measured                       | Not tested | no coverage tool installed ([testing.md](testing.md)) |
| CI pipeline                                  | Not tested | none in the repository                                |

## Accessibility and layout

| Check                                                                  | Status   | Evidence                                                                                                                       |
| ---------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| WCAG 2.2 AA (axe) on every page at six widths, no overflow or clipping | Verified | 37 pages × 320, 375, 390, 768, 1366 and 1920 px: 222 checks, no axe violation, overflow, clipping, CSP violation or page error |
| Keyboard order, focus return, reduced motion                           | Verified | `notifications.spec.ts` (Phase 17)                                                                                             |
| Colour token contrast                                                  | Verified | `src/app/tokens.test.ts`                                                                                                       |

## Configuration and deployment

| Check                                                                  | Status     | Evidence                                                            |
| ---------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------- |
| Variables documented by name only                                      | Verified   | [.env.example](../.env.example), [environment.md](environment.md)   |
| Build refuses a secret in a public variable; server refuses bad config | Verified   | `src/lib/env.test.ts`; `next.config.ts`; `src/instrumentation.ts`   |
| Migrations additive; the new one applied cleanly to the local stack    | Verified   | review of `20261121120000_operations.sql`; the database tests       |
| `.env*` gitignored                                                     | Verified   | `.gitignore`                                                        |
| Hosting decided (O1)                                                   | Verified   | [ADR-013](adr/013-hosting.md)                                       |
| Supabase project created; migrations pushed (`db push --dry-run` read) | Not tested | no hosted project                                                   |
| Auth settings, templates, SMTP                                         | Not tested | no hosted project ([deployment.md](deployment.md#3-configure-auth)) |
| Vercel project, variables, region, domain, HTTPS                       | Not tested | not deployed                                                        |
| Post-deployment checks                                                 | Not tested | [deployment.md](deployment.md#6-deploy-and-check)                   |

## Operations and privacy

| Check                                                   | Status     | Evidence                                                                           |
| ------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| Health check answers, reveals nothing                   | Verified   | `workflows.spec.ts`; `operations.test.ts`                                          |
| Structured error logs without messages or personal data | Verified   | code review of `src/instrumentation.ts`; every thrown error has a fixed message    |
| Error page with a reference                             | Verified   | `src/app/global-error.tsx` (code review)                                           |
| Account deletion (D14) procedure                        | Verified   | `operations.test.ts` end to end on the local stack; [operations.md](operations.md) |
| Retention decided (O2)                                  | Verified   | [backup-recovery.md](backup-recovery.md#retention-o2)                              |
| Emails visible only to their owner                      | Verified   | RLS on `profiles` (no email column); `auth` schema not exposed                     |
| Monitoring and alerts                                   | Not tested | to set up with the deployment ([operations.md](operations.md#monitoring))          |
| Backups enabled; a restore tested                       | Not tested | no hosted project ([backup-recovery.md](backup-recovery.md))                       |
| Privacy policy and terms of use                         | Failed     | none exist; needed before inviting the public                                      |

## Before production

In order, each needing the owner:

1. Create the staging Supabase project and a Vercel project; follow [deployment.md](deployment.md)
   and its checks on staging, including S4 (edge rate limits) and S8 (GraphQL off).
2. Turn on backups for production and test a restore on staging
   ([backup-recovery.md](backup-recovery.md#test-the-restore)).
3. Set up SMTP and monitoring.
4. Publish a privacy policy and terms of use.
5. Approve or change the proposed decisions (D22, D25–D28, parts of D29) and decide the open ones
   that matter for launch (O6, O9, O10, O11), or accept them as known limitations.
6. Decide whether the household dashboard (roadmap Phase 11) is needed for the first release.
7. Then create the production projects the same way, and run the post-deployment checks.
