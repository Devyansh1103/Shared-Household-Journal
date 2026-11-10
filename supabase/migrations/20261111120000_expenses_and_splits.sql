-- Phase 8: expenses and their splits.
--
-- Rules: D1 (currency lock), D2 / ADR-003 (bigint minor units), ADR-004 (split
-- rounding; the engine is src/domain/money/split.ts), D6 (who can edit or
-- delete), D7 (soft delete, owner restores), D13 and O8 (zero balance to leave
-- or be removed), D17 (categories), ADR-006 as amended 2026-11-11 (writes go
-- through SECURITY DEFINER functions; signed-in users have no direct write
-- privileges on these tables).
--
-- Additive: new types, enum values, tables, functions, triggers, policies and
-- grants. leave_household and remove_member are replaced with versions that add
-- the zero-balance check; their other behaviour is unchanged. No data changes.
--
-- New error codes (mapped in src/lib/households/errors.ts and
-- src/lib/expenses/errors.ts):
--   HJ006  the member's balance isn't zero (D13 / O8)
--   HJ007  the payer or a participant isn't an active member
--   HJ008  the split is invalid (shares don't add up, wrong shape, duplicates)
--   HJ009  no such expense (or not visible to the caller)
--   HJ010  the expense changed since it was loaded
--   HJ011  the expense is deleted (edit/delete) or not deleted (restore)
--   HJ012  the currency is locked because the household has expenses (D1)

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- D17: a fixed list. Labels live in src/lib/expenses/categories.ts.
create type public.expense_category as enum (
  'rent',
  'utilities',
  'groceries',
  'household_supplies',
  'internet',
  'dining',
  'transport',
  'other'
);

create type public.split_method as enum ('equal', 'percentage', 'custom');

alter type public.activity_event_type add value 'expense_created';
alter type public.activity_event_type add value 'expense_updated';
alter type public.activity_event_type add value 'expense_deleted';
alter type public.activity_event_type add value 'expense_restored';
alter type public.activity_entity_type add value 'expense';

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  description text not null
    constraint expenses_description_length
    check (char_length(description) between 1 and 120 and description = btrim(description)),
  -- Integer minor units in the household's currency (D1, D2). The upper bound
  -- keeps amounts and sums far inside JavaScript's safe-integer range.
  amount_minor bigint not null
    constraint expenses_amount_range check (amount_minor between 1 and 999999999999),
  category public.expense_category not null,
  -- A calendar date, not an instant (D11).
  expense_date date not null,
  paid_by uuid not null references public.profiles (id) on delete restrict,
  split_method public.split_method not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  -- Makes create_expense idempotent for a repeated form submission.
  creation_key uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- D7: soft delete. Deleted expenses stay visible but stop counting.
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete restrict,
  constraint expenses_deleted_together check ((deleted_at is null) = (deleted_by is null)),
  -- Target of the composite key from expense_splits.
  constraint expenses_id_household_id_key unique (id, household_id)
);

comment on table public.expenses is
  'Shared costs. Active members read; writes go through create/update/delete/restore_expense only.';

create unique index expenses_created_by_creation_key
  on public.expenses (created_by, creation_key)
  where creation_key is not null;
create index expenses_household_id_date_idx
  on public.expenses (household_id, expense_date desc, created_at desc)
  where deleted_at is null;
create index expenses_household_id_deleted_at_idx
  on public.expenses (household_id, deleted_at desc)
  where deleted_at is not null;
create index expenses_paid_by_idx on public.expenses (paid_by);
create index expenses_created_by_idx on public.expenses (created_by);
create index expenses_deleted_by_idx on public.expenses (deleted_by);

create trigger expenses_set_updated_at
before update on public.expenses
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- expense_splits: one row per participant. household_id is carried with a
-- composite key, so a split can never point at another household's expense.
-- ---------------------------------------------------------------------------

