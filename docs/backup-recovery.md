# Backup, recovery and retention

## What holds data

| Part                           | Holds                                                                                                 | Backed up by                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| The Supabase Postgres database | Everything: accounts (`auth` schema), profiles, households, money records, the journal, notifications | Supabase's backups, plus your own dumps (below) |
| The app on Vercel              | Nothing: it keeps no state between requests                                                           | Git (the code) and Vercel's deployment history  |
| File storage                   | Nothing: no storage buckets exist (no uploads)                                                        | —                                               |
| Auth emails                    | Sent through your SMTP service; nothing the app needs                                                 | —                                               |

So a backup of the database is a backup of the app.

## Backups

1. **Supabase's backups.** What you get (daily backups, how long they're kept, and Point-in-Time
   Recovery as an add-on) depends on the production project's plan. Check it before launch and
   choose a plan whose loss window you can accept: with daily backups alone, a restore can lose up
   to a day of records; Point-in-Time Recovery narrows that to minutes.
2. **Your own dumps**, kept outside Supabase, before each release that includes a migration and on
   a schedule you choose. Follow Supabase's guide "Backup and restore using the CLI"
   (`npx supabase db dump` for roles, schema and data), and check what the dump includes before
   relying on it.

Dumps contain personal data (names, email addresses, every household's records). Keep them
encrypted, in one place with restricted access, and delete them on the same schedule as the
provider's backups.

## Retention (O2)

Decided by the owner on 2026-11-14: **records are kept until they're deleted**, with no automatic
expiry.

- A household's records are kept until its owner deletes the household (when they're the only
  member left, D14). That deletion is permanent and removes everything in the household.
- An account's profile is kept until the account is deleted, which anonymises it to "Former
  member" and keeps the records others rely on (D14, [operations.md](operations.md#deleting-an-account-d14)).
- Voided payments, deleted expenses, removed items and chores, and the journal are kept with their
  household (D7, D9, D28); they're part of its history.
- **Backups keep deleted data until they age out.** Keep a register of account deletions (the user
  id and the date only) so they can be done again after a restore.

## Recovery

### The app is broken after a deployment

Promote the previous deployment in Vercel ([deployment.md](deployment.md#rolling-back)). The
database doesn't change.

### Data is wrong or lost

1. **Stop further damage:** pause the Vercel project (or deploy a maintenance page) so nobody
   records anything on top.
2. **Prefer fixing forward:** a migration or a one-off statement that corrects the rows, reviewed
   first, if the damage is understood and limited. (Money records have database-enforced rules; a
   correction that breaks them is refused.)
3. **Otherwise restore**, from the Supabase dashboard (database backups). A restore replaces the
   whole database: everything recorded after the backup's time is lost, for every household. Then:
   - apply any migrations newer than the backup (`npx supabase db push`);
   - redo the account deletions in the register made since the backup's time;
   - check with `/api/health` and the checks in [deployment.md](deployment.md#6-deploy-and-check);
   - tell the households what was lost.
4. Resume the Vercel project.

A household deleted by its owner can't be brought back on its own: it would mean restoring a
backup into a separate project and copying its rows back by hand.

### Test the restore

Before launch, and then regularly: restore a backup (or your own dump) into the **staging**
project, run the checks in [deployment.md](deployment.md#6-deploy-and-check) against it, and note
how long it took. An untested backup can't be counted on. This hasn't been done yet: no hosted
project exists.
