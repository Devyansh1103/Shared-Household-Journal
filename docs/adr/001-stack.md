# ADR-001: Stack: Next.js App Router, TypeScript, Tailwind, shadcn/ui, npm

- **Status:** Confirmed (2026-11-02). Decisions A1, A2, A5.

## Context
The repository had no code. TRD §1 recommends Next.js, TypeScript, Supabase, Tailwind, shadcn/ui, and Zod for a new project.

## Options
- Next.js (App Router)
- Vite + React single-page app with a separate API
- Remix

## Decision
Use Next.js (App Router) with TypeScript in strict mode, at the current stable version (verified at install time). Add the following:
- Tailwind CSS
- shadcn/ui components, copied into the repository and built on Radix
- lucide icons
- Zod for validation
- npm as the package manager

Additional rules:
- No state-management library. Data is loaded on the server, and filter state lives in the URL.
- Server Components handle reads. Server Actions handle mutations.

## Consequences
- Sensitive work stays on the server, and no separate backend service is needed.
- npm is the only package manager installed on the development machine.
- Next.js has frequent releases, so the version is pinned in the lockfile.

## Repository evidence
None in code. At commit `c799c9d` the repository contained only the planning PDFs (see [phase-0 audit](../audits/phase-0.md)). Sources: TRD §1.
