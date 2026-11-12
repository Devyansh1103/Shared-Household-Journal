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

- **Main nav** ([src/lib/navigation.ts](../src/lib/navigation.ts), unit-tested): Home; then Household, Expenses and Balances (only inside one of your households); then Profile. Only routes that exist are listed (D23); each feature phase adds its entry with its pages. The bottom bar fits five labelled tabs at 360px (checked in `e2e/balances.spec.ts`), so settlements (roadmap Phase 10) have no tab of their own: Balances stays active on `/settlements` pages (`alsoMatches`).
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
- `SettlementNotice` ([src/components/settlement-notice.tsx](../src/components/settlement-notice.tsx)): D9's "Recorded in the app — no money is moved." with an icon, and optional context after it. Every settlement surface shows it: the history, the form and its review step, a payment's page, and the settlement parts of the balances pages.
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
