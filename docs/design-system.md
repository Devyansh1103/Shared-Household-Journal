# Design System

The shared UI foundation for Shared Household Journal, built in Phase 2.

When the app is running in development (`npm run dev`), you can see everything on this page at `/dev/design-system`. That route returns a 404 in production builds.

## Principles

- **Tone:** warm, calm, practical. A shared-home journal, not a finance dashboard.
- **Hierarchy:** use clear hierarchy instead of decoration. Keep shadows and borders restrained. No gradients or glass effects.
- **Money:** amounts are easy to scan. Use tabular figures, and always state the direction in words ("You owe", "You are owed").
- **Colour:** colour never carries meaning on its own. Status always pairs colour with an icon and text.
- **Settlements:** never imply that money moved. Settlement surfaces say "Recorded in the app — no money is moved."

## Where things live

| Concern                                              | Location                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Design tokens (CSS variables) and type utilities     | [src/app/globals.css](../src/app/globals.css)                                              |
| Token contrast test (WCAG AA)                        | [src/app/tokens.test.ts](../src/app/tokens.test.ts)                                        |
| shadcn/ui primitives (Radix base, owned by the repo) | [src/components/ui/](../src/components/ui/)                                                |
| Layout primitives                                    | [src/components/layout/](../src/components/layout/)                                        |
| Project components                                   | [src/components/](../src/components/): `Amount`, `StatusBadge`, `EmptyState`, `ErrorState` |
| Money and date formatting                            | [src/lib/format.ts](../src/lib/format.ts)                                                  |
| Showcase (dev only)                                  | [src/app/dev/design-system/](../src/app/dev/design-system/)                                |

Tokens are defined once, as hex values in `:root`. `@theme inline` maps each one to a Tailwind utility, for example `--success` becomes `text-success` and `bg-success`. Don't hard-code colours in components.

## Colour

The PRD palette is kept as **brand** tokens. Brand tokens are for fills, icons, illustration and charts. They are not for body text: the PRD primary `#4F7CAC` is only 4.36:1 on white.

Text, and white text on coloured fills, uses darker shades that meet WCAG AA (decision D16). [src/app/tokens.test.ts](../src/app/tokens.test.ts) checks every pairing below, so `npm test` fails if a token change breaks contrast.

| Token                                                      | Hex                               | Use                                                   |
| ---------------------------------------------------------- | --------------------------------- | ----------------------------------------------------- |
| `brand-primary` / `brand-secondary` / `brand-accent`       | `#4F7CAC` / `#7FB069` / `#F4A259` | Icons, illustration, charts, focus ring               |
| `background`                                               | `#FAF8F5`                         | Page background                                       |
| `card`, `popover`                                          | `#FFFFFF`                         | Cards, panels, inputs, menus                          |
| `foreground`                                               | `#2D3748`                         | Main text                                             |
| `muted` / `muted-foreground`                               | `#F3F0EB` / `#5B6474`             | Quiet surfaces / secondary text                       |
| `primary` / `primary-hover`                                | `#3F6A99` / `#345A84`             | Primary buttons (white text 5.6:1), links             |
| `secondary` / `secondary-foreground`                       | `#EEF5E9` / `#44722F`             | Supportive actions (sage)                             |
| `highlight-subtle` / `highlight-foreground`                | `#FDF1E6` / `#9A5212`             | Brand-accent highlights (apricot)                     |
| `success`, `warning`, `info`                               | `#15803D`, `#B45309`, `#3F6A99`   | Status text and icons, on their `-subtle` backgrounds |
| `destructive` / `destructive-hover` / `destructive-subtle` | `#C53030` / `#A82828` / `#FDECEC` | Errors and destructive actions                        |
| `border`                                                   | `#E6E1D9`                         | Dividers, card edges (decorative)                     |
| `input`                                                    | `#857F76`                         | Form control borders (≥ 3:1)                          |
| `ring`                                                     | `#4F7CAC`                         | Focus ring (≥ 3:1 on card and background)             |

**Naming note:** in shadcn, `accent` means the hover or selected background in menus. The PRD's apricot "accent" is therefore called `highlight`, so the two are never confused.

**Avoid opacity-based colours** such as `bg-primary/80` behind text. Their contrast can't be token-tested, and the axe scan caught exactly this problem in Phase 2. Use a named token instead.

## Typography

There is one typeface: **Plus Jakarta Sans** (decision F1), loaded with `next/font` using `display: swap`.

The Phase 2 prompt suggested Inter for body text. Decision F1 takes precedence. Inter would be a new decision.

