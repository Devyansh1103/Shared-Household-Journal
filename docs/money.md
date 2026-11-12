# Money, splits and balances

How amounts are represented, parsed, split, added up into balances and shown. Decisions: D1, D2,
D24 in [decisions.md](decisions.md); [ADR-003](adr/003-money-representation.md) (representation),
[ADR-004](adr/004-split-rounding.md) (rounding), [ADR-005](adr/005-derived-balances.md)
(balances), [ADR-006](adr/006-atomic-writes.md) (writes). Code: [src/domain/money/](../src/domain/money/),
[src/lib/balances/](../src/lib/balances/) and [src/lib/format.ts](../src/lib/format.ts).

## Representation

- Every amount is an **integer number of minor units** (paise for INR): `bigint` in Postgres
  (columns end in `_minor`) and `BigInt` in TypeScript. No step in parsing, splitting, checking or
  formatting uses binary floating point.
- **Limit:** an expense is 1 to 999,999,999,999 minor units (₹9,99,99,99,999.99), enforced by the
  parser, the split engine and a database check. It keeps every amount and every sum of shares far
  inside JavaScript's safe-integer range, because amounts travel as JSON numbers between the database
  and the server. Code converts them back to `BigInt` before doing arithmetic.
- **One currency per household (D1)**, chosen at creation (default INR) and locked once the
  household has an expense (`households_lock_currency`). There's no conversion.

## Decimal places: ISO 4217, pinned in code

D2 says a currency's decimal places come from ISO 4217. They're pinned in
[currency.ts](../src/domain/money/currency.ts) (`isoMinorUnits`): 2 for every active currency, except
0 (e.g. JPY, KRW, VND), 3 (BHD, IQD, JOD, KWD, LYD, OMR, TND) and 4 (CLF, UYW).
`currencyExponent()` in `src/lib/format.ts` reads it.

Why not `Intl`? Measured on 2026-11-11, `Intl` (CLDR data) differs from ISO 4217 for 16 currencies in
Node 22 (e.g. IQD: ISO 3, CLDR 0; IRR, LAK, MMK: ISO 2, CLDR 0), and **Node and Edge disagree** on
COP, HUF, IDR and PKR. Before this was pinned, a PKR household's split preview (formatted in the
browser) showed 100× the amount the server parsed and saved. A stored amount means "minor units at
this exponent", so the exponent can't depend on the runtime.

- `formatMoney()` shows **exactly** the ISO decimal places (`minimumFractionDigits` and
  `maximumFractionDigits` are both set), so the browser can't round what's displayed.
- Codes with **no minor unit** (XAU, XDR, XSU, XTS, XXX and others) can't hold money in minor units.
  They're never offered, and the check `households_currency_has_minor_unit` rejects them. A unit
  test keeps the code list and the SQL list identical.

## Typed input

[amount.ts](../src/domain/money/amount.ts) parses text as digits, never as a float.

| Function                      | Accepts                                                                                                                                                               | Error codes                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `parseAmount(text, exponent)` | Digits with an optional `.` and at most `exponent` decimals. Commas only as Indian (1,25,000) or international (125,000) grouping. Greater than 0, at most the limit. | `empty`, `bad_grouping` (e.g. "12,50"), `malformed`, `too_many_decimals`, `not_positive`, `too_large` |
| `parsePercent(text)`          | 0 to 100 with at most two decimals, as **basis points** (1% = 100, 100% = 10000).                                                                                     | `malformed`, `too_large`                                                                              |

Nothing is rounded. Too many decimals is an error, never a rounding.

## The split engine

[split.ts](../src/domain/money/split.ts): `computeSplit(input)` is pure and deterministic. It doesn't
know the currency: it works in minor units, and the household's single currency only matters when
parsing and formatting.

- **Input:** `method` (`equal` | `percentage` | `custom`), `total` (minor units), and `participants`
  **in the order they joined the household**. Equal takes ids; percentage takes
  `{ userId, basisPoints }`; custom takes `{ userId, shareMinor }`.
- **Success:** `{ ok: true, method, total, shares }`. There's one `{ userId, shareMinor, percentageBp }`
  per participant, in input order, and they add up to `total` exactly.
- **Failure:** `{ ok: false, code, error, userId? }`. `code` is for code; `error` is a plain message
  for people; `userId` says whose input it is, when it's about one person.

