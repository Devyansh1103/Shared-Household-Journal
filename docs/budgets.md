# Budgets and household analytics

Built in roadmap Phase 16: spending limits per week, month or quarter, for everything or one
category, compared with the expenses recorded; and an analytics page showing where the money goes.
Both only read the household's own records and never move money. Decisions: D1, D7, D9, D10, D11,
D17, D25, O3 (confirmed 2026-11-13), D29 and O11 in [decisions.md](decisions.md). Code:
[src/lib/budgets/](../src/lib/budgets/), [src/lib/analytics/](../src/lib/analytics/), the pages under
[budgets/](<../src/app/(app)/households/[householdId]/budgets/>) and
[analytics/](<../src/app/(app)/households/[householdId]/analytics/>), the migration
[20261119120100_budgets_and_analytics.sql](../supabase/migrations/20261119120100_budgets_and_analytics.sql).

## What counts as spending

Budgets and analytics use the same rule, applied in Postgres:

- **Recorded expenses that aren't deleted** (D7), by their **expense date**, a calendar date (D11).
  When an expense was entered doesn't matter: one dated 31 October counts in October even if it was
  recorded on 2 November.
- **Recurring bills** count once they're recorded, because recording one creates an expense (D10).
  A period that's due but not recorded isn't spending, and a period can only be recorded once (the
  Phase 14 unique index), so it can't be counted twice.
- **Settlements aren't spending**: they record money passing between members, not money leaving the
  household (D9). Voided or not, they never appear in these figures.
- **One currency** per household (D1): every figure is in the household's currency, in integer minor
  units (bigint in Postgres, BigInt in TypeScript), never floating point. There is nothing to convert
  and no totals that mix currencies.
- **Deleting, restoring or editing** an expense changes the figures straight away: nothing is stored
  or cached; every page load works them out again.

## Budgets

`/households/[householdId]/budgets` (with `?period=week|month|quarter` and `?on=YYYY-MM-DD` for an
earlier period), `/budgets/new` and `/budgets/[budgetId]/edit`.

- **What a budget is:** a limit for **everything** the household spends, or for **one category**
  (D17), per **week** (Monday to Sunday, D25), **calendar month** or **calendar quarter**, in the
  household's timezone (D11). It's named by what it covers: "Monthly budget for groceries".
- **One active budget** per category (or everything) and period. Groceries can have a weekly and a
  monthly budget; not two monthly ones (`HJ032`).
- **Independent:** the budget for everything counts every expense; a category budget counts only
  its category. Category budgets are never added up to make the overall one, and no expense is
  counted twice within one figure.
- **Starts** with the period it's added in. It doesn't cover earlier periods.
- **Changing the limit** applies from the current period on. Periods that have ended keep the limit
  they had (`budget_limits` keeps each limit with the first period it applies to), so last month's
  figures stay what they were.
- **Removing** a budget asks first. It no longer covers the current period or later ones, but stays
  for the periods that had ended (shown with "Removed since"). It can't be changed afterwards.
- **No rollover** (O11, open): each period starts again at its limit.
- **Who:** any active member adds, changes or removes a budget (O3); everyone in the household sees
  them.

### The figures

For each budget and period ([figures.ts](../src/lib/budgets/figures.ts), unit-tested):

| Figure | Rule                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------- |
| Spent  | The sum of the counted expenses in the period (and the category)                                        |
| Left   | Limit − spent, never below zero                                                                         |
| Over   | Spent − limit when spent is more; shown on its own ("₹4,000.00 over the limit")                         |
| Used   | Spent × 1000 ÷ limit, in tenths of a percent, rounded down (so 99.95% shows as 99.9%, not 100%)         |
| Status | Nothing spent yet (0); On track; Near limit (from 80%, D29, up to and including the limit); Over budget |

A limit is always above zero (the database refuses anything else), and the code still never divides
by zero. Statuses are words with an icon; the bar is a picture of the same figures and is hidden from
screen readers.

### The page

Period chips (Weekly, Monthly, Quarterly, each with how many budgets it has), Previous and Next
(no further than the current period), what the household spent in the period in total, the budget
for everything, then the category budgets. Each card links to the matching expenses in the history.
Limits can only be changed, and budgets removed, while viewing the current period.

## Analytics

`/households/[householdId]/analytics`, with its filters in the URL: `range` (this month, last month,
last 7 or 30 days, last 3, 6 or 12 months, or custom), `from` and `to` (custom only, at most two
years), `category` and `payer`. Every figure on the page uses the same filters. Clear filters goes
back to this month.

- **Summary:** total spent, the number of expenses, the average (rounded to the nearest minor unit,
  halves up), the largest expense, the biggest category, and a comparison.
- **The comparison:** "this month" is compared with the same days of last month (1–13 Nov with
  1–13 Oct; on the 31st with the whole of a shorter month); "last month" with the month before; other
  ranges with the same number of days just before. When nothing was recorded then, it says so
  instead of a percentage.
- **By category:** each category's total, share and count, biggest first.
- **Over time:** by day for up to two weeks, by week (from Monday) up to about three months, by month
  beyond; periods with nothing recorded are listed with ₹0.00.
- **By person,** two different things side by side:
  - **Paid:** what they paid for when the expense was recorded (`paid_by`).
  - **Share:** their part of the splits (`expense_splits`), what the expenses were for them.
    The page says they differ because one person often pays for everyone, and that who owes whom is on
    the Balances page. Both columns add up exactly to the total (checked before showing).
