# Operations

Running the app once it's deployed (roadmap Phase 18): the health check, logs and monitoring,
deleting an account (D14), and what to do when something goes wrong. Deployment itself is in
[deployment.md](deployment.md); backups in [backup-recovery.md](backup-recovery.md).

## Health check

`GET /api/health` ([src/app/api/health/route.ts](../src/app/api/health/route.ts)):

| Answer                                           | Status | Meaning                                                            |
| ------------------------------------------------ | ------ | ------------------------------------------------------------------ |
| `{"status":"ok","database":"ok"}`                | 200    | The app is serving and the database answers.                       |
| `{"status":"degraded","database":"unavailable"}` | 503    | The app is up, but the database didn't answer or isn't configured. |
| No answer                                        | —      | The app is down (or the host is).                                  |

It's never cached (`Cache-Control: no-store`), needs no session, and says nothing about versions,
configuration, timings or people. It calls `public.health_check()`, which reads no table; it's the
only database function a signed-out visitor may run.

## Logs

- **Server errors** are written by [src/instrumentation.ts](../src/instrumentation.ts) as one JSON
  line on standard error, which the host collects (on Vercel: the project's Logs):

  ```json
  {
    "level": "error",
    "event": "request_error",
    "time": "2026-11-14T08:00:00.000Z",
    "method": "GET",
    "routePath": "/households/[householdId]",
    "routeType": "render",
    "renderSource": "react-server-components",
    "errorName": "Error",
    "digest": "1234567890"
  }
  ```

  No error message, stack, path values, query string, header, cookie or body. The `digest` is the
  "Reference" the person sees on the error page ([src/app/global-error.tsx](../src/app/global-error.tsx)),
  so a report can be matched to its line. Next.js also prints the error in its own format; every
  error the app throws has a fixed, generic message (for example "Could not load the balances."),
  and raw database errors are never rethrown.

- **Configuration problems** stop the server at start with a message naming the variable (never
  its value). See [environment.md](environment.md).
- **Database, API and Auth logs:** the Supabase dashboard (Logs). Auth keeps its own audit log of
  sign-ups, sign-ins and deletions.

## Monitoring

None is configured in the repository; set these up with the deployment:

1. An uptime check on `https://<your domain>/api/health` every 1–5 minutes, alerting after two
   failures in a row. Any external uptime service works; it needs no credentials.
2. Alerts on server errors: watch the host's logs for `"event":"request_error"`.
3. Supabase's own usage and health views (database size, connections, Auth emails sent), and its
   email alerts for the project.

## Deleting an account (D14)

D14: deleting an account anonymises the profile to "Former member" and keeps the financial records
other members rely on. The owner decided (2026-11-14) that this is done by an operator on request,
not by a button in the app, so the app never holds a key that can delete accounts.

**Before you start:** confirm the request comes from the account's owner, through the address they
signed up with. Note their user id (Supabase dashboard → Authentication → Users).

1. **They leave every household.** In the app, with the usual rules (D13): their balance must be
   zero, and an owner must hand over ownership or delete the household first. An owner can also
   remove them (O8). Nothing in this procedure bypasses those rules.
2. **Remove the sign-in, with a soft delete.** From your own computer, with the project's secret
   (service-role) key set as an environment variable in that terminal only, never saved to a file
   or pasted anywhere. Check the user id twice: this can't be undone.

   ```ts
   // delete-sign-in.mjs. With SUPABASE_URL and SUPABASE_SECRET_KEY set in this
   // terminal: node delete-sign-in.mjs <user id>
   import { createClient } from "@supabase/supabase-js";
   const admin = createClient(
     process.env.SUPABASE_URL,
     process.env.SUPABASE_SECRET_KEY,
     {
       auth: { persistSession: false, autoRefreshToken: false },
     },
   );
   const { error } = await admin.auth.admin.deleteUser(process.argv[2], true); // true: soft delete
   if (error) throw error;
   ```

   The soft delete ends every session and refresh token, removes the password, replaces the email
   and phone with random values, and clears their sign-up details; the person can never sign in
   again. It keeps the row their profile points at. **Don't use the dashboard's "Delete user":** a
   hard delete is refused while the profile exists (records point at it), and it must exist.

3. **Wait at least one hour** (the access-token lifetime, `jwt_expiry`; check the project's value).
   A token issued before step 2 keeps working at the Data API until it expires (see
   [security.md](security.md#low), S9).
4. **Anonymise the profile.** In the dashboard's SQL editor:

   ```sql
   select private.anonymise_account('<user id>');
   ```

   It sets the name to "Former member", removes the avatar, and deletes their own notifications and
   notification settings. It refuses with `HJ034` if they're an active member of any household again
   (go back to step 1), and with `HJ033` for an id with no profile. Running it twice is harmless.

5. **Check:** the person can't sign in; other members see "Former member" on their past expenses,
   payments and journal entries, and every balance is unchanged.
6. **Optional, your decision: Auth's audit log.** Supabase Auth keeps the email address in its audit
   log entries for that account (sign-up, sign-ins, the deletion). The soft delete doesn't remove
   them. To remove them (this deletes data and can't be undone):

   ```sql
   -- Sign-ins name the person as the actor; the sign-up and the deletion name
   -- them in "traits" (the actor there may be an administrator).
   delete from auth.audit_log_entries
   where payload ->> 'actor_id' = '<user id>'
      or payload -> 'traits' ->> 'user_id' = '<user id>';
   ```

   Checked against the local stack: for a deleted test account, this matches exactly the entries
   that contain its email address.

What stays: their profile row (as "Former member"), their memberships (with the dates they left),
and every expense, split, payment, bill, item, chore, budget and journal entry they took part in,
so the household's books still add up (D14). Names typed into descriptions or notes by anyone are
not changed. The procedure is tested end to end in
[supabase/tests/operations.test.ts](../supabase/tests/operations.test.ts).

## When something goes wrong

| Symptom                           | First checks                                                                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/health` says `degraded`     | Supabase project status and dashboard; the two environment variables in the host; whether the project is paused.                                                                              |
| The server won't start            | The log line "The app's configuration isn't safe to run" names the variable to fix ([environment.md](environment.md)).                                                                        |
| People see "Something went wrong" | Find the log line with their "Reference" (the `digest`).                                                                                                                                      |
| Nobody receives emails            | The project's SMTP settings and Auth logs; the built-in sender isn't for production ([deployment.md](deployment.md#email)).                                                                   |
| Email links fail                  | The project's Site URL and redirect URLs must be the production origin; the templates must link to `/auth/confirm?token_hash=…` ([deployment.md](deployment.md#3-configure-auth)).            |
| A bad deployment                  | Promote the previous deployment in the host ([deployment.md](deployment.md#rolling-back)); the database is unaffected by an app rollback.                                                     |
| A bad migration                   | Don't edit or delete applied migrations; write a new one that corrects it ([migrations.md](migrations.md)). Restoring a backup is the last resort ([backup-recovery.md](backup-recovery.md)). |
| Suspected leak of a secret key    | Rotate it in Supabase (API keys) at once; the app doesn't use it, so nothing in the app needs changing.                                                                                       |