| Method     | Rule                                                                                                                                                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Equal      | `floor(total / n)` each; the `total mod n` leftover units go one each to the earliest joiners. ₹1,000.00 three ways: 333.34, 333.33, 333.33.                                                                                                                                                              |
| Percentage | Basis points, whole numbers from 0 to 10000, totalling **exactly** 10000 (never normalised). Each share is `floor(total × bp / 10000)`; the leftover units go one each to the largest remainders, ties to the earliest joiner. A share is always its exact percentage or one unit more; 0% always gets 0. |
| Custom     | Whole minor units ≥ 0 that add up exactly to the total. A shortfall or excess is an error; nothing is redistributed. Unallocated amounts aren't supported.                                                                                                                                                |

| Code                     | Meaning                                                 |
| ------------------------ | ------------------------------------------------------- |
| `invalid_total`          | Total not a positive whole number within the limit      |
| `no_participants`        | No one to split with                                    |
| `invalid_participant`    | An empty or missing participant id                      |
| `duplicate_participant`  | Someone appears twice (`userId` says who)               |
| `invalid_percentage`     | A percentage isn't a whole number of bp from 0 to 10000 |
| `percentages_not_100`    | Percentages don't total exactly 100%                    |
| `invalid_share`          | A custom share isn't a whole number of minor units      |
| `negative_share`         | A custom share is below zero                            |
| `shares_not_equal_total` | Custom shares don't add up exactly to the total         |

The payer isn't part of the engine's input. Whether the payer shares the cost is up to whoever fills
in the form: a payer who isn't ticked simply has no share.

## Who may take part: trust boundaries

1. **The engine** checks only the shape of its input.
2. **`validateExpenseForm`** ([form.ts](../src/lib/expenses/form.ts)), on the server, checks the
   payer and every participant against the household's **active members, read on the server** under
   RLS (`listMembersInJoinOrder`). Ids typed into a form are never trusted. It then parses amounts
   with the household currency's exponent and calls the engine.
3. **`create_expense` / `update_expense`** (Postgres, `SECURITY DEFINER`) check again that the caller,
   the payer and every participant are active members, plus D6 edit rights. They write the expense,
   its splits and the journal entry in one transaction, and replace the whole split on edit.
4. **Deferred constraint triggers** check the money invariants at commit, for every write path,
   including the service role.

**Join order** comes from Postgres (`order by joined_at, user_id`), not from sorting strings in
TypeScript. String comparison of timestamps isn't reliably chronological (`localeCompare` puts
`…16.5+00:00` before `…16+00:00`).

## What the database checks, and what it leaves to the engine

The database refuses any split where:

- there are no participants, or the shares don't add up exactly to the amount;
- an equal split has shares more than one unit apart;
- a percentage split's basis points don't total 10000, or a share isn't its exact percentage
  (floored) or one unit more;
- a non-percentage split carries percentages.

It doesn't check **which** participants received the leftover units. On the app's path the engine
always decides that by the rule above. Someone calling `create_expense` directly could place those
single units differently, at most one unit per share, and everyone in the household can see it.
`supabase/tests/split-engine.test.ts` records this tolerance.

## Tests

| File                                                                                                                   | Covers                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [split.test.ts](../src/domain/money/split.test.ts)                                                                     | Worked examples, edge cases and every error code                                                                                                                                                  |
| [split.property.test.ts](../src/domain/money/split.property.test.ts)                                                   | Thousands of seeded generated cases per method: non-negative, one share each, exact sum, determinism, the exact equal rule, largest remainder; exact amount round-trips at 0, 2, 3 and 4 decimals |
| [amount.test.ts](../src/domain/money/amount.test.ts), [currency.test.ts](../src/domain/money/currency.test.ts)         | Parsing, grouping, decimal places, ISO table, exact display for every offered currency                                                                                                            |
| [form.test.ts](../src/lib/expenses/form.test.ts)                                                                       | Server-side validation with members and currency                                                                                                                                                  |
| [split-engine.test.ts](../supabase/tests/split-engine.test.ts), [expenses.test.ts](../supabase/tests/expenses.test.ts) | The database stores exactly what the engine produces and refuses broken splits                                                                                                                    |

## Expense history figures

