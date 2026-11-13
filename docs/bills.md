# Recurring bills

Bills that repeat, like rent or electricity: when each one is due, what it's expected to cost, who
usually pays and how it's usually split. Built in roadmap Phase 14. Decisions: D10, D11, D12 and
D27 (proposed) in [decisions.md](decisions.md); [ADR-010](adr/010-recurring-bills.md). Code:
[src/lib/bills/](../src/lib/bills/), the pages in
[src/app/(app)/households/[householdId]/bills/](<../src/app/(app)/households/[householdId]/bills/>),
and the database in
[20261117120000_recurring_bill_types.sql](../supabase/migrations/20261117120000_recurring_bill_types.sql)
and [20261117120100_recurring_bills.sql](../supabase/migrations/20261117120100_recurring_bills.sql).

**A bill is a reminder, never money (D10, ADR-010).** Nothing is created automatically. A bill
counts for nothing until a member records one of its periods as an expense ("Record this bill"),
through the same expense form and the same `create_expense` as any other expense. Unpaid, overdue,
skipped or upcoming periods are in no balance, total or summary.

## Four separate records

| Record                                        | What it is                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `recurring_bills` (+ `recurring_bill_shares`) | The definition: description, notes, expected amount, category, who usually pays, the default split, the schedule, paused or not. |
| `bill_occurrences`                            | One period: its due date and the amount expected then. Stored only once something happens to it (below).                         |
| `expenses`                                    | What was actually spent. A recorded period's expense carries `recurring_bill_id` and `recurrence_period` (its due date).         |
| `settlements`                                 | Unchanged: how people even out between themselves.                                                                               |

## The schedule (D10)

- **Weekly, monthly or yearly, every N of them** (N from 1 to 52). The form offers every week, every
  2 weeks, every month, every 3 months (quarterly), every year, or another interval.
- **Period k is worked out from the first due date** (`anchor_on`), never from the period before:
  `bill_due_date(anchor, unit, every, k)` in SQL, `dueDate` in
  [schedule.ts](../src/lib/bills/schedule.ts). The two are compared on thousands of dates in the
  database tests.
- **Month ends:** a monthly bill on the 29th–31st falls on the last day of shorter months, and comes
  back to its day afterwards: 31 Jan, 28 Feb (29 in a leap year), 31 Mar, 30 Apr. Quarterly from 30 Nov:
  28 Feb, 30 May.
- **Leap years:** a yearly bill on 29 February falls on 28 February in other years, and on the 29th
  again in leap years.
- **Dates** are calendar dates. "Today" is the household's date in its timezone (D11), worked out by
  the database (`household_today`) and by the app (`todayIn`) the same way.
- **Bounds:** a first due date within the past year (so catching up stays small) and the next ten
  years; an optional last due date, on or after the first.

## Periods without a scheduler