Typography roles are `type-*` utilities. They are deliberately not named `text-*`, so the `cn()` class merger never treats them as colour or size classes.

| Utility              | Use                                                     |
| -------------------- | ------------------------------------------------------- |
| `type-page-title`    | One per page (`h1`). Fluid 24 → 32px. Wraps long names. |
| `type-section-title` | Section headings (`h2`), 20px                           |
| `type-card-title`    | Card headings, 16px semibold                            |
| `type-body`          | Paragraph text, 16px / 1.6                              |
| `type-secondary`     | Supporting text, 14px muted                             |
| `type-label`         | Field and data labels, 14px medium                      |
| `type-help`          | Form help and captions, 13px muted                      |
| `type-amount`        | Inline money: tabular figures, no wrapping              |
| `type-amount-lg`     | Headline money, fluid 24 → 32px                         |
| `type-timestamp`     | Dates and times, 13px tabular, muted                    |

## Money and dates

- `<Amount minor={…} currency="INR" tone? size? />` formats integer minor units with `en-IN` grouping, for example ₹1,23,45,678.90. It never converts through floating point, and it shows exactly the currency's ISO 4217 decimal places (see [money.md](money.md)), the same in every browser. Tones are `neutral`, `positive`, `negative` and `muted`. A tone is only a hint, so always state the direction in words.
- **Balances** use the sign convention in [money.md](money.md#balances): positive is owed, negative owes. In running text, `formatBalance` keeps the sign and the amount on one line. Rows that pair a name with large amounts must wrap, not overlap, on a 320px screen.
- `formatDate("YYYY-MM-DD")` formats a calendar date without shifting it across timezones.
- `formatDateTime(instant, timeZone)` formats an instant in the household's timezone (decision D11).
- `formatTime` ("10:30 am"), `formatWeekdayTime` ("Fri, 10:30 am") and `formatLongDate`
  ("Friday, 6 November 2026", a calendar date) were added for the journal's day headings (Phase 13).

## Spacing, layout and breakpoints

- **Scale:** Tailwind's 4px spacing scale.
- **Page gutters:** 16 / 24 / 32px at mobile / `sm` / `lg`, via `PageContainer`.
- **Content width:** `max-w-page` (72rem). Readable text uses `max-w-prose-narrow` (42rem).
- **Vertical rhythm:** sections stack with `space-y-8` to `space-y-10`. Inside a section, use `space-y-4`.
- **Breakpoints:** Tailwind defaults: `sm` 640, `md` 768, `lg` 1024, `xl` 1280 and `2xl` 1536px. Design mobile-first.
- **Radius:** `--radius` is 12px, with derived `rounded-sm` through `rounded-4xl`.
- **Shadows:** `shadow-card` (used on cards) and `shadow-raised`.
- **Layout primitives:** `PageContainer`, `PageHeader` (title, description, actions that wrap on mobile) and `Section` (an `h2` with optional description and actions).

## Application shell

Built in Phase 3 (after Phase 6). Signed-in pages (`src/app/(app)/layout.tsx`) get:

| Width           | Layout                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| ≥ 1024px (`lg`) | Sticky 256px sidebar: logo, household switcher, main nav, and account (name → Profile, Sign out) at the foot.                  |
| < 1024px        | Sticky top bar (logo, household switcher) and a fixed bottom tab bar with icon + text labels. Sign out is on the Profile page. |

- **Main nav** ([src/lib/navigation.ts](../src/lib/navigation.ts), unit-tested): Home; then Household, Expenses and Balances (only inside one of your households); then Profile. Only routes that exist are listed (D23); each feature phase adds its entry with its pages. The bottom bar fits five labelled tabs at 360px (checked in `e2e/balances.spec.ts`), so settlements (roadmap Phase 10) have no tab of their own: Balances stays active on `/settlements` pages (`alsoMatches`). The same goes for the journal (roadmap Phase 13) and bills (roadmap Phase 14), under Household, which links to both.
- **Active item:** `aria-current="page"`, a heavier weight and an indicator bar, so it never relies on colour alone.
- **Household switcher** ([src/components/shell/household-switcher.tsx](../src/components/shell/household-switcher.tsx)): the current household is read from the URL (`/households/[householdId]`) and is shown only if it's one of yours. Switching is plain navigation, so each page loads its own data on the server. Nothing is stored in the browser.
- **Fresh after changes:** actions that change your list of households (create, join, leave, delete) call `revalidatePath("/", "layout")` before redirecting.
- **Resilient:** if the household list can't be loaded, the shell falls back to a "Your households" link and the page still renders its own error state.
- **Skip link** "Skip to main content" is the first Tab stop.
- **Toasts** are lifted above the bottom tab bar (`--toast-offset-bottom` in `globals.css`).
- **Hidden previous pages:** Next.js keeps the previous page mounted but hidden after a client navigation. Browser tests must match visible elements only.

## Components

**shadcn/ui primitives (Radix base)**

- Button, Input, Textarea, NativeSelect, Checkbox, RadioGroup, Field
- Card, Badge, Avatar, Separator, Tooltip
- Dialog, AlertDialog, DropdownMenu, Sonner (toasts), Skeleton, Spinner, Empty, Alert

**Project changes to the shadcn defaults**

- **Touch-friendly sizes:**
  - Buttons: 40px by default, `sm` 36px, `lg` 44px, `icon` 40px.
  - Inputs and selects: 40px tall.
  - Menu items: 36px tall.
- **Focus rings:** a solid `ring-ring` instead of 50% opacity.
- **Destructive buttons:** solid (white on `#C53030`) instead of a translucent tint.
- **Hover states:** use named tokens (`primary-hover`, `secondary-hover`, `destructive-hover`).
- **Badges:** gained `success`, `warning`, `info` and `highlight` variants.
- **Toasts:** use the light theme only (decision D19). The `next-themes` dependency was removed.
- **Selects:** native `<select>` (`NativeSelect`) instead of a custom listbox. It gives the platform picker on mobile and is simpler for assistive technology.

**Project components**

- `StatusBadge`: icon plus label for `success`, `warning`, `danger`, `info` and `neutral`.
- `BalanceBadge` and `BalanceAmount` ([src/components/balance.tsx](../src/components/balance.tsx)): a balance's direction as an icon and a word ("Owed", "Owes", "Settled up"), and the signed amount toned to match. The direction is always in words too, and the sign is always shown, so colour is never the only signal.
- `EmptyState`: icon, title, description and a "next step" action.
- `ErrorState`: an alert that explains what happened and what to do next, with an optional recovery action.
- `SettlementNotice` ([src/components/settlement-notice.tsx](../src/components/settlement-notice.tsx)): D9's "Recorded in the app — no money is moved." with an icon, and optional context after it. Every settlement surface shows it: the history, the form and its review step, a payment's page, the settlement parts of the balances pages, and the journal whenever it shows payments.
- `FormAlert` tones: `error`, `success`, `info` and `warning` (roadmap Phase 10, for D9's "more than what's owed"). The expense history (Phase 12) uses `success` after a delete and `info` for a page past the end. The `warning` tone uses the `Alert` `warning` variant: `warning` text on `warning-subtle`, a pair `tokens.test.ts` already checks, with a triangle icon so it never relies on colour.

**Settlement wording** ([src/lib/settlements/wording.ts](../src/lib/settlements/wording.ts), unit-tested): "Record a payment", "Payment from Pat to Olive", D9's "Pat recorded a payment of ₹300.00 to Olive.", statuses "Recorded" and "Voided" (icon and word). Never "sent", "transferred" or anything suggesting the app moved or checked money. Recording has a review step that shows who paid whom, the amount and currency, the date and the note, says what the record does to the balances, and that the app can't check the payment happened.

## Interaction states and forms

Every control has default, hover, `focus-visible` (solid 3px ring) and disabled states. Disabled controls use `disabled:opacity-50` plus `cursor-not-allowed`.

**Loading**

- Buttons: disable the button, set `aria-busy`, and show a `Spinner` (marked `aria-hidden`) next to the text, for example "Saving…".
- Regions: use `Skeleton`s inside a container with `role="status"`, `aria-busy` and a label.

**Forms**

- The label sits above the field. Help text and errors go directly below it.
- Set `aria-invalid` on the field. Errors render in `FieldError`, which has `role="alert"`, and are linked to the field with `aria-describedby`.
- Error messages say how to fix the problem.
- Entered values are kept when validation fails.

**Search and filters** (the expense history, roadmap Phase 12)

- **The URL holds the view.** Filters are a GET form, so they work without JavaScript. With
  JavaScript, the form navigates to a clean URL (no empty fields, no defaults), and any change goes
  back to page 1. A view can be refreshed, bookmarked or shared.
- **Uncontrolled fields restart after a navigation.** A filter form whose fields use `defaultValue`
  is keyed by the URL's filters. Otherwise a value that was typed in would outlive "Clear all" or a
  removed chip, and the next change would send it again (caught by `e2e/expense-history.spec.ts`).
- **Active filters** show as removable chips under the form ("Showing only: …"). Each chip is a link
  to the same view without that filter, with an `aria-label` like "Remove filter: Groceries", plus
  "Clear all".
- **A sort** applies as soon as it's chosen. Date ranges are presets (Today, This week, This month,
  Previous month) or custom dates; the date fields are enabled, and sent, only for custom dates.
- **Loading:** the results sit in a `Suspense` keyed by the view, so every change shows a skeleton,
  never the old figures. The submit button shows a spinner while the navigation runs.
- **Pages:** a `nav` labelled "Pages" with "Page 2 of 7" in words and First, Previous, Next and Last
  (each with an `aria-label`). At either end they're disabled buttons, not links.
- **Invalid filters** are marked on their fields, the filters open, and no results are shown until
  they're fixed. An empty result says so and offers "Clear all filters".

**Timeline** (the household journal, roadmap Phase 13; [journal.md](journal.md))

- **Days as sections.** Each day heading ("Today", "Yesterday", "Earlier this week", then
  "Friday, 6 November 2026") is an `h2` labelling a `section` with an ordered list, newest first,
  in the household's timezone.
- **An entry** is an icon on a tinted circle (hidden from screen readers), a sentence saying who did
  what, what it was about, what changed (old `→` new; screen readers hear "to"), then a `<time>`, the
  kind in words (Expense, Payment, Household) and a link. The tints are tested token pairs
  (`info`/`info-subtle`, `secondary-foreground`/`secondary`, `highlight-foreground`/`highlight-subtle`)
  and never the only signal.
- **Links say what they open,** with the record in their accessible name when several would sound
  alike ("View expense: Groceries"). An accessible name always starts with the visible words
  (WCAG 2.5.3).
- **Filters are links** with `aria-current`, a check icon and a heavier weight. "Show older activity"
  and "Back to the latest" are links too, so every view has its own URL.
- **Links to a part of a streamed page** (`/households/[id]#members`) need `ScrollToHash`
  ([src/components/scroll-to-hash.tsx](../src/components/scroll-to-hash.tsx)) inside the streamed
  content: Next.js scrolls to a fragment when the navigation commits, before a Suspense boundary has
  rendered the target (caught by `e2e/journal.spec.ts` on a phone). The target `section` gets
  `scroll-mt-20` so the sticky top bar doesn't cover its heading.

**Bills** (roadmap Phase 14; [bills.md](bills.md))

- **Grouped by when:** Overdue, Due today, Due in the next 7 days, Coming up, Paid recently, Paused,
  Ended; a group only appears when it has something. Each row says it in words with an icon
  (`StatusBadge`: Overdue is danger, Due today warning, Due soon info, Upcoming neutral, Paid
  success), with the due date in words ("3 days overdue") and as a date.
- **"Expected"** labels a bill's amount; an actual amount appears only on a recorded period, with a
  link to its expense. "Paid on time" or "Paid late" compares the expense's date with the due date.
- **Recording** is the expense form, pre-filled; the record link's accessible name names the bill
  and the date ("Record Rent due 1 Dec 2026").
- **The schedule** shows its next four due dates as it's chosen, by the database's own rules.

**Shopping list and chores** (roadmap Phase 15; [shopping-chores.md](shopping-chores.md))

- **Quick add.** The shopping list's form sits at the top of the list and stays there: after an
  add it's empty again with a fresh request key, and says what was added (`FormAlert` `success`).
- **One-tap actions** (`ActionButton`, [src/components/action-button.tsx](../src/components/action-button.tsx)):
  "Mark bought", "Still needed", "Mark done", "Not done". No confirmation, since the opposite button
  undoes them; a toast says what happened, and an error shows under the button. Removing an item or
  a chore confirms with an `AlertDialog` ("Keep item" is the safe choice). Each button's accessible
  name is its visible words, then the record: "Mark bought: Milk (2)" (WCAG 2.5.3).
- **Filters are links** (`FilterChips`, [src/components/filter-chips.tsx](../src/components/filter-chips.tsx)),
  as in the journal: Still needed / Bought / All, Anyone / Mine / Unassigned / each member, and for
  chores To do / Done / All and a priority.
- **Chores by when:** My tasks, Overdue, Due today, Upcoming, Any time, Done; each chore appears once,
  in words with an icon (`StatusBadge`: Overdue danger, Due today warning, Upcoming neutral, Done
  success). Priority is a word too: "High priority" (`warning`), "Medium priority", "Low priority"
  (outline).
- **Who's doing it** (`AssigneeField`, [src/components/assignee-field.tsx](../src/components/assignee-field.tsx)):
  a native select with Nobody, the current members ("(you)" for the viewer), and a former
  assignee marked "(left)" only while it's still theirs.
- **Journal tints:** Shopping is `success`/`success-subtle`, Chores `accent-foreground`/`accent`,
  both pairs `tokens.test.ts` checks.

**Budgets and analytics** (roadmap Phase 16; [budgets.md](budgets.md))

- **Budget cards:** what it covers (`h3`) and its period, the status as a `StatusBadge` (Nothing
  spent yet neutral, On track success, Near limit warning, Over budget danger), "₹7,000.00 spent of
  ₹8,000.00", a bar, then "87.5% used · ₹1,000.00 left" or "₹4,000.00 over the limit" in words. The
  bar is `aria-hidden` (`bg-primary` on `bg-muted`, `bg-warning-fill` near the limit, `bg-destructive`
  over it) and never the only signal.
- **Charts are tables:** each row is a label (`th`), a decorative bar and the figures, so screen
  readers get the same numbers; the bar sits under the label on a phone. A table wider than the screen
  scrolls inside a focusable, labelled region (`tabIndex={0}`, `role="region"`), so it can be
  scrolled by keyboard (axe `scrollable-region-focusable`). No chart library.
- **Periods:** chips for Weekly, Monthly and Quarterly, then Previous and Next (Next disabled at the
  current period) with the period in words ("November 2026 (this month)").
- **Paid against share** is two labelled columns with an explanation, never one "spending per
  person" figure.
- **Journal tint:** Budgets is `warning`/`warning-subtle`, a pair `tokens.test.ts` checks.

**Forms keep what was submitted.** React resets a form's fields after its action, even when the
action comes back with errors. Text inputs come back from the submitted values, but a select goes
back to its first default and a Radix checkbox to its first tick, silently: a changed payer or an
unticked person would come back unnoticed. Forms that show errors (the expense form, the bill
forms, and since roadmap Phase 15 the item and chore forms) number each answer and give their fields a `key` from it, so the fields start again from
what was submitted, and selects stay **uncontrolled** (`defaultValue`): a controlled select has no
default, so a reset would show its first option. Found in roadmap Phase 14; `e2e/bills.spec.ts`
checks a payer, a category and a tick after an error.

**Destructive actions**

- Always confirm with an `AlertDialog`.
- Initial focus goes to the safe option.
- Button labels name the action, for example "Delete expense" and "Keep expense".

## Accessibility baseline

- Semantic landmarks and headings: one `h1` per page, sections use `h2`.
- `html lang="en-IN"`.
- Icon-only buttons have an `aria-label`. Decorative icons have `aria-hidden`.
- Overlays come from Radix, which handles the focus trap, Escape to close, and returning focus to the trigger.
- A visible outline is applied globally to links and custom focus targets.
- `prefers-reduced-motion` shortens all animations and transitions.

## Verifying changes

| Command                | Checks                                          |
| ---------------------- | ----------------------------------------------- |
| `npm test`             | Formatting helpers and the token contrast pairs |
| `npm run lint`         | ESLint                                          |
| `npm run typecheck`    | Route type generation, then `tsc`               |
| `npm run build`        | Production build                                |
| `npm run format:check` | Prettier formatting                             |

In Phase 2, the pages were also checked in a real browser (Edge, driven by Playwright from outside the repo):

- No horizontal overflow at 360, 390, 768, 1024 and 1440px.
- axe WCAG 2.1 A/AA scans.
- Form validation behaviour.
- Keyboard focus visibility.
- Dialog focus management.

Repeat these checks when changing shared UI.

Since Phase 8, Playwright is a project dependency (A6): `npm run test:e2e` runs `e2e/*.spec.ts`
against `next start` on port 3100 (run `npm run build` and `npm run db:start` first). Set
`PLAYWRIGHT_CHANNEL=msedge` (or `chrome`) to use an installed browser, or run
`npx playwright install chromium` once. It runs a desktop and a Pixel 7 project.

**Unique ids in forms.** Next.js keeps the previous page mounted (hidden) after a client
navigation, so the same form component can be in the document twice (for example "Add expense"
and "Edit expense"). Fixed ids then clash, and a label can point at the hidden copy. Build ids for
reusable forms from React's `useId()`. In browser tests, match visible elements only and wait for
the new page's heading after navigating: the URL changes before the page streams in.
