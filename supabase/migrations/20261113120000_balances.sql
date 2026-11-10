-- Roadmap Phase 9 (the owner's brief calls it Phase 10): balances and how they
-- are explained. Balances are derived from the records on every read and are
-- never stored (FR-05, ADR-005).
--
-- Rules:
--   ADR-005  Each participant owes the payer their share. Between two people
--            the two directions offset (nothing moves between pairs: that
--            would be debt simplification, Phase 21). Net = paid − shares;
--            settlements join in Phase 10. Computed here, in a security_invoker
--            function, and cross-checked against src/domain/money/balances.ts.
--   D7       Deleted expenses don't count.
--   D1       One currency per household, locked once it has an expense, so
--            amounts in different currencies never meet.
--   D13, O8  Zero balance to leave or be removed: member_net_minor now uses the
--            same definition as the balances people see.
--   D24      (confirmed 2026-11-10) An expense involving someone who has left
--            can still be deleted, which can leave them with a balance (shown
--            with "(left)"), but it can't be edited: update_expense now refuses
--            it, as the edit page already did.
--
-- Additive: new functions. private.member_net_minor and public.update_expense
-- are replaced with the same signatures and grants. No data changes.
--
-- New error code (mapped in src/lib/households/errors.ts):
--   HJ013  balances can't be calculated because a counted expense doesn't add
--          up; DETAIL carries the expense id.

-- ---------------------------------------------------------------------------
-- Reconciliation: never calculate from an expense that doesn't add up
-- ---------------------------------------------------------------------------

-- The write functions and the deferred constraint triggers (Phase 8) already
-- stop a counted expense from having no participants, or shares that don't add
-- up to its amount. This check makes sure a balance is never calculated from
-- such an expense anyway (for example after data was loaded without its
-- triggers): the caller gets HJ013 naming the expense, not a wrong figure.
create function private.assert_balances_reconcile(target_household_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  broken_expense_id uuid;
begin
  select e.id into broken_expense_id
  from public.expenses e
  left join public.expense_splits s on s.expense_id = e.id
  where e.household_id = target_household_id
    and e.deleted_at is null
  group by e.id, e.amount_minor
  having count(s.user_id) = 0 or sum(s.share_minor) <> e.amount_minor
  order by e.id
  limit 1;

  if broken_expense_id is not null then
    raise exception 'Expense % doesn''t add up, so balances can''t be calculated', broken_expense_id
      using errcode = 'HJ013', detail = broken_expense_id::text;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The one definition of a balance
-- ---------------------------------------------------------------------------

-- Per person: what they paid (the whole amount of each counted expense they
-- paid for) and their shares (their split of each counted expense). There is a
-- row for every active member, and for anyone else who paid for or shares a
-- counted expense (someone who has left), so the rows always cover every
-- counted amount. Sums are numeric, so they can't overflow.
--
-- Runs as the caller: under RLS when a member asks, with the definer's rights
-- inside member_net_minor.
create function private.balance_people(target_household_id uuid)
returns table (
  user_id uuid,
  paid_minor numeric,
  share_minor numeric,
  paid_count bigint,
  share_count bigint
)
language sql
stable
set search_path = ''
as $$
  with counted as (
    select e.id, e.paid_by, e.amount_minor
    from public.expenses e
    where e.household_id = target_household_id
      and e.deleted_at is null
  ),
  paid as (
    select c.paid_by as user_id, sum(c.amount_minor) as paid_minor, count(*) as paid_count
    from counted c
    group by c.paid_by
  ),
  shared as (
    select s.user_id, sum(s.share_minor) as share_minor, count(*) as share_count
    from public.expense_splits s
    join counted c on c.id = s.expense_id
    group by s.user_id
  ),
  people as (
    select m.user_id
    from public.household_members m
    where m.household_id = target_household_id
      and m.left_at is null
    union
    select p.user_id from paid p
    union
    select x.user_id from shared x
  )
  select
    people.user_id,
    coalesce(p.paid_minor, 0),
    coalesce(x.share_minor, 0),
    coalesce(p.paid_count, 0),
    coalesce(x.share_count, 0)
  from people
  left join paid p on p.user_id = people.user_id
  left join shared x on x.user_id = people.user_id;
$$;

-- What someone has paid minus their shares, for D13 and O8. Replaces the
-- Phase 8 version with the definition above, so the rule for leaving and the
-- balance people see can't disagree; refuses (HJ013) if the records don't add
-- up. Settlements are added in balance_people (Phase 10).
create or replace function private.member_net_minor(target_household_id uuid, target_user_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_balances_reconcile(target_household_id);
  return coalesce((
    select (b.paid_minor - b.share_minor)::bigint
    from private.balance_people(target_household_id) b
    where b.user_id = target_user_id
  ), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- household_balances: everything the balances pages show, in one call
-- ---------------------------------------------------------------------------

-- Runs as the caller (security invoker), so RLS applies on top of the explicit
-- membership check. Stable, so every part is read from the same snapshot and
-- the parts always agree with each other.
--
-- Money is sent as text, never as JSON numbers: a household's totals aren't
-- capped the way a single expense is, and a JSON number is a double.
--
--   expense_count, total_minor   counted expenses and what they add up to
--   people   [{ user_id, display_name, is_active, paid_minor, share_minor,
--              net_minor, paid_count, share_count }]
--            active members in join order, then people who have left
--   pairs    [{ debtor_id, creditor_id, amount_minor }]
--            who owes whom after the two directions offset; largest first
--   entry_count, entries   only with focus_user_id: the counted expenses that
--            person paid for or shares, newest first (at most 200):
--            [{ expense_id, description, expense_date, amount_minor, paid_by,
--               paid_minor, share_minor, net_minor,
--               counterparts: [{ user_id, minor }] }]
--            counterparts: + that person owes the focus person, − the focus
--            person owes them; they add up to net_minor.
create function public.household_balances(
  target_household_id uuid,
  focus_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  result jsonb;
begin
  if (select auth.uid()) is null or not private.is_household_member(target_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  perform private.assert_balances_reconcile(target_household_id);

  with counted as (
    select e.id, e.description, e.expense_date, e.created_at, e.amount_minor, e.paid_by
    from public.expenses e
    where e.household_id = target_household_id
      and e.deleted_at is null
  ),
  people as (
    select
      b.user_id,
      b.paid_minor,
      b.share_minor,
      b.paid_count,
      b.share_count,
      pr.display_name,
      m.joined_at,
      m.user_id is not null as is_active
    from private.balance_people(target_household_id) b
    left join public.household_members m
      on m.household_id = target_household_id
     and m.user_id = b.user_id
     and m.left_at is null
    left join public.profiles pr on pr.id = b.user_id
  ),
  -- Each participant owes the payer their share; a payer's own share isn't
  -- owed to anyone. low_owes > 0 means the lower id owes the higher id.
  pairs as (
    select
      least(s.user_id, c.paid_by) as low_id,
      greatest(s.user_id, c.paid_by) as high_id,
      sum(case when s.user_id < c.paid_by then s.share_minor else -s.share_minor end) as low_owes
    from public.expense_splits s
    join counted c on c.id = s.expense_id
    where s.user_id <> c.paid_by
      and s.share_minor > 0
    group by 1, 2
  ),
  focus_entries as (
    select
      c.id,
      c.description,
      c.expense_date,
      c.created_at,
      c.amount_minor,
      c.paid_by,
      case when c.paid_by = focus_user_id then c.amount_minor else 0 end as paid_minor,
      coalesce(mine.share_minor, 0) as share_minor
    from counted c
    left join public.expense_splits mine
      on mine.expense_id = c.id
     and mine.user_id = focus_user_id
    where focus_user_id is not null
      and (c.paid_by = focus_user_id or mine.user_id is not null)
  )
  select jsonb_build_object(
    'expense_count', (select count(*) from counted),
    'total_minor', (select coalesce(sum(c.amount_minor), 0) from counted c)::text,
    'people', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', p.user_id,
          'display_name', p.display_name,
          'is_active', p.is_active,
          'paid_minor', p.paid_minor::text,
          'share_minor', p.share_minor::text,
          'net_minor', (p.paid_minor - p.share_minor)::text,
          'paid_count', p.paid_count,
          'share_count', p.share_count
        )
        order by p.is_active desc, p.joined_at, p.display_name, p.user_id
      )
      from people p
    ), '[]'::jsonb),
    'pairs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'debtor_id', case when x.low_owes > 0 then x.low_id else x.high_id end,
          'creditor_id', case when x.low_owes > 0 then x.high_id else x.low_id end,
          'amount_minor', abs(x.low_owes)::text
        )
        order by abs(x.low_owes) desc, x.low_id, x.high_id
      )
      from pairs x
      where x.low_owes <> 0
    ), '[]'::jsonb),
    'entry_count', (select count(*) from focus_entries),
    'entries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'expense_id', f.id,
          'description', f.description,
          'expense_date', f.expense_date,
          'amount_minor', f.amount_minor::text,
          'paid_by', f.paid_by,
          'paid_minor', f.paid_minor::text,
          'share_minor', f.share_minor::text,
          'net_minor', (f.paid_minor - f.share_minor)::text,
          'counterparts', case
            when f.paid_by = focus_user_id then coalesce((
              select jsonb_agg(
                jsonb_build_object('user_id', o.user_id, 'minor', o.share_minor::text)
                order by o.user_id
              )
              from public.expense_splits o
              where o.expense_id = f.id
                and o.user_id <> focus_user_id
                and o.share_minor > 0
            ), '[]'::jsonb)
            when f.share_minor > 0 then jsonb_build_array(
              jsonb_build_object('user_id', f.paid_by, 'minor', (-f.share_minor)::text)
            )
            else '[]'::jsonb
          end
        )
        order by f.expense_date desc, f.created_at desc, f.id
      )
      from (
        select *
        from focus_entries
        order by expense_date desc, created_at desc, id
        limit 200
      ) f
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- D24: an expense involving someone who has left can't be edited
-- ---------------------------------------------------------------------------

