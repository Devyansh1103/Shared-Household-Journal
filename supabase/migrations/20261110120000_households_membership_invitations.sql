-- Phase 6: household creation, membership changes, invitations and activity events.
--
-- Rules: D1, D3, D4, D5, D11, D13, D14 in docs/decisions.md; ADR-006, ADR-008, ADR-009.
-- Access model: docs/database.md. Additive only: this file adds one column, two
-- types, one table, functions, triggers, policies and grants. Nothing existing
-- is dropped or rewritten.
--
-- Every membership change goes through a SECURITY DEFINER function below. Each
-- one reads the caller from auth.uid() (never from an argument), checks the
-- caller's own active membership and role, and only then writes.
--
-- Custom error codes (SQLSTATE class HJ), mapped to messages in
-- src/lib/households/errors.ts:
--   HJ001  the invite is not valid (unknown, expired, revoked or used up)
--   HJ002  the owner must transfer ownership before leaving (D13)
--   HJ003  the target user is not an active member of the household
--   HJ004  the household still has other active members (D14)
--   HJ005  the action can't target yourself (use leave instead)
-- 42501 (insufficient_privilege) is used when the caller isn't signed in, isn't
-- an active member, or isn't the owner.

-- ---------------------------------------------------------------------------
-- households.creation_key: makes create_household idempotent, so a repeated
-- submission of the same form returns the first household instead of a second.
-- ---------------------------------------------------------------------------

alter table public.households add column creation_key uuid;

comment on column public.households.creation_key is
  'Client-supplied key for one creation attempt. Repeating it returns the same household.';

create unique index households_created_by_creation_key
  on public.households (created_by, creation_key)
  where creation_key is not null;

-- ---------------------------------------------------------------------------
-- activity_events: append-only household journal (requirements-notes §3).
-- Written from Phase 6 onwards; the feed UI is Phase 13. Summaries hold ids and
-- minimal context only, never emails or tokens.
-- ---------------------------------------------------------------------------

create type public.activity_event_type as enum (
  'household_created',
  'member_joined',
  'member_left',
  'member_removed',
  'ownership_transferred',
  'invitation_created',
  'invitation_revoked'
);

create type public.activity_entity_type as enum (
  'household',
  'household_member',
  'invitation'
);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- Null only when the change was made outside a user session (service role).
  actor_id uuid references public.profiles (id) on delete restrict,
  type public.activity_event_type not null,
  entity_type public.activity_entity_type not null,
  entity_id uuid not null,
  summary jsonb not null default '{}'::jsonb
    constraint activity_events_summary_is_object check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now()
);

comment on table public.activity_events is
  'Append-only household journal. Active members can read; only functions and triggers write.';

create index activity_events_household_id_created_at_idx
  on public.activity_events (household_id, created_at desc);
create index activity_events_actor_id_idx on public.activity_events (actor_id);

-- Append-only, for every role including service_role. The one exception is the
-- cascade from deleting the household itself (D14): by the time the cascade
-- reaches these rows, the household row is already gone.
create function private.protect_activity_events()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and not exists (select 1 from public.households where id = old.household_id)
  then
    return old;
  end if;
  raise exception 'activity_events is append-only' using errcode = '42501';
end;
$$;

create trigger activity_events_append_only
before update or delete on public.activity_events
for each row execute function private.protect_activity_events();