- **Largest expenses:** up to ten, linking to each expense's page.

**Charts** are tables: each row has the label, a bar (a picture, hidden from screen readers) and the
figures, so the same numbers reach everyone. No chart library was added. On a phone the bar moves
under the label, and a table that's still wider than the screen scrolls inside a focusable region.

**Checks:** the app parses the answer strictly and checks that categories, buckets, what people paid
and their shares each add up exactly to the total, that the buckets are consecutive and cover the
range, and that the largest expenses are in order and inside the filters
([payload.ts](../src/lib/analytics/payload.ts)). Otherwise it shows an error, not numbers that
disagree.

## Database

| Object                                                                                    | What                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `budgets`                                                                                 | `household_id`, `category` (null: everything), `period` (`budget_period`: week, month, quarter), `starts_on`, `created_by`, `creation_key`, `archived_at`/`archived_by`/`archived_on` together                  |
| `budget_limits`                                                                           | (`budget_id`, `starts_on`) → `limit_minor` (1 – 999,999,999,999), `set_by`, `set_at`; composite key to the budget with its household                                                                            |
| `create_budget`, `update_budget`, `archive_budget`                                        | `SECURITY DEFINER`; any active member; journalled (`budget_created`, `budget_updated`, `budget_archived`); a repeated request key returns the first budget; the same limit again or removing twice does nothing |
| `household_budgets(household, period, on_date?)`                                          | `security invoker`: the budgets covering the period that contains `on_date` (today in the household's timezone by default), with the limit for that period, what was spent and how many expenses                |
| `household_analytics(household, from, to, category?, payer?, compare_from?, compare_to?)` | `security invoker`: every figure above, summed in one snapshot; `22023` for a range that's backwards, longer than two years, or a comparison that isn't before it                                               |
| `private.budget_period_start`, `private.budget_period_end`                                | The period rules, the same as [period.ts](../src/lib/budgets/period.ts) (compared for every day of two years in the database tests)                                                                             |

RLS: active members read both tables; nobody writes to them directly (`42501`). Another household's
budget id answers as one that doesn't exist (`HJ031`). The reads check membership themselves too
(`42501`). Spending sums use the Phase 8 partial index on `(household_id, expense_date)` for
expenses that aren't deleted; budgets have an index on `(household_id, period)`. No new index on
expenses was needed.

**Rolling back:** the migrations are additive. Undoing them means dropping the two tables, the
functions, the `budget_period` type, and restoring `household_journal` from
`20261118120100_shopping_and_chores.sql`; the three new event types would have to stay in the enum
(Postgres can't drop enum values), unused. Not done, and it would need the owner's approval.

## Notifications

None. The budgets page, the Household page ("This month: ₹9,000.00 of ₹12,000.00 (75%)", "1
category near its limit") and the statuses are all in the app; nothing is emailed, pushed or
notified. The journal events (`budget_*`) are written, so in-app notifications (D12, roadmap Phase 17) could use them, and a "near limit" or "over budget" alert would need its own event, which this
phase doesn't write.

## Known limits

- Budgets can't be added for a future period or backdated; a budget covers the periods from the one
  it was added in.
- A category budget's past figures follow the expenses' categories now: changing an expense's
  category moves it between category budgets, in past periods too. That's what "worked out from the
  records" means; nothing is frozen.
- Analytics show at most two years at a time and the ten largest expenses.
- There's no export (Phase 21) and no live update.

## Tests

| File                                                                  | Covers                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/lib/budgets/period.test.ts](../src/lib/budgets/period.test.ts)   | Weeks from Monday across years, month lengths, February and leap years, quarters, every day in exactly one period, labels                                                                                                                                                                                                                                                   |
| [src/lib/budgets/figures.test.ts](../src/lib/budgets/figures.test.ts) | Below, at and over the limit, 80%, nothing spent, a zero limit, large amounts, rounding down                                                                                                                                                                                                                                                                                |
| [src/lib/budgets/form.test.ts](../src/lib/budgets/form.test.ts)       | Categories, periods, positive and exact limits                                                                                                                                                                                                                                                                                                                              |
| [src/lib/budgets/payload.test.ts](../src/lib/budgets/payload.test.ts) | Strict parsing; other households, repeats, the wrong period, totals that don't add up                                                                                                                                                                                                                                                                                       |
| [src/lib/analytics/](../src/lib/analytics/)                           | Presets and the comparison, URL validation, averages, comparisons from zero, every consistency check                                                                                                                                                                                                                                                                        |
| [supabase/tests/budgets.test.ts](../supabase/tests/budgets.test.ts)   | Against the local stack: the period rules against TypeScript; any member manages budgets; uniqueness; limits past periods keep; removal; deleted, restored, settled, unrecorded and recorded bills; month edges; analytics totals, buckets, paid and share, filters, comparisons; refused input; other households; leaving; the journal; deletion; the household's timezone |
| [e2e/budgets.spec.ts](../e2e/budgets.spec.ts)                         | In a browser, desktop and phone: adding (a mistake keeps the choice), statuses, a duplicate, changing a limit, removing, last month, the Household page, the journal, analytics with filters, a non-member, 360px                                                                                                                                                           |