-- Same as Phase 8, plus one check: editing replaces the whole split, which
-- would change the balance of someone who has left, so it's refused (HJ007),
-- as restore_expense already is. Deleting such an expense stays allowed (D24).
create or replace function public.update_expense(
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
  if not private.is_active_member(e.household_id, e.paid_by)
    or exists (
      select 1 from public.expense_splits s
      where s.expense_id = e.id and not private.is_active_member(e.household_id, s.user_id)
    )
  then
    raise exception 'Someone in this expense has left, so it can''t be edited' using errcode = 'HJ007';
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
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function private.assert_balances_reconcile(uuid) from public;
revoke all on function private.balance_people(uuid) from public;
-- household_balances runs as the caller, so the caller needs these two as well.
-- They read through RLS, and the private schema isn't exposed through the Data
-- API, so they can't be called directly.
grant execute on function private.assert_balances_reconcile(uuid) to authenticated;
grant execute on function private.balance_people(uuid) to authenticated;

revoke all on function public.household_balances(uuid, uuid) from public, anon;
grant execute on function public.household_balances(uuid, uuid) to authenticated;

-- create or replace keeps existing grants; restated for clarity.
revoke all on function private.member_net_minor(uuid, uuid) from public;
revoke all on function public.update_expense(uuid, text, bigint, public.expense_category, date, uuid, public.split_method, jsonb, timestamptz) from public, anon;
grant execute on function public.update_expense(uuid, text, bigint, public.expense_category, date, uuid, public.split_method, jsonb, timestamptz) to authenticated;