ADR-010 says the first release needs no scheduler, and nothing in the repository could run one
(there's no cron, job runner or hosting yet: O1). None is needed:

- **The reads work periods out every time.** For each bill, the periods that have come (due on or
  before today) and aren't stored yet are open; the first one after today is upcoming. Due today,
  overdue and due soon follow from the dates. Nothing goes stale, nothing has to catch up after
  downtime, and nothing can be generated twice, because nothing is generated in the background.
- **A period is stored only inside the action that needs it,** in the same transaction: recording or
  skipping it, and, before a pause, an end or any change to the bill, every period that has already
  come. That freezes those periods with the dates and expected amount they came with (D10: edits apply
  to future periods only). `unique (bill_id, due_on)` keeps one row per period, the bill's row lock
  serialises two actions on one bill, and a cursor (`next_index`) says which periods are stored.
- **Bounded:** a read shows at most 500 open periods per bill; an action stores at most 2,000 at once
  (a weekly bill a year behind is 53).

If notifications (roadmap Phase 17) need something to happen at a due date, they'll need a scheduler
then; the periods themselves never will.

## Reminders: what exists, and what doesn't

| Reminder                                                                              | State                                                             |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| The bills page: overdue, due today, due in the next 7 days, coming up                 | **Built.** In-app, worked out on every visit                      |
| The Household page: "2 bills overdue", "1 bill due today", "… due in the next 7 days" | **Built.** In-app                                                 |
| Notifications (in-app, D12), per-user and per-type switches                           | **Not built.** Roadmap Phase 17; no delivery mechanism exists yet |
| Email, push or SMS                                                                    | **Not approved** (D12, ADR-011)                                   |

Nothing is sent to anyone. "Due soon" is 7 days (`DUE_SOON_DAYS`, D27, proposed). There are no
reminder preferences yet: D12 puts them on notifications, per user, household and type.

## Recording a period ("Record this bill", D10)

1. From the bills page or the bill's page, "Record" opens the **expense form**, pre-filled from the
   bill: its description, the period's expected amount, the category, who usually pays (if still a
   member), the default split (people who have left aren't ticked), and today as the date paid.
2. Anything can be changed for this time, the amount included. The bill's expected amount doesn't
   change.
3. `record_bill_payment` checks the period (one that has come, or the next one, which can be paid
   early; not skipped, not already recorded), stores it, calls `create_expense` (payer and
   participants active members, the split adds up, `expense_created` in the journal), and links the
   expense to the period, **all in one transaction**. If any part is refused, nothing is stored.
4. The household is the bill's, never the form's. A repeated submission returns the same expense
   (request key). Two people recording the same period at once: one succeeds, the other is told it's
   already recorded (`HJ022`).

**One counted expense per period (D10):** a unique index on expenses
`(recurring_bill_id, recurrence_period)` for expenses that aren't deleted, and a foreign key to the
stored period that includes the household, so an expense can only be linked to a real period of a
bill in its own household (even the service role can't link it elsewhere).

**Deleting the expense** (D7) reopens the period, which can be recorded again. **Restoring** that
expense is refused (`HJ025`) if the period was recorded again or skipped meanwhile.

"Paid on time" or "Paid late" compares the expense's date with the due date. Payment is never
inferred from a similar-looking expense, only from the link.

## The lifecycle

| Action                 | What happens                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skip a period (D27)    | No expense; it isn't paid. For a period that has come or the next one. Refused if recorded (`HJ022`) or already skipped (`HJ023`). "Undo skip" opens it again.        |
| Pause (D10: disabling) | Periods that have come are stored and stay open until recorded or skipped. No new period comes; nothing ahead can be recorded.                                        |
| Resume                 | The next period is the first on the schedule from today. Periods that fell while paused never come.                                                                   |
| End                    | No period after today (or after one already paid early). History stays. A later last due date can be set again under Edit details.                                    |
| Edit details           | Description, expected amount, category, who usually pays, the default split, notes, last due date. Later periods use them; stored periods keep their expected amount. |
| Change schedule        | A new unit, interval and next due date (today or later, after every stored period). Stored periods keep their dates.                                                  |

A bill has **ended** when it has no period left after today (not paused). Recorded expenses are never
changed by any of these.

## Who can do what (D27, proposed)

- **Any active member** adds a bill and records any period (as with adding an expense).
- **The person who added it, the person who usually pays it, or the owner** edits it, changes its
  schedule, pauses, resumes or ends it, and skips or un-skips a period.
- **Nobody else**, and nobody outside the household: the read functions answer `42501` or `HJ018`
  (as if the bill didn't exist), RLS hides the rows, and there are no direct write privileges on any
  of the three tables. A stored period can only be skipped or un-skipped, never moved or deleted,
  even by the service role (`bill_occurrences_protect`).
- The usual payer and the people in the default split must be active members when the bill is saved.
  If one leaves later, the bill stays; it shows them with "(left)" and the record form doesn't
  pre-fill them.

## The journal

The journal ([journal.md](journal.md)) shows `bill_created`, `bill_updated` (old and new: expected
amount, category, who usually pays, schedule, last due date), `bill_paused`, `bill_resumed`,
`bill_ended`, `bill_skipped` and `bill_unskipped`, under the new **Bills** filter, each linking to the
bill. Recording a period is the expense's own `expense_created` entry. Notes never reach the journal.

## Known limits

- No notifications, no reminder preferences, no scheduler (see above).
- A bill can't be deleted, only ended (its history stays).
- Edits and schedule changes are two pages, on purpose: editing the details can never move the
  schedule.
- Only the next period can be recorded or skipped early, not two ahead.
- One currency per household (D1), so a bill is always in the household's currency.

## Tests

| File                                                            | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [schedule.test.ts](../src/lib/bills/schedule.test.ts)           | Weekly, fortnightly, monthly, quarterly, yearly; month ends; leap years; every anchor over three years never drifting; labels and due wording                                                                                                                                                                                                                                                                                         |
| [form.test.ts](../src/lib/bills/form.test.ts)                   | Reading the form; presets and custom intervals; date bounds; the expense form's own rules for money, payer and split; a new schedule's start                                                                                                                                                                                                                                                                                          |
| [board.test.ts](../src/lib/bills/board.test.ts)                 | The bills page's groups; paused and ended; paid on time or late; who can manage; pre-filling the split                                                                                                                                                                                                                                                                                                                                |
| [payload.test.ts](../src/lib/bills/payload.test.ts)             | Parsing both reads strictly, and every check                                                                                                                                                                                                                                                                                                                                                                                          |
| [supabase/tests/bills.test.ts](../supabase/tests/bills.test.ts) | Against the local stack: SQL and TypeScript agree on every date; creating (idempotent, refused input); periods with nothing stored, a year behind, in two timezones; recording (actual amount, retries, two at once, refused dates, rollback, outsiders, delete and restore); skip, pause, resume, end, the end date; edits and schedule changes keeping history; access and forged links; money; the journal; deleting the household |
| [e2e/bills.spec.ts](../e2e/bills.spec.ts)                       | In a browser, desktop and phone: adding a bill with its month-end preview and validation; recording through the pre-filled expense form (choices survive an error); skip, undo, pause, resume, end and the journal; who can change it; outsiders; 360px                                                                                                                                                                               |