create table public.expense_splits (
  expense_id uuid not null,
  household_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete restrict,
  share_minor bigint not null constraint expense_splits_share_non_negative check (share_minor >= 0),
  -- Only for percentage splits (ADR-004): basis points, 10000 = 100%.
  percentage_bp integer
    constraint expense_splits_percentage_range check (percentage_bp between 0 and 10000),
  primary key (expense_id, user_id),
  constraint expense_splits_expense_fkey
    foreign key (expense_id, household_id)
    references public.expenses (id, household_id) on delete cascade
);

comment on table public.expense_splits is
  'Each participant''s share of an expense. Shares always add up to the expense amount.';

create index expense_splits_household_id_user_id_idx
  on public.expense_splits (household_id, user_id);
create index expense_splits_user_id_idx on public.expense_splits (user_id);

-- ---------------------------------------------------------------------------
-- Money invariants (ADR-004), checked by the write functions straight away and
-- again by a deferred constraint trigger at commit, whatever the write path.
-- ---------------------------------------------------------------------------

create function private.assert_expense_valid(target_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses%rowtype;
  split_count integer;
  share_total numeric;
  share_min bigint;
  share_max bigint;
  bp_total bigint;
  bp_missing integer;
  bp_present integer;
  off_target integer;
begin
  select * into e from public.expenses where id = target_expense_id;
  if not found then
    return; -- deleted together with its household
  end if;

  select count(*), sum(share_minor), min(share_minor), max(share_minor),
         sum(percentage_bp), count(*) filter (where percentage_bp is null),
         count(*) filter (where percentage_bp is not null)
  into split_count, share_total, share_min, share_max, bp_total, bp_missing, bp_present
  from public.expense_splits
  where expense_id = target_expense_id;

  if split_count = 0 then
    raise exception 'Expense % has no participants', target_expense_id using errcode = 'HJ008';
  end if;
  if share_total <> e.amount_minor then
    raise exception 'Shares of expense % add up to %, not %', target_expense_id, share_total, e.amount_minor
      using errcode = 'HJ008';
  end if;

  if e.split_method = 'percentage' then
    if bp_missing > 0 or bp_total <> 10000 then
      raise exception 'Percentages of expense % must total 100%%', target_expense_id using errcode = 'HJ008';
    end if;
    -- Each share is its exact percentage, floored, plus at most one leftover unit.
    select count(*) into off_target
    from public.expense_splits
    where expense_id = target_expense_id
      and share_minor not between (e.amount_minor * percentage_bp) / 10000
                              and (e.amount_minor * percentage_bp) / 10000 + 1;
    if off_target > 0 then
      raise exception 'Shares of expense % don''t match its percentages', target_expense_id
        using errcode = 'HJ008';
    end if;
  else
    if bp_present > 0 then
      raise exception 'Only percentage splits have percentages' using errcode = 'HJ008';
    end if;
    if e.split_method = 'equal' and share_max - share_min > 1 then
      raise exception 'Equal shares of expense % differ by more than one unit', target_expense_id
        using errcode = 'HJ008';
    end if;
  end if;
end;
$$;

create function private.check_expense_invariants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'expenses' then
    perform private.assert_expense_valid(new.id);
  elsif tg_op = 'DELETE' then
    perform private.assert_expense_valid(old.expense_id);
  else
    perform private.assert_expense_valid(new.expense_id);
    if tg_op = 'UPDATE' and old.expense_id <> new.expense_id then
      perform private.assert_expense_valid(old.expense_id);
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger expenses_check_invariants
after insert or update on public.expenses
deferrable initially deferred
for each row execute function private.check_expense_invariants();

create constraint trigger expense_splits_check_invariants
after insert or update or delete on public.expense_splits
deferrable initially deferred
for each row execute function private.check_expense_invariants();

-- ---------------------------------------------------------------------------
-- D1: the currency is locked once the household has an expense (deleted ones
-- included: they still exist and can be restored).
-- ---------------------------------------------------------------------------

create function private.lock_household_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.currency_code is distinct from old.currency_code
    and exists (select 1 from public.expenses where household_id = new.id)
  then
    raise exception 'The currency is locked once the household has expenses' using errcode = 'HJ012';
  end if;
  return new;
end;
$$;

create trigger households_lock_currency
before update of currency_code on public.households
for each row execute function private.lock_household_currency();

-- ---------------------------------------------------------------------------
-- Helpers for the expense functions
-- ---------------------------------------------------------------------------

create function private.is_active_member(target_household_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members
    where household_id = target_household_id
      and user_id = target_user_id
      and left_at is null
  );
$$;

-- What paid minus what was owed, over non-deleted expenses. Settlements are
-- added to this when they exist (Phase 10). Used only to enforce D13 and O8;
-- balances shown to people are Phase 9.
create function private.member_net_minor(target_household_id uuid, target_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (
    coalesce((
      select sum(e.amount_minor)
      from public.expenses e
      where e.household_id = target_household_id
        and e.paid_by = target_user_id
        and e.deleted_at is null
    ), 0)
    - coalesce((
      select sum(s.share_minor)
      from public.expense_splits s
      join public.expenses e on e.id = s.expense_id
      where s.household_id = target_household_id
        and s.user_id = target_user_id
        and e.deleted_at is null
    ), 0)
  )::bigint;
$$;

-- The expense and its splits as JSON, for the journal's old and new values (D6).
create function private.expense_snapshot(target_expense_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'description', e.description,
    'amount_minor', e.amount_minor,
    'category', e.category,
    'expense_date', e.expense_date,
    'paid_by', e.paid_by,
    'split_method', e.split_method,
    'splits', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', s.user_id,
          'share_minor', s.share_minor,
          'percentage_bp', s.percentage_bp
        )
        order by s.user_id
      )
      from public.expense_splits s
      where s.expense_id = e.id
    ), '[]'::jsonb)
  )
  from public.expenses e
  where e.id = target_expense_id;
