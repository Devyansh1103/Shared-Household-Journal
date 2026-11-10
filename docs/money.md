# Money and splits

How amounts are represented, parsed, split and shown. Decisions: D1, D2 in
[decisions.md](decisions.md); [ADR-003](adr/003-money-representation.md) (representation),
[ADR-004](adr/004-split-rounding.md) (rounding), [ADR-006](adr/006-atomic-writes.md) (writes).
Code: [src/domain/money/](../src/domain/money/) and [src/lib/format.ts](../src/lib/format.ts).

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

## For balances (next phase)

Balances add up many expenses, so a balance can exceed the per-expense limit. Sum in SQL (`bigint`
or `numeric`), send totals as **text**, and parse them with `BigInt`. Don't send them as JSON numbers.
`private.member_net_minor` already sums in SQL; settlements must be added to it (Phase 10).
