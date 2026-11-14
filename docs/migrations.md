# Database migrations

Schema changes live in [supabase/migrations/](../supabase/migrations/), one SQL file each, applied
in filename order (a `YYYYMMDDHHMMSS_` timestamp). What each one does is described in
[database.md](database.md). There are 16 so far, ending with `20261121120000_operations.sql`
(roadmap Phase 18).

## Rules

- **Additive only** (CLAUDE.md). A migration may create tables, columns, functions, policies and
  indexes, or replace a function with the same signature. It must not drop or rename anything in
  use, rewrite existing rows, or tighten a constraint that existing rows could break. Anything
  destructive or that changes data needs the owner's explicit approval first.
- **Never edit or delete a migration once it has been applied anywhere** but your own local stack.
  Fix forward with a new migration.
- **Every new table** needs RLS enabled and its privileges revoked from `anon`, `authenticated`
  and `PUBLIC`, then granted back only as needed. Supabase's default privileges grant everything on
  new objects in `public`. **Every new function** needs `revoke all … from public` (and from
  `anon`), an explicit grant, and `set search_path = ''`. The catalog test in
  [supabase/tests/authorization.test.ts](../supabase/tests/authorization.test.ts) fails if any of
  this is missed; update its expected grants only for a deliberate, reviewed change.
- **Money writes** go through `SECURITY DEFINER` functions that take the caller from `auth.uid()`
  and check membership themselves ([ADR-006](adr/006-atomic-writes.md)).
- New error codes continue the `HJ0nn` sequence (now up to `HJ034`) and are listed in
  [database.md](database.md).

## Making one

1. Create the file with a version **after the latest one**, for example
   `20261122120000_<name>.sql`. The versions here run ahead of the calendar (one day per roadmap
   phase), so `npx supabase migration new`, which stamps today's time, would sort the new file
   before ones already applied, and `supabase db push` would refuse it as out of order.
2. Write it, then apply it to the local stack. To keep local data, apply just the new file
   (`docker exec -i supabase_db_RoomMate psql -U postgres -d postgres -v ON_ERROR_STOP=1 < file.sql`)
   and record it in `supabase_migrations.schema_migrations`, or rebuild the local stack from all
   migrations with `npx supabase db reset` (local only; it deletes local data).
3. `npm run db:types` to regenerate `src/lib/supabase/database.types.ts`.
4. Run the checks: `npm run typecheck`, `npm test`, `npm run test:db` (including the catalog and
   attack tests), and `npm run test:e2e` if pages changed.
5. Document it in [database.md](database.md).

## Releasing one

Apply migrations **before** deploying the app version that needs them, so the running app is never
newer than its database:

```sh
npx supabase link --project-ref <project ref>   # once per machine
npx supabase db push --dry-run                   # lists what would be applied; read it
npx supabase db push
```

Do it on the staging project first and run the checks in
[deployment.md](deployment.md#6-deploy-and-check) there. Because migrations are additive, the app
version already running keeps working once the new one is applied, and an app rollback never needs
a database rollback.

## If a migration goes wrong

- **It failed:** the CLI stops at that file and doesn't record it as applied. Check in the SQL
  editor whether any of its statements took effect, fix the file, and push again.
- **It applied but is wrong:** write a new migration that corrects it. Don't edit the old one.
- **It damaged data:** stop writes if you can (pause the Vercel project), then see
  [backup-recovery.md](backup-recovery.md). Never run `supabase db reset` against a hosted project.
