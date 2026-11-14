-- Roadmap Phase 18: operations.
--
-- 1. public.health_check(): the app's /api/health endpoint asks the database
--    whether it answers. It reads no table and returns only true, so it's
--    safe for anyone to call, signed in or not.
--
-- 2. private.anonymise_account(): D14 (confirmed 2026-11-02), done as an
--    operator procedure (decided by the owner 2026-11-14, roadmap Phase 18):
--    deleting an account anonymises the profile to "Former member" and keeps
--    the records other members rely on. The profile row stays (expenses,
--    splits, payments and the journal point at it, ON DELETE RESTRICT); its
--    name goes, and so do the person's own notifications and settings. The
--    sign-in itself is then removed with Supabase Auth's soft delete (see
--    docs/operations.md), which keeps the auth row the profile references
--    and clears the email, password, identities and sessions.
--    Only the service role (and the database owner) may run it: it's never
--    exposed to signed-in users or through the Data API.
--
-- Additive: two functions and their grants. No tables or data change.
--
-- New error codes (operator-facing only):
--   HJ033  no such account
--   HJ034  the account is still an active member of a household

create function public.health_check()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select true;
$$;

comment on function public.health_check() is
  'Liveness of the database for GET /api/health. Reads nothing; returns true.';

revoke all on function public.health_check() from public;
grant execute on function public.health_check() to anon, authenticated;

create function private.anonymise_account(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = target_user_id) then
    raise exception 'No such account' using errcode = 'HJ033';
  end if;
  -- They must have left (or been removed from) every household first, which
  -- needs a zero balance there (D13), and an owner must hand over or delete
  -- the household before leaving.
  if exists (
    select 1
    from public.household_members m
    where m.user_id = target_user_id
      and m.left_at is null
  ) then
    raise exception 'The account is still an active member of a household; it must leave every household first'
      using errcode = 'HJ034';
  end if;

  update public.profiles p
  set display_name = 'Former member', avatar_url = null
  where p.id = target_user_id;

  -- Their own inbox and switches: personal, and readable by nobody else.
  delete from public.notifications n where n.user_id = target_user_id;
  delete from public.notification_preferences s where s.user_id = target_user_id;
end;
$$;

comment on function private.anonymise_account(uuid) is
  'D14: anonymises a former member''s profile and removes their notifications. Operators only (service role); see docs/operations.md.';

revoke all on function private.anonymise_account(uuid) from public, anon, authenticated;
grant execute on function private.anonymise_account(uuid) to service_role;
