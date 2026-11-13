# Shopping list and chores

Home coordination, built in roadmap Phase 15: one shared shopping list per household, and one-off
chores with an assignee, a due date and a priority. Neither involves money: buying something on the
list records no expense, and nothing here changes a balance. Decisions: D11, D13 and D28 (proposed)
in [decisions.md](decisions.md). Code: [src/lib/shopping/](../src/lib/shopping/),
[src/lib/chores/](../src/lib/chores/), the pages under
[src/app/(app)/households/[householdId]/shopping/](<../src/app/(app)/households/[householdId]/shopping/>)
and [chores/](<../src/app/(app)/households/[householdId]/chores/>), the migration
[20261118120100_shopping_and_chores.sql](../supabase/migrations/20261118120100_shopping_and_chores.sql).
Schema and functions: [database.md](database.md#shopping-list-and-chores-roadmap-phase-15).

## The shopping list

`/households/[householdId]/shopping`, reached from the Household page (the Household tab stays
active).

- **One list for the household.** The approved model (requirements-notes §3) has items belong to the
  household; there are no named lists.
- **An item** has a name (up to 120 characters), and optionally a quantity as free text ("2",
  "1 kg", "a big bag", up to 40), a note (up to 300) and the member who's getting it. Who added it and
  who bought it, and when, come from the session.
- **Adding** is a form at the top of the list. After an add it's empty again, ready for the next
  item; a repeated submission (a double click, a retry) adds the item once.
- **Bought / still needed.** "Mark bought" records who bought it and when; "Still needed" puts it
  back. Doing either twice, or two people at once, changes nothing more.
- **Editing** changes the name, quantity, note and assignee (a page of its own). An edit from a page
  that's out of date is refused ("Someone changed this while you were editing").
- **Removing** asks first, then takes the item off the list for everyone. It's kept (with who removed
  it and when) so the journal still makes sense, and can't be changed afterwards.
- **Filters**, in the URL: `show` is `pending` (the default, "Still needed"), `purchased` ("Bought")
  or `all`; `who` is `me` ("Mine": assigned to you), `nobody` ("Unassigned") or a person's id.
  Anything else is ignored.
- **Who can do what:** any active member, anything, on any item (D28).

## Chores

`/households/[householdId]/chores`, with `/new` and `/[choreId]/edit`.

- **A chore** has a title (up to 120), and optionally a description (up to 1000, shown on the chores
  page only), an assignee and a due date (a calendar date, D11); and a priority, low, medium
  (default) or high. Chores are one-off: no recurrence (requirements-notes §3).
- **Sections:** My tasks (open chores assigned to you), Overdue, Due today, Upcoming, Any time (no
  due date), Done (the latest 50). Each chore appears once. "Overdue" means a due date before
  today in the household's timezone, worked out on every page load and never stored.
- **Sorted** soonest due first, then high priority first, then oldest first.
- **Filters**, in the URL: `show` is `open` (the default, "To do"), `completed` ("Done") or `all`;
  `who` as for the list (filtering by a person shows their chores by due date, without a separate
  My tasks); `priority` is `low`, `medium` or `high`.
- **Who can do what (D28, proposed):** anyone adds a chore. The person who added it, its assignee or
  the owner edits it (which is how it's reassigned) or removes it. They can also mark it done or not
  done, and so can anyone when it's assigned to nobody (anyone can pick it up) or to someone who has
  left. The page shows only the buttons the viewer may use, and says who can when there are none; the
  database checks again.

## People who leave (D13)

Assignments aren't moved when someone leaves: their items and chores stay theirs, shown with
"(left)". Anyone may then finish such a chore, and whoever may edit it may reassign it. A former
member can stay chosen while an item or chore is edited, but can't be chosen again once it's moved.
Their name stays on everything they added, bought or completed.

## Reminders and notifications

There are none to send. The chores page and the Household page show what's overdue and due today
when someone looks; nothing is emailed, pushed or notified. In-app notifications are D12's, in
roadmap Phase 17.

## The journal

Every real change is an event in the same transaction ([journal.md](journal.md)): an item added,
changed, bought, put back or removed; a chore added, changed, completed, reopened or removed. Under
the Shopping and Chores filters. An edit lists what changed (name, quantity, assignee; title,
assignee, due date, priority); a changed note or description is only flagged, never copied. Nothing
is journalled when nothing changed, or when a repeat changed nothing. A refused change writes
nothing.

## Household page

Two sections: Shopping ("3 items still needed, 1 for you to get") and Chores ("4 chores to do, 2
assigned to you", with "1 chore overdue" as a badge), each linking to its page.

## Not built

Item categories, units or prices; several lists; links between a purchase and an expense;
recurring chores; reminders and notifications; chore rotation, points or gamification; comments;
restoring a removed item or chore. Nothing was faked to look like these.

## Known limits

- The list shows up to 500 items still needed and the latest 100 bought; the chores page up to 500
  open chores and the latest 50 done. It says so when there are more.
- Counts and pages are as of loading the page; there are no live updates.

## Tests

| File                                                                                | Covers                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/lib/shopping/form.test.ts](../src/lib/shopping/form.test.ts)                   | Reading and validating an item: trimming, limits, assignees (a former one kept)                                                                                                                                                                                         |
| [src/lib/shopping/list.test.ts](../src/lib/shopping/list.test.ts)                   | URL filters, order, whose items, the person chips                                                                                                                                                                                                                       |
| [src/lib/chores/form.test.ts](../src/lib/chores/form.test.ts)                       | Validating a chore: defaults, limits, the due-date window, editing keeps an old date or a former member                                                                                                                                                                 |
| [src/lib/chores/board.test.ts](../src/lib/chores/board.test.ts)                     | Overdue and due today from the household's date, sections, order, filters, D28's rules                                                                                                                                                                                  |
| [supabase/tests/shopping-chores.test.ts](../supabase/tests/shopping-chores.test.ts) | Against the local stack: every operation and its event; retries and concurrent calls; repeats with no event; refused input writing nothing; D28's rights (a regression for unassigned chores); D13; other households; no direct writes; the journal; no money; deletion |
| [e2e/shopping-chores.spec.ts](../e2e/shopping-chores.spec.ts)                       | In a browser, desktop and phone: adding items in a row, a mistake that keeps the choices, buying, editing, removing; filters; adding a chore, overdue and due today; who can change a chore; reassigning; the journal; a non-member; 360px                              |
