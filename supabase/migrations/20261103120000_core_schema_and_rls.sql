-- Phase 4: core tables, RLS helper functions and policies.
--
-- Domain model and access rules: docs/requirements-notes.md §3–§4, docs/database.md.
-- Households and memberships are created only through Postgres functions added in
-- Phase 6 (ADR-006). Until then, signed-in users can read what their membership
-- allows and make the narrow updates granted at the end of this file.

-- ---------------------------------------------------------------------------
-- Private schema
-- Holds helper and trigger functions. It is not exposed through the Data API,
-- so none of these functions can be called as an RPC.
-- ---------------------------------------------------------------------------

create schema private;

revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- D3 / ADR-008. An enum so a future role can be added with `alter type ... add value`.
create type public.household_role as enum ('owner', 'member');

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user. Email is never stored here (it stays in auth.users).
-- ---------------------------------------------------------------------------

create table public.profiles (
  -- No cascade: deleting an account must anonymise the profile and keep the
  -- financial records other members rely on (D14, Phase 18). Until that flow
  -- exists, an auth user with a profile cannot be deleted.
  id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null
    constraint profiles_display_name_length
    check (char_length(display_name) between 1 and 80 and display_name = btrim(display_name)),
  avatar_url text
    constraint profiles_avatar_url_length check (char_length(avatar_url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user. Readable by the user and by people who share a household with them.';

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

-- Creates the profile when an auth user is created. The display name comes from
-- sign-up metadata (Phase 5); the fallback never derives anything from the email.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(left(new.raw_user_meta_data ->> 'display_name', 80)), ''),
      'New member'
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- households
-- ---------------------------------------------------------------------------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null
    constraint households_name_length
    check (char_length(name) between 1 and 80 and name = btrim(name)),
  -- D1 / ADR-003: one ISO 4217 currency per household, no conversion. The lock
  -- once an expense exists is added with the expenses table (Phase 8).
  currency_code text not null default 'INR'
    constraint households_currency_code_format check (currency_code ~ '^[A-Z]{3}$'),
  -- D11: IANA name, validated by households_validate_timezone.
  timezone text not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.households is
  'The authorization boundary. Active members can read; the owner can update name, currency and timezone.';

create index households_created_by_idx on public.households (created_by);

create trigger households_set_updated_at
before update on public.households
for each row execute function private.set_updated_at();

create function private.validate_household_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown IANA timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger households_validate_timezone
before insert or update of timezone on public.households
for each row execute function private.validate_household_timezone();

-- ---------------------------------------------------------------------------
-- household_members
-- Leaving or removal sets left_at; the row is kept so past records can show the
-- name with a "(left)" label (D13). Rejoining adds a new row.
-- ---------------------------------------------------------------------------

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  role public.household_role not null default 'member',
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint household_members_left_after_joined check (left_at is null or left_at >= joined_at),
  -- D13: the owner transfers ownership before leaving.
  constraint household_members_owner_is_active check (role <> 'owner' or left_at is null)
);

comment on table public.household_members is
  'Membership history. Active members can read their household''s rows; changes go through functions only.';

-- One active membership per user per household.
create unique index household_members_one_active_membership
  on public.household_members (household_id, user_id)
  where left_at is null;

-- At most one active owner per household. "At least one" is the constraint trigger below.
create unique index household_members_one_active_owner
  on public.household_members (household_id)
  where role = 'owner' and left_at is null;

create index household_members_household_id_user_id_idx
  on public.household_members (household_id, user_id);

create index household_members_user_id_idx on public.household_members (user_id);

create trigger household_members_set_updated_at
before update on public.household_members
for each row execute function private.set_updated_at();

-- Exactly one active owner (ADR-008). Deferred to commit so a function can
-- transfer ownership (demote, then promote) inside one transaction.
create function private.check_household_has_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_household_ids uuid[];
  affected_household_id uuid;
begin
  if tg_op = 'INSERT' then
    affected_household_ids := array[new.household_id];
  elsif tg_op = 'DELETE' then
    affected_household_ids := array[old.household_id];
  else
    affected_household_ids := array[old.household_id, new.household_id];
  end if;

  foreach affected_household_id in array affected_household_ids loop
    if exists (select 1 from public.households where id = affected_household_id)
      and exists (
        select 1 from public.household_members
        where household_id = affected_household_id and left_at is null
      )
      and not exists (
        select 1 from public.household_members
        where household_id = affected_household_id and role = 'owner' and left_at is null
      )
    then
      raise exception 'Household % must have exactly one active owner', affected_household_id
        using errcode = '23514';
    end if;
  end loop;

  return null;
end;
$$;

create constraint trigger household_members_require_owner
after insert or update or delete on public.household_members
deferrable initially deferred
for each row execute function private.check_household_has_owner();

-- ---------------------------------------------------------------------------
-- invitations (D5 / ADR-009)
-- Only the SHA-256 hash of the 32-byte token is stored, as lowercase hex.
-- Redemption (expiry, use limit, revocation in one transaction) is accept_invite,
-- added in Phase 6.
-- ---------------------------------------------------------------------------

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  token_hash text not null
    constraint invitations_token_hash_key unique
    constraint invitations_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  expires_at timestamptz not null default (now() + interval '7 days'),
  max_uses integer not null default 10 constraint invitations_max_uses_positive check (max_uses > 0),
  use_count integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invitations_use_count_within_limit check (use_count between 0 and max_uses),
  constraint invitations_expires_after_created check (expires_at > created_at)
);