Roadmap Phase 12 ([database.md](database.md#expense-history-roadmap-phase-12)). The history's summary
counts only the expenses that match the filters, and never a deleted one (D7). A household has one
currency (D1), so its figures never mix currencies.

- **Amount filters** are typed like any amount: `parseAmount` with the household currency's ISO
  decimal places, exact, more than zero, both ends included. "100.5" is refused for yen, never
  rounded.
- **Total and largest** are exact sums and amounts in minor units (text, parsed with `BigInt`).
- **Average** is the total divided by the count, rounded to the nearest minor unit with halves away
  from zero, the way Postgres rounds `numeric`. The app recomputes it with `BigInt` (`averageOf`)
  and refuses to show figures that differ.
- **Share of all counted spending** is shown in basis points, rounded half up with whole numbers
  only, as a percentage with up to two decimals.
- **Household figures** (all counted expenses and their total) sit next to the filtered ones, so
  the two are never confused. They equal the balances' "total spent".

## Balances

Roadmap Phase 9 (ADR-005, D7, D24), with settlements since roadmap Phase 10 (D8, D9). Balances
are worked out from the records every time they're shown, and never stored.

**Sign convention, everywhere:**
`net = paid − shares + settlements paid − settlements received`.

| Net      | Meaning                                            | Shown as                                      |
| -------- | -------------------------------------------------- | --------------------------------------------- |
| Positive | The person should get money back (others owe them) | "Owed", "+₹600.00", "should get back ₹600.00" |
| Negative | The person owes money                              | "Owes", "-₹300.00", "owes ₹300.00"            |
| Zero     | Settled up                                         | "Settled up", "₹0.00"                         |

- **Paid** is the whole amount of each counted expense the person paid for. **Share** is their split
  of each counted expense. **Counted** means not deleted (D7).
- **Pairs:** each participant owes the payer their share, and a payer's own share isn't owed to
  anyone. Between two people the two directions offset, so each pair shows one amount owed one way.
  Nothing moves between pairs: that would be debt simplification (Phase 21).
- **One currency:** a household has one currency, locked once it has an expense (D1). Balances are
  per household, so amounts in different currencies never meet. There's no conversion.
- **People who have left** stay in the balances while they're in counted expenses or settlements,
  shown as "(left)" (D13). They left at zero (D13, O8), and expenses involving them can't be edited
  or restored, so their balance changes only if one is deleted (D24), or if a settlement with them
  is voided (D9 allows it). Settling it is open (O9).

### Settlements

A settlement records that one person paid another back outside the app (D9). "Recorded in the
app — no money is moved."

- **In the balances:** a settlement from A to B that isn't voided adds its amount to A's
  _settlements paid_ and B's _settlements received_, and reduces what A owes B. In the pairs it's
  the same as B owing A that amount, so the two directions still offset within each pair.
  Expenses and their splits are never changed (D8).
- **Counted** means not voided. A settlement counts once it's recorded (there's no pending state,
  see O10) and stops counting once voided. It can't be edited or un-voided.
- **Partial amounts** are fine. **More than what's owed** is allowed, but warned about (D9): it
  turns the pair round, so the recipient then owes the payer the difference (D8). "What's owed" is
  the pair amount from the payer to the recipient right now. `record_settlement` refuses with
  `HJ017` and the current figure until the caller acknowledges exactly that figure, so a warning
  can't go stale.
- **Exactly once:** a settlement is one row, counted while `voided_at` is null. A repeated request
  key returns the first settlement, two people recording the same payment at once are serialized
  (the second gets the warning), and the reference implementation refuses a settlement listed twice
  (`duplicate_settlement`).
- **Same currency:** a settlement is in the household's one currency, which it locks (D1).
- **Bounds:** 1 to 999,999,999,999 minor units, like an expense, parsed by `parseAmount`.

### Invariants, and who checks them

| Invariant                                                             | Database                                              | App, before anything is shown                      |
| --------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| Each counted expense's shares add up to its amount                    | Write triggers; `assert_balances_reconcile` (`HJ013`) | `computeBalances` (`not_reconciled`)               |
| Each net is paid − shares + settlements paid − settlements received   | Computed that way (`person_balances`)                 | `checkBalances` (`net_mismatch`)                   |
| The nets add up to exactly zero                                       | Follows from the above                                | `checkBalances` (`not_zero_sum`)                   |
| Payments and shares each add up to the total spent                    | Follows from the above                                | `checkBalances` (`totals_mismatch`)                |
| Settlements paid and received each add up to the settlements recorded | Follows from the above                                | `checkBalances` (`totals_mismatch`)                |
| Who owes whom adds up to each person's net                            | Computed from the same rows (`balance_pairs`)         | `checkBalances` (`pairs_mismatch`, `invalid_pair`) |
| The expenses and settlements listed behind a balance add up to it     | Same snapshot                                         | `checkEntries` (`entries_mismatch`)                |
| No expense or settlement counted twice; one household only            | One row each; one query per household                 | `computeBalances` (`duplicate_*`, `foreign_*`)     |
| A settlement is between two different people, for more than zero      | Checks, `record_settlement` (`HJ016`, `23514`)        | `computeBalances` (`invalid_settlement`)           |
| A settlement never changes, apart from being voided once              | `settlements_protect` trigger, for every role         | —                                                  |

If any check fails, the page says the balances can't be shown and shows no figures. A wrong balance
is never shown as if it were right.

### Where it's calculated

- **Postgres** (`public.household_balances`, see [database.md](database.md#balances-roadmap-phase-9)
  and [settlements](database.md#settlements-roadmap-phase-10)) calculates what the app shows, as
  the signed-in member, under RLS, in one snapshot. `private.person_balances` and
  `private.balance_pairs` are the one definition of a balance and of who owes whom;
  `record_settlement`'s warning and `member_net_minor` (D13) use the same ones.
- **TypeScript** ([balances.ts](../src/domain/money/balances.ts)) is the reference implementation
  (`computeBalances`, `entriesFor`), plus the invariant checks the app runs on the database's answer.
- **Totals travel as text** and are parsed with `BigInt` ([parse.ts](../src/lib/balances/parse.ts)),
  because a household's totals aren't capped like a single expense and JSON numbers are doubles.
  Anything else is refused.
- **Words** ([explain.ts](../src/lib/balances/explain.ts)) are built only from those verified
  figures. Signed amounts in sentences carry an invisible WORD JOINER (U+2060) after the sign, so a
  line never breaks between "+" and "₹".

### Balance tests

| File                                                                                                           | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [balances.test.ts](../src/domain/money/balances.test.ts)                                                       | Worked examples (the ₹900 three-way split, one participant, leftovers, percentage, custom, several payers, settled households, people who have left), 1,000 generated households, totals beyond 2^53, every error code, lifecycle. Settlements: the brief's example, partial and several partial payments, several debtors to one creditor and one debtor to several, voided, more than owed, settlements without expenses, deleted expenses after settling (D8), 1,000 generated households with settlements and voids, tampered figures |
| [parse.test.ts](../src/lib/balances/parse.test.ts), [explain.test.ts](../src/lib/balances/explain.test.ts)     | Exact parsing and refusal of anything else, settlement fields included; wording, signs and decimals                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [form.test.ts](../src/lib/settlements/form.test.ts), [wording.test.ts](../src/lib/settlements/wording.test.ts) | The settlement form (zero, negative, decimals, yourself, people outside the household, missing fields, dates, notes); D9's wording, what a payment leaves and the warning                                                                                                                                                                                                                                                                                                                                                                 |
| [supabase/tests/balances.test.ts](../supabase/tests/balances.test.ts)                                          | SQL vs. TypeScript on generated expenses with edits, deletes and restores; lifecycle; D24; D13/O8 agreement; currencies; access; the HJ013 guard inside an uncommitted transaction                                                                                                                                                                                                                                                                                                                                                        |
| [supabase/tests/settlements.test.ts](../supabase/tests/settlements.test.ts)                                    | Recording and voiding and who may (D9); validation and forged ids; the warning (`HJ017`); retries and concurrent recordings and voids; immutability for every role; the journal; SQL vs. TypeScript with settlements, voids and deletes; D13, O9, D1, D14; access                                                                                                                                                                                                                                                                         |
| [e2e/balances.spec.ts](../e2e/balances.spec.ts), [e2e/settlements.spec.ts](../e2e/settlements.spec.ts)         | The pages in a browser, desktop and phone: recording from a balance, the review step, the warning, voiding, validation, non-members                                                                                                                                                                                                                                                                                                                                                                                                       |
