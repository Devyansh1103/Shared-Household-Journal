# Known limitations

What the first release doesn't do, or does with a known trade-off, as of roadmap Phase 18
(2026-11-14). Each item says where it's tracked. Nothing here was hidden by disabling a test.

## Product

| Limitation                                                                                                          | Tracked                               |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| The household dashboard (roadmap Phase 11) isn't built; the household page lists each module instead.               | [roadmap.md](roadmap.md)              |
| Notifications are in-app only: no email or push. Bills and chores due are shown when you look; nothing is sent.     | D12, D30, ADR-010, ADR-011            |
| Deleting an account is an operator procedure on request, not a button.                                              | D14, [operations.md](operations.md)   |
| The email address can't be changed in the app; no avatar upload; a password change goes through the recovery email. | D22 (proposed), [auth.md](auth.md)    |
| No export, no debt simplification, no receipt OCR or AI categorisation.                                             | Phases 19–21 (optional), D15          |
| How a former member's leftover balance is settled is undecided: a new payment needs two active members.             | O9 (open)                             |
| A payment counts as soon as either person records it; there is no "confirmed by the other person" step.             | O10 (open), D9                        |
| No budget rollover: each period starts again at its limit.                                                          | O11 (open)                            |
| Invite links use the 7-day, 10-use defaults; whether those are also maximums is undecided.                          | O6 (open)                             |
| Several rules are working defaults not yet approved by the owner.                                                   | D22, D25–D28, parts of D29 (proposed) |
| English only, formatted for `en-IN`; light mode only.                                                               | D18, D19                              |
| Names typed into descriptions or notes aren't changed when an account is anonymised.                                | D14                                   |

## Security

| Limitation                                                                                                                                    | Tracked                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| The Content Security Policy allows inline scripts and styles (nonces don't work with Partial Prerendering).                                   | [security.md](security.md) S1                               |
| No rate limiting of the app's own; Supabase Auth's limits count the app servers' addresses. Needs edge rules in the host before launch.       | S4, [deployment.md](deployment.md#security-settings)        |
| An access token keeps working at the Data API until it expires (up to an hour) after sign-out or deletion; the app itself rejects it at once. | S9                                                          |
| The Auth API reveals whether an email is registered to someone calling it directly.                                                           | I4, [auth.md](auth.md#known-limitations)                    |
| No multi-factor authentication.                                                                                                               | I2                                                          |
| Mail scanners that open links can use up a one-time email link; the person then asks for a new one.                                           | [auth.md](auth.md#known-limitations)                        |
| Supabase Auth's audit log keeps a deleted account's email unless the operator removes it.                                                     | S11, [operations.md](operations.md#deleting-an-account-d14) |
| Development tools have moderate advisories with no non-breaking fix (none ships in the app).                                                  | S6                                                          |

## Operations

| Limitation                                                                                            | Tracked                                            |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Nothing is deployed; no hosted project exists, so hosted settings, backups and restores are untested. | [production-readiness.md](production-readiness.md) |
| No monitoring or alerting is configured; the health check and log lines are ready for it.             | [operations.md](operations.md#monitoring)          |
| No CI pipeline; checks are run by hand before each commit.                                            | [testing.md](testing.md)                           |
| Test coverage isn't measured (no coverage tool installed).                                            | [testing.md](testing.md)                           |
| Production email needs custom SMTP; the built-in sender is for testing only.                          | [deployment.md](deployment.md#email)               |
| No privacy policy or terms of use exist; they're needed before inviting the public.                   | [production-readiness.md](production-readiness.md) |

## Scale

| Limitation                                                                                                                                                                                                                                                      | Tracked                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| RLS checks household membership once per row. Measured: about 70–90 ms for a 5,000-expense history page, a few milliseconds for typical households. A set-based policy would remove the cost; the owner decided (2026-11-14) to leave the policies as they are. | [database.md](database.md) (expense history, performance) |
| Balances, budgets and analytics are worked out on every read, never stored (by design, ADR-005).                                                                                                                                                                | ADR-005                                                   |
| The notification bell asks for the unread count every minute while a page is open (and when it becomes visible again).                                                                                                                                          | [notifications.md](notifications.md)                      |