comment on table public.invitations is
  'Invite links. Members can read and create; the creator or the owner can revoke.';

create index invitations_household_id_idx on public.invitations (household_id);
create index invitations_created_by_idx on public.invitations (created_by);

-- ---------------------------------------------------------------------------
-- RLS helper functions (requirements-notes §4.2)
-- SECURITY DEFINER so policies can read household_members without recursing
-- into its own policy. Each one looks only at the caller's own membership.
-- ---------------------------------------------------------------------------

create function private.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = target_household_id
      and user_id = (select auth.uid())
      and left_at is null
  );
$$;

create function private.household_role(target_household_id uuid)
returns public.household_role
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.household_members
  where household_id = target_household_id
    and user_id = (select auth.uid())
    and left_at is null;
$$;

-- True when the target user has (or had) a membership in a household where the
-- caller is an active member. Former members stay visible so their names can be
-- shown on past records (D13).
create function private.shares_household_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members mine
    join public.household_members theirs on theirs.household_id = mine.household_id
    where mine.user_id = (select auth.uid())
      and mine.left_at is null
      and theirs.user_id = target_user_id
  );
$$;

revoke all on function private.set_updated_at() from public;
revoke all on function private.handle_new_user() from public;
revoke all on function private.validate_household_timezone() from public;
revoke all on function private.check_household_has_owner() from public;
revoke all on function private.is_household_member(uuid) from public;
revoke all on function private.household_role(uuid) from public;
revoke all on function private.shares_household_with(uuid) from public;

grant execute on function private.is_household_member(uuid) to authenticated, service_role;
grant execute on function private.household_role(uuid) to authenticated, service_role;
grant execute on function private.shares_household_with(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row level security: enabled on every table, deny by default. Policies apply
-- to the authenticated role only; anon has no privileges on these tables.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.invitations enable row level security;

-- profiles
create policy "Users read their own profile and people they share a household with"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or private.shares_household_with(id));

create policy "Users update their own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- households
create policy "Members read their households"
on public.households for select to authenticated
using (private.is_household_member(id));

create policy "Owners update their household"
on public.households for update to authenticated
using (private.household_role(id) = 'owner')
with check (private.household_role(id) = 'owner');

-- household_members: read only. Inserts, role changes and leaving go through functions.
create policy "Members read their household's memberships"
on public.household_members for select to authenticated
using (private.is_household_member(household_id));

-- invitations
create policy "Members read their household's invitations"
on public.invitations for select to authenticated
using (private.is_household_member(household_id));

create policy "Members create invitations for their household"
on public.invitations for insert to authenticated
with check (
  private.is_household_member(household_id)
  and created_by = (select auth.uid())
  and use_count = 0
  and revoked_at is null
);

-- D4: any member can revoke their own invite; only the owner can revoke others'.
create policy "Creators and owners revoke invitations"
on public.invitations for update to authenticated
using (
  revoked_at is null
  and private.is_household_member(household_id)
  and (created_by = (select auth.uid()) or private.household_role(household_id) = 'owner')
)
with check (
  revoked_at is not null
  and (created_by = (select auth.uid()) or private.household_role(household_id) = 'owner')
);

-- ---------------------------------------------------------------------------
-- Table privileges: a second layer under RLS. Column lists stop a policy that
-- allows a row from also allowing changes to ids, owners or counters.
-- ---------------------------------------------------------------------------

revoke all on table public.profiles, public.households, public.household_members, public.invitations
  from anon, authenticated;

grant all on table public.profiles, public.households, public.household_members, public.invitations
  to service_role;

grant select on table public.profiles, public.households, public.household_members, public.invitations
  to authenticated;

grant update (display_name, avatar_url) on table public.profiles to authenticated;
grant update (name, currency_code, timezone) on table public.households to authenticated;
grant insert (household_id, token_hash, expires_at, max_uses) on table public.invitations to authenticated;
grant update (revoked_at) on table public.invitations to authenticated;
