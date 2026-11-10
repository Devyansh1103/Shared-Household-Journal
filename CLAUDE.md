# Shared Household Journal

Records shared household expenses and home coordination. **The app never moves money.** Settlements are records only.

@AGENTS.md

## Key docs

- [docs/decisions.md](docs/decisions.md): decision register (D/A/O items)
- [docs/adr/](docs/adr/): architecture decision records
- [docs/roadmap.md](docs/roadmap.md): phases
- [docs/requirements-notes.md](docs/requirements-notes.md): domain model, security model, and amendments to the PRD/TRD PDFs
- [docs/design-system.md](docs/design-system.md): design tokens, typography, components
- [docs/knowledge-base.md](docs/knowledge-base.md): glossary and repository facts
- [docs/money.md](docs/money.md): money representation, ISO 4217 decimals, the split engine, rounding and error codes

## Commands (npm only)

| Command                                   | Purpose                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `npm run dev`                             | Dev server. Dev-only pages live under `/dev`, e.g. `/dev/design-system`. |
| `npm run build`                           | Production build. `next build` does not lint.                            |
| `npm run lint`                            | ESLint                                                                   |
| `npm run typecheck`                       | `next typegen && tsc --noEmit`                                           |
| `npm test`                                | Vitest (`src/**/*.test.ts`)                                              |
| `npm run format` / `npm run format:check` | Prettier with Tailwind class sorting                                     |

## Architecture (confirmed)

**Framework**

- Next.js 16 App Router with TypeScript (strict). Code lives in `src/`, with the `@/*` alias.
- `cacheComponents` and `partialPrefetching` are enabled.
- Request APIs are async-only. Middleware is now called `proxy.ts`.

**Styling and components**

- Tailwind v4 (CSS-first config) with tokens in [src/app/globals.css](src/app/globals.css).
- shadcn/ui on the Radix base, in `src/components/ui`. These components are owned by the repo and can be edited.
- `cn` comes from the `cn` package.

**Typography and colour**

- Font: Plus Jakarta Sans.
- Light mode only.
- Formatting locale: `en-IN`.

**Data**

- Supabase: Postgres, Auth, RLS, with atomic Postgres functions for money writes. Local only, in Docker.
- Migrations in `supabase/migrations/`; schema and access rules in [docs/database.md](docs/database.md).
- RLS helpers live in the unexposed `private` schema. Regenerate types with `npm run db:types` after a migration.
- `npm run test:db` runs RLS and Auth tests against the local stack (`npm run db:start`); they are not part of `npm test`.
- `npm run test:e2e` runs Playwright tests (`e2e/`) against `next start` on port 3100; needs `npm run build` and the local stack. Set `PLAYWRIGHT_CHANNEL=msedge` to use the installed Edge.

**Auth** ([docs/auth.md](docs/auth.md))

- Supabase Auth, email and password, with cookie sessions via `@supabase/ssr`. Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- `src/proxy.ts` only refreshes the session. Check the user with `requireUser()` from `src/lib/auth/session.ts` in every protected page, layout and Server Action.
- Session reads need a `<Suspense>` boundary (`cacheComponents`). Validate Server Action input with Zod; take user ids from the session, never from the form.

## Rules

- **Git:** commits use the owner's identity only. No AI co-author trailers or tool attribution in commits, PRs or files. Commit locally, but never push.
- **Money:**
  - Store integer minor units (bigint). Never use floats.
  - Splits must add up exactly to the total.
  - Balances are derived, never trusted from the client.
  - Format money only through `src/lib/format.ts`.
- **Security:**
  - Household membership is the authorization boundary, enforced by RLS and server code.
  - Never expose service-role keys to the browser.
  - Never print `.env` values. Document variable names only, in `.env.example`.
- **Migrations:** additive only. Ask before any destructive or data-changing operation.
- **UI:**
  - Use the design tokens and `type-*` utilities, not hard-coded colours.
  - Don't use opacity colours behind text.
  - Every token pair must pass `src/app/tokens.test.ts`.
  - Never use colour as the only signal.
- **Decisions:** don't silently decide Open items in `docs/decisions.md`.

## Workflow

- Work one phase and one bounded task at a time: audit, then a short plan, then edits.
- Run the real checks after changes. Report the commands run, their results, and any checks not run.
- Preserve existing working code and uncommitted user changes.
