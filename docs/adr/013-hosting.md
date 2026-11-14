# ADR-013: Production hosting

- **Status:** Accepted. Decided by the owner on 2026-11-14 (item O1, roadmap Phase 18).

## Context

No deployment configuration existed. TRD §12 says the production host must not be chosen without
the owner's decision. The app is a Next.js 16 App Router project with Partial Prerendering
(`cacheComponents`), server-side Supabase access only, and a Supabase database with RLS and
`SECURITY DEFINER` functions.

## Options

- **Vercel with hosted Supabase:** the suggestion.
- **Self-hosted Node with hosted Supabase**
- **Other platforms**

## Decision

**Vercel** runs the app; a **hosted Supabase** project holds the database and Auth. A separate
Supabase project serves staging and Vercel's preview deployments.

## Consequences

- No hosting configuration file is needed: Vercel builds Next.js as it is. The Node version comes
  from `engines` in `package.json` (22.x); the functions' region is set in the Vercel project, next
  to the Supabase region.
- The app needs only the two public variables (O4); the secret key stays out of Vercel.
- Settings that live in the hosted projects (Auth URLs and templates, SMTP, rate limits, exposed
  schemas, backups) are applied by hand from [deployment.md](../deployment.md); `config.toml`
  configures only the local stack.
- Rate limiting at the edge uses Vercel's Firewall ([security.md](../security.md) S4).
- Rolling back the app is promoting the previous deployment; the database is never rolled back
  with it, which is why migrations stay additive ([migrations.md](../migrations.md)).
- Nothing has been deployed: deploying needs the owner's accounts and explicit authorization.

## Repository evidence

[docs/deployment.md](../deployment.md), [docs/environment.md](../environment.md),
[next.config.ts](../../next.config.ts), [src/instrumentation.ts](../../src/instrumentation.ts),
[src/app/api/health/route.ts](../../src/app/api/health/route.ts).