create function private.record_activity(
  target_household_id uuid,
  event_type public.activity_event_type,
  event_entity_type public.activity_entity_type,
  event_entity_id uuid,
  event_summary jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_events (household_id, actor_id, type, entity_type, entity_id, summary)
  values (
    target_household_id,
    (select auth.uid()),
    event_type,
    event_entity_type,
    event_entity_id,
    event_summary
  );
$$;

-- ---------------------------------------------------------------------------
-- Invite tokens (D5 / ADR-009)
-- The raw token is 32 random bytes as unpadded base64url (43 characters). The
-- app hashes it when creating the invite; this helper hashes it again on
-- redemption, so the database only ever stores SHA-256 of the raw bytes.
-- ---------------------------------------------------------------------------

create function private.invite_token_hash(raw_token text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when raw_token ~ '^[A-Za-z0-9_-]{43}$' then
      encode(sha256(decode(translate(raw_token, '-_', '+/') || '=', 'base64')), 'hex')
  end;
$$;

-- ---------------------------------------------------------------------------
-- Invitation activity: logged by trigger, because members create and revoke
-- invites directly under the Phase 4 RLS policies.
-- ---------------------------------------------------------------------------

create function private.log_invitation_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_activity(
      new.household_id, 'invitation_created', 'invitation', new.id,
      jsonb_build_object('expires_at', new.expires_at, 'max_uses', new.max_uses)
    );
  elsif old.revoked_at is null and new.revoked_at is not null then
    perform private.record_activity(
      new.household_id, 'invitation_revoked', 'invitation', new.id,
      jsonb_build_object('created_by', new.created_by)
    );
  end if;
  return null;
end;
$$;

create trigger invitations_log_activity
after insert or update of revoked_at on public.invitations
for each row execute function private.log_invitation_activity();

-- Invites created by someone who is no longer a member lose their authority
-- (D4: members create invites). Used by leave_household and remove_member.
create function private.revoke_invitations_created_by(
  target_household_id uuid,
  creator_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.invitations
  set revoked_at = now()
  where household_id = target_household_id
    and created_by = creator_id
    and revoked_at is null;
$$;

-- ---------------------------------------------------------------------------
-- create_household: the household and its owner membership in one transaction,
-- so a household can never exist without its owner (ADR-006).
-- ---------------------------------------------------------------------------

create function public.create_household(
  household_name text,
  currency text,
  time_zone text,
  request_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  new_household_id uuid;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if request_key is not null then
    select h.id into new_household_id
    from public.households h
    where h.created_by = caller and h.creation_key = request_key;
    if found then
      return new_household_id;
    end if;
  end if;

  begin
    insert into public.households (name, currency_code, timezone, created_by, creation_key)
    values (household_name, currency, time_zone, caller, request_key)
    returning id into new_household_id;
  exception when unique_violation then
    -- A concurrent request with the same key won the race.
    select h.id into strict new_household_id
    from public.households h
    where h.created_by = caller and h.creation_key = request_key;
    return new_household_id;
  end;

  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, caller, 'owner');

  perform private.record_activity(
    new_household_id, 'household_created', 'household', new_household_id,
    jsonb_build_object('name', household_name, 'currency_code', currency, 'timezone', time_zone)
  );

  return new_household_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_invite_preview: what a signed-in person holding a link may see before
-- joining. Unknown, expired, revoked and used-up links all answer 'invalid'
-- with nothing else, so a link reveals nothing once it stops working.
-- ---------------------------------------------------------------------------

create function public.get_invite_preview(token text)
returns table (status text, household_id uuid, household_name text, inviter_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  invite record;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select i.household_id as hid, i.expires_at, i.max_uses, i.use_count, i.revoked_at,
         h.name as hname, p.display_name as pname
  into invite
  from public.invitations i
  join public.households h on h.id = i.household_id
  join public.profiles p on p.id = i.created_by
  where i.token_hash = private.invite_token_hash(token);

  if not found then
    return query select 'invalid'::text, null::uuid, null::text, null::text;
    return;
  end if;

  if exists (
    select 1 from public.household_members m
    where m.household_id = invite.hid and m.user_id = caller and m.left_at is null
  ) then
    return query select 'member'::text, invite.hid, invite.hname, null::text;
    return;
  end if;

  if invite.revoked_at is not null
    or invite.expires_at <= now()
    or invite.use_count >= invite.max_uses
  then
    return query select 'invalid'::text, null::uuid, null::text, null::text;
    return;
  end if;

  return query select 'valid'::text, null::uuid, invite.hname, invite.pname;
end;
$$;

-- ---------------------------------------------------------------------------
-- accept_invite: joins the caller as a plain member. The invite row is locked,
-- so expiry, the use limit and revocation are checked and the use is counted
-- in one transaction (D5): two people can't both take the last use.
-- ---------------------------------------------------------------------------

create function public.accept_invite(token text)
returns table (joined_household_id uuid, already_member boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  invite public.invitations%rowtype;
  membership_id uuid;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select * into invite
  from public.invitations i
  where i.token_hash = private.invite_token_hash(token)
  for update;

  if not found then
    raise exception 'Invite is not valid' using errcode = 'HJ001';
  end if;

  -- Already in: no use is consumed.
  if exists (
    select 1 from public.household_members m
    where m.household_id = invite.household_id and m.user_id = caller and m.left_at is null
  ) then
    return query select invite.household_id, true;
    return;
  end if;

  if invite.revoked_at is not null
    or invite.expires_at <= now()
    or invite.use_count >= invite.max_uses
  then
    raise exception 'Invite is not valid' using errcode = 'HJ001';
  end if;

  -- Always 'member': an invite can never grant ownership (D3).
  insert into public.household_members (household_id, user_id, role)
  values (invite.household_id, caller, 'member')
  returning id into membership_id;

  update public.invitations set use_count = use_count + 1 where id = invite.id;

  perform private.record_activity(
    invite.household_id, 'member_joined', 'household_member', membership_id,
    jsonb_build_object('user_id', caller, 'invitation_id', invite.id)
  );

  return query select invite.household_id, false;
end;
$$;

-- ---------------------------------------------------------------------------
-- leave_household (D13). The owner can't leave: they transfer ownership first,
-- or delete the household when they're the only member.
--
-- D13 also requires a zero balance. Balances don't exist until expenses do
-- (Phase 8/9), so every balance is zero today. That check MUST be added here
-- when the expenses table arrives.
-- ---------------------------------------------------------------------------

create function public.leave_household(target_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  membership public.household_members%rowtype;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select * into membership
  from public.household_members m
  where m.household_id = target_household_id and m.user_id = caller and m.left_at is null
  for update;

  if not found then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  if membership.role = 'owner' then
    raise exception 'The owner must transfer ownership before leaving' using errcode = 'HJ002';
  end if;

  update public.household_members set left_at = now() where id = membership.id;
  perform private.revoke_invitations_created_by(target_household_id, caller);

  perform private.record_activity(
    target_household_id, 'member_left', 'household_member', membership.id,
    jsonb_build_object('user_id', caller)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner-only membership changes (D4, ADR-008)
-- ---------------------------------------------------------------------------

-- Locks and returns the caller's owner membership, or raises 42501.
create function private.require_household_owner(target_household_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  owner_membership_id uuid;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select m.id into owner_membership_id
  from public.household_members m
  where m.household_id = target_household_id
    and m.user_id = caller
    and m.left_at is null
    and m.role = 'owner'
  for update;

  if not found then
    raise exception 'Only the household owner can do this' using errcode = '42501';
  end if;

  return owner_membership_id;
end;
$$;

create function public.remove_member(target_household_id uuid, member_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_membership_id uuid;
begin
  perform private.require_household_owner(target_household_id);

  if member_user_id = (select auth.uid()) then
    raise exception 'Use leave_household for yourself' using errcode = 'HJ005';
  end if;

  select m.id into target_membership_id
  from public.household_members m
  where m.household_id = target_household_id and m.user_id = member_user_id and m.left_at is null
  for update;

  if not found then
    raise exception 'That person is not an active member' using errcode = 'HJ003';
  end if;

  update public.household_members set left_at = now() where id = target_membership_id;
  perform private.revoke_invitations_created_by(target_household_id, member_user_id);

  perform private.record_activity(
    target_household_id, 'member_removed', 'household_member', target_membership_id,
    jsonb_build_object('user_id', member_user_id)
  );
end;
$$;

create function public.transfer_ownership(target_household_id uuid, new_owner_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_membership_id uuid;
  target_membership_id uuid;
begin
  owner_membership_id := private.require_household_owner(target_household_id);

  if new_owner_user_id = (select auth.uid()) then
    raise exception 'You are already the owner' using errcode = 'HJ005';
  end if;

  select m.id into target_membership_id
  from public.household_members m
  where m.household_id = target_household_id and m.user_id = new_owner_user_id and m.left_at is null
  for update;

  if not found then
    raise exception 'That person is not an active member' using errcode = 'HJ003';
  end if;

  -- Demote first: the one-active-owner index is checked per statement; the
  -- at-least-one-owner trigger is deferred to commit.
  update public.household_members set role = 'member' where id = owner_membership_id;
  update public.household_members set role = 'owner' where id = target_membership_id;

  perform private.record_activity(
    target_household_id, 'ownership_transferred', 'household_member', target_membership_id,
    jsonb_build_object('from_user_id', (select auth.uid()), 'to_user_id', new_owner_user_id)
  );
end;
$$;

-- D14: permanent, and only once the owner is the only active member. Memberships,
-- invitations and activity events cascade.
create function public.delete_household(target_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_household_owner(target_household_id);

  -- Lock the household so nobody can join between the check and the delete.
  perform 1 from public.households h where h.id = target_household_id for update;

  if exists (
    select 1 from public.household_members m
    where m.household_id = target_household_id
      and m.left_at is null
      and m.user_id <> (select auth.uid())
  ) then
    raise exception 'The household still has other members' using errcode = 'HJ004';
  end if;

  delete from public.households where id = target_household_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges. Supabase grants EXECUTE on new public functions to anon
-- by default; these are for signed-in users only. Private helpers stay
-- unreachable (the private schema isn't exposed, and execute is revoked).
-- ---------------------------------------------------------------------------

revoke all on function private.protect_activity_events() from public;
revoke all on function private.record_activity(uuid, public.activity_event_type, public.activity_entity_type, uuid, jsonb) from public;
revoke all on function private.invite_token_hash(text) from public;
revoke all on function private.log_invitation_activity() from public;
revoke all on function private.revoke_invitations_created_by(uuid, uuid) from public;
revoke all on function private.require_household_owner(uuid) from public;

revoke all on function public.create_household(text, text, text, uuid) from public, anon;
revoke all on function public.get_invite_preview(text) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.leave_household(uuid) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
revoke all on function public.transfer_ownership(uuid, uuid) from public, anon;
revoke all on function public.delete_household(uuid) from public, anon;

grant execute on function public.create_household(text, text, text, uuid) to authenticated;
grant execute on function public.get_invite_preview(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.leave_household(uuid) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
grant execute on function public.delete_household(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- activity_events access: active members read; nobody writes directly.
-- ---------------------------------------------------------------------------

alter table public.activity_events enable row level security;

create policy "Members read their household's activity"
on public.activity_events for select to authenticated
using (private.is_household_member(household_id));

revoke all on table public.activity_events from anon, authenticated;
grant all on table public.activity_events to service_role;
grant select on table public.activity_events to authenticated;