$$;

-- Inserts the splits from [{user_id, share_minor, percentage_bp}], then checks
-- that every participant is an active member and that the money adds up.
create function private.write_expense_splits(
  target_expense_id uuid,
  target_household_id uuid,
  shares jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if shares is null or jsonb_typeof(shares) <> 'array' or jsonb_array_length(shares) = 0 then
    raise exception 'Choose at least one participant' using errcode = 'HJ008';
  end if;

  begin
    insert into public.expense_splits (expense_id, household_id, user_id, share_minor, percentage_bp)
    select
      target_expense_id,
      target_household_id,
      (item ->> 'user_id')::uuid,
      (item ->> 'share_minor')::bigint,
      (item ->> 'percentage_bp')::integer
    from jsonb_array_elements(shares) as item;
  exception
    when unique_violation or invalid_text_representation or numeric_value_out_of_range
      or not_null_violation or check_violation or null_value_not_allowed then
      raise exception 'The split is not valid' using errcode = 'HJ008';
  end;

  if exists (
    select 1 from public.expense_splits s
    where s.expense_id = target_expense_id
      and not private.is_active_member(target_household_id, s.user_id)
  ) then
    raise exception 'Every participant must be an active member' using errcode = 'HJ007';
  end if;

  perform private.assert_expense_valid(target_expense_id);
end;
$$;

-- Locks a visible expense and checks D6 for the caller. Expenses in households
-- the caller isn't in are reported as not found.
create function private.lock_expense_for_change(target_expense_id uuid)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  e public.expenses%rowtype;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select * into e from public.expenses where id = target_expense_id for update;
  if not found or not private.is_active_member(e.household_id, caller) then
    raise exception 'No such expense' using errcode = 'HJ009';
  end if;

  return e;
end;
$$;

create function private.can_change_expense(e public.expenses)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- D6: the creator, the payer, or the household owner.
  select e.created_by = (select auth.uid())
    or e.paid_by = (select auth.uid())
    or private.household_role(e.household_id) = 'owner';
$$;

-- ---------------------------------------------------------------------------
-- create_expense
-- ---------------------------------------------------------------------------

create function public.create_expense(
  target_household_id uuid,
  title text,
  amount bigint,
  expense_category public.expense_category,
  spent_on date,
  payer_id uuid,
  method public.split_method,
  shares jsonb,
  request_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  new_expense_id uuid;
begin
  if caller is null or not private.is_active_member(target_household_id, caller) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  if request_key is not null then
    select x.id into new_expense_id
    from public.expenses x
    where x.created_by = caller and x.creation_key = request_key;
    if found then
      return new_expense_id;
    end if;
  end if;

  if not private.is_active_member(target_household_id, payer_id) then
    raise exception 'The payer must be an active member' using errcode = 'HJ007';
  end if;

  begin
    insert into public.expenses (
      household_id, description, amount_minor, category, expense_date,
      paid_by, split_method, created_by, creation_key
    )
    values (
      target_household_id, title, amount, expense_category, spent_on,
      payer_id, method, caller, request_key
    )
    returning id into new_expense_id;
  exception when unique_violation then
    -- A concurrent request with the same key won the race.
    select x.id into strict new_expense_id
    from public.expenses x
    where x.created_by = caller and x.creation_key = request_key;
    return new_expense_id;
  end;

  perform private.write_expense_splits(new_expense_id, target_household_id, shares);

  perform private.record_activity(
    target_household_id, 'expense_created', 'expense', new_expense_id,
    jsonb_build_object('after', private.expense_snapshot(new_expense_id))
  );

  return new_expense_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_expense (D6). Replaces every field and the whole split. Pass the
-- updated_at the form was loaded with to refuse overwriting someone else's edit.
-- ---------------------------------------------------------------------------

create function public.update_expense(
  target_expense_id uuid,
  title text,
  amount bigint,
  expense_category public.expense_category,
  spent_on date,
  payer_id uuid,
  method public.split_method,
  shares jsonb,
  expected_updated_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses%rowtype;
  before_values jsonb;
  after_values jsonb;
begin
  e := private.lock_expense_for_change(target_expense_id);

  if e.deleted_at is not null then
    raise exception 'The expense is deleted' using errcode = 'HJ011';
  end if;
  if not private.can_change_expense(e) then
    raise exception 'Only the creator, the payer or the owner can edit this expense'
      using errcode = '42501';
  end if;
  if expected_updated_at is not null and e.updated_at <> expected_updated_at then
    raise exception 'The expense changed since it was loaded' using errcode = 'HJ010';
  end if;
  if not private.is_active_member(e.household_id, payer_id) then
    raise exception 'The payer must be an active member' using errcode = 'HJ007';
  end if;

  before_values := private.expense_snapshot(e.id);

  update public.expenses
  set description = title,
      amount_minor = amount,
      category = expense_category,
      expense_date = spent_on,
      paid_by = payer_id,
      split_method = method
  where id = e.id;

  delete from public.expense_splits where expense_id = e.id;
  perform private.write_expense_splits(e.id, e.household_id, shares);

  after_values := private.expense_snapshot(e.id);
  if after_values is distinct from before_values then
    perform private.record_activity(
      e.household_id, 'expense_updated', 'expense', e.id,
      jsonb_build_object('before', before_values, 'after', after_values)
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_expense (D6, D7): a soft delete. restore_expense: the owner only.
-- ---------------------------------------------------------------------------

create function public.delete_expense(target_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses%rowtype;
begin
  e := private.lock_expense_for_change(target_expense_id);

  if e.deleted_at is not null then
    raise exception 'The expense is already deleted' using errcode = 'HJ011';
  end if;
  if not private.can_change_expense(e) then
    raise exception 'Only the creator, the payer or the owner can delete this expense'
      using errcode = '42501';
  end if;

  update public.expenses
  set deleted_at = now(), deleted_by = (select auth.uid())
  where id = e.id;

  perform private.record_activity(
    e.household_id, 'expense_deleted', 'expense', e.id,
    jsonb_build_object('before', private.expense_snapshot(e.id))
  );
end;
$$;

create function public.restore_expense(target_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses%rowtype;
begin
  e := private.lock_expense_for_change(target_expense_id);

  if private.household_role(e.household_id) is distinct from 'owner' then
    raise exception 'Only the owner can restore an expense' using errcode = '42501';
  end if;
  if e.deleted_at is null then
    raise exception 'The expense is not deleted' using errcode = 'HJ011';
  end if;
  -- Restoring changes balances, so everyone involved must still be here.
  if not private.is_active_member(e.household_id, e.paid_by)
    or exists (
      select 1 from public.expense_splits s
      where s.expense_id = e.id and not private.is_active_member(e.household_id, s.user_id)
    )
  then
    raise exception 'Everyone in this expense must still be a member' using errcode = 'HJ007';
  end if;

  update public.expenses set deleted_at = null, deleted_by = null where id = e.id;

  perform private.record_activity(
    e.household_id, 'expense_restored', 'expense', e.id,
    jsonb_build_object('after', private.expense_snapshot(e.id))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- D13 and O8 (confirmed 2026-11-11): leaving, and removal by the owner, both
-- need a zero balance. Same behaviour as Phase 6 otherwise.
-- ---------------------------------------------------------------------------

create or replace function public.leave_household(target_household_id uuid)
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

  if private.member_net_minor(target_household_id, caller) <> 0 then
    raise exception 'Your balance must be zero before you leave' using errcode = 'HJ006';
  end if;

  update public.household_members set left_at = now() where id = membership.id;
  perform private.revoke_invitations_created_by(target_household_id, caller);

  perform private.record_activity(
    target_household_id, 'member_left', 'household_member', membership.id,
    jsonb_build_object('user_id', caller)
  );
end;
$$;

create or replace function public.remove_member(target_household_id uuid, member_user_id uuid)
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

  if private.member_net_minor(target_household_id, member_user_id) <> 0 then
    raise exception 'Their balance must be zero before they can be removed' using errcode = 'HJ006';
  end if;

  update public.household_members set left_at = now() where id = target_membership_id;
  perform private.revoke_invitations_created_by(target_household_id, member_user_id);

  perform private.record_activity(
    target_household_id, 'member_removed', 'household_member', target_membership_id,
    jsonb_build_object('user_id', member_user_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function private.assert_expense_valid(uuid) from public;
revoke all on function private.check_expense_invariants() from public;
revoke all on function private.lock_household_currency() from public;
revoke all on function private.is_active_member(uuid, uuid) from public;
revoke all on function private.member_net_minor(uuid, uuid) from public;
revoke all on function private.expense_snapshot(uuid) from public;
revoke all on function private.write_expense_splits(uuid, uuid, jsonb) from public;
revoke all on function private.lock_expense_for_change(uuid) from public;
revoke all on function private.can_change_expense(public.expenses) from public;

revoke all on function public.create_expense(uuid, text, bigint, public.expense_category, date, uuid, public.split_method, jsonb, uuid) from public, anon;
revoke all on function public.update_expense(uuid, text, bigint, public.expense_category, date, uuid, public.split_method, jsonb, timestamptz) from public, anon;
revoke all on function public.delete_expense(uuid) from public, anon;
revoke all on function public.restore_expense(uuid) from public, anon;
-- create or replace keeps existing grants; restated for clarity.
revoke all on function public.leave_household(uuid) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;

grant execute on function public.create_expense(uuid, text, bigint, public.expense_category, date, uuid, public.split_method, jsonb, uuid) to authenticated;
grant execute on function public.update_expense(uuid, text, bigint, public.expense_category, date, uuid, public.split_method, jsonb, timestamptz) to authenticated;
grant execute on function public.delete_expense(uuid) to authenticated;
grant execute on function public.restore_expense(uuid) to authenticated;
grant execute on function public.leave_household(uuid) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;

-- Deleted expenses stay readable (D7); queries filter deleted_at themselves.
create policy "Members read their household's expenses"
on public.expenses for select to authenticated
using (private.is_household_member(household_id));

create policy "Members read their household's expense splits"
on public.expense_splits for select to authenticated
using (private.is_household_member(household_id));

revoke all on table public.expenses, public.expense_splits from anon, authenticated;
grant all on table public.expenses, public.expense_splits to service_role;
grant select on table public.expenses, public.expense_splits to authenticated;
