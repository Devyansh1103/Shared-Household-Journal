-- Roadmap Phase 16: budgets and household analytics.
--
-- The model confirmed on 2026-11-02 (requirements-notes §3) is a limit per
-- household and category, where no category means the whole household. The
-- owner then decided on 2026-11-13:
--   O3   any active member may add, change or remove a budget;
--   D29  a budget covers a week, a month or a quarter (not only a month),
--        and shows "Near limit" from 80% of its limit.
-- Proposed here (D29, documented in docs/budgets.md): one active budget per
-- household, category (or none) and period; a new limit applies from the
-- current period, so past periods keep the limit they had (a history in
-- budget_limits); removing a budget keeps it for the periods that had ended.
-- No rollover: nothing unused is carried into the next period.
--
-- Spending is what the expenses say, nothing else (D7, D10, D9):
--   * expenses that aren't deleted, by expense_date (a calendar date, D11);
--   * a recorded bill period is an expense (once: the Phase 14 unique index),
--     and a period that hasn't been recorded is not spending;
--   * settlements aren't spending: they move nothing between the household
--     and the outside world.
-- One currency per household (D1), so every figure is in the same minor
-- units; totals are bigint sums, never floats.
--
-- Weeks run Monday to Sunday (D25), months and quarters are calendar ones,
-- all in the household's timezone (D11): the app and the functions work out
-- "today" from the household's timezone and compare plain dates.
--
-- Additive: two tables, functions, triggers, policies and grants;
-- household_journal is replaced with the same signature and grants. No data
-- changes.
--
-- New error codes (mapped in src/lib/households/errors.ts):
--   HJ031  no such budget (also for other households' ids)
--   HJ032  there's already a budget for that category and period
-- Reused: HJ028 (it's been removed), HJ029 (changed since it was loaded).

-- ---------------------------------------------------------------------------
-- Periods
-- ---------------------------------------------------------------------------

-- The first day of the period that contains a date: Monday (D25), the 1st,
-- or the first day of a calendar quarter. Plain date arithmetic (a date cast
-- to timestamp without time zone), so no session timezone is involved.
create function private.budget_period_start(d date, kind public.budget_period)
returns date
language sql
immutable
strict
set search_path = ''
as $$
  select case kind
    when 'week' then d - (extract(isodow from d)::integer - 1)
    when 'month' then date_trunc('month', d::timestamp)::date
    when 'quarter' then date_trunc('quarter', d::timestamp)::date
  end;
$$;

-- The last day of the period that starts on a date.
create function private.budget_period_end(start date, kind public.budget_period)
returns date
language sql
immutable
strict
set search_path = ''
as $$
  select case kind
    when 'week' then start + 6
    when 'month' then (start::timestamp + interval '1 month')::date - 1
    when 'quarter' then (start::timestamp + interval '3 months')::date - 1
  end;
$$;

-- ---------------------------------------------------------------------------
-- budgets and budget_limits
-- ---------------------------------------------------------------------------

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- Null: the whole household's spending (the overall budget).
  category public.expense_category,
  period public.budget_period not null,
  -- The first day of the first period it covers.
  starts_on date not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  -- Makes create_budget idempotent for a repeated submission.
  creation_key uuid,
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete restrict,
  -- The household's date when it was removed: it covers no period that ends
  -- on or after this date.
  archived_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budgets_id_household_unique unique (id, household_id),
  constraint budgets_starts_on_range check (starts_on between date '2000-01-01' and date '2099-12-31'),
  constraint budgets_archived_together check (
    (archived_at is null) = (archived_by is null)
    and (archived_at is null) = (archived_on is null)
  )
);

comment on table public.budgets is
  'Spending limits per household, category (null: everything) and period. Active members read; writes go through the budget functions only.';

-- One active budget per household, category and period. Two indexes: a
-- null category can't be part of a unique key, and an enum cast to text
-- isn't immutable, so it can't be indexed as an expression.
create unique index budgets_active_category_unique
  on public.budgets (household_id, period, category)
  where archived_at is null and category is not null;
create unique index budgets_active_overall_unique
  on public.budgets (household_id, period)
  where archived_at is null and category is null;
create unique index budgets_created_by_creation_key
  on public.budgets (created_by, creation_key)
  where creation_key is not null;
create index budgets_household_period_idx on public.budgets (household_id, period);
create index budgets_created_by_idx on public.budgets (created_by);
create index budgets_archived_by_idx on public.budgets (archived_by);

create trigger budgets_set_updated_at
before update on public.budgets
for each row execute function private.set_updated_at();

-- A budget's limit over time: each row applies from the period starting on
-- starts_on until the next row. Past periods keep the limit they had.
create table public.budget_limits (
  budget_id uuid not null,
  household_id uuid not null,
  starts_on date not null,
  limit_minor bigint not null
    constraint budget_limits_limit_range check (limit_minor between 1 and 999999999999),
  set_by uuid not null references public.profiles (id) on delete restrict,
  set_at timestamptz not null default now(),
  primary key (budget_id, starts_on),
  constraint budget_limits_budget_fkey foreign key (budget_id, household_id)
    references public.budgets (id, household_id) on delete cascade
);

comment on table public.budget_limits is
  'Each budget''s limit from a period on. Written only by the budget functions.';

create index budget_limits_household_id_idx on public.budget_limits (household_id);
create index budget_limits_set_by_idx on public.budget_limits (set_by);

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER, ADR-006)
-- ---------------------------------------------------------------------------

-- Locks a budget the caller can see, or HJ031 (also for other households').
create function private.lock_budget(target_budget_id uuid)
returns public.budgets
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  b public.budgets%rowtype;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into b from public.budgets x where x.id = target_budget_id for update;
  if not found or not private.is_active_member(b.household_id, caller) then
    raise exception 'No such budget' using errcode = 'HJ031';
  end if;
  return b;
end;
$$;

-- The limit that applies to the period starting on a date. Runs as the
-- caller (RLS applies), so it only ever reads limits the caller may read.
create function private.budget_limit_on(target_budget_id uuid, period_start date)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select l.limit_minor
  from public.budget_limits l
  where l.budget_id = target_budget_id
    and l.starts_on <= period_start
  order by l.starts_on desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Writes: any active member (O3, decided 2026-11-13)
-- ---------------------------------------------------------------------------

create function public.create_budget(
  target_household_id uuid,
  budget_kind public.budget_period,
  budget_limit bigint,
  budget_category public.expense_category default null,
  request_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  first_start date;
  new_budget_id uuid;
begin
  if caller is null or not private.is_active_member(target_household_id, caller) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if request_key is not null then
    select b.id into new_budget_id
    from public.budgets b
    where b.created_by = caller and b.creation_key = request_key;
    if found then
      return new_budget_id;
    end if;
  end if;
  if budget_kind is null then
    raise exception 'Choose a period' using errcode = '23502';
  end if;

  -- It covers the period it's added in, from that period's first day.
  first_start := private.budget_period_start(
    private.household_today(target_household_id), budget_kind
  );

  begin
    insert into public.budgets (household_id, category, period, starts_on, created_by, creation_key)
    values (target_household_id, budget_category, budget_kind, first_start, caller, request_key)
    returning id into new_budget_id;
  exception when unique_violation then
    -- The same request again (concurrently), or another active budget for
    -- this category and period.
    select b.id into new_budget_id
    from public.budgets b
    where request_key is not null and b.created_by = caller and b.creation_key = request_key;
    if found then
      return new_budget_id;
    end if;
    raise exception 'There''s already a budget for this category and period'
      using errcode = 'HJ032';
  end;

  insert into public.budget_limits (budget_id, household_id, starts_on, limit_minor, set_by)
  values (new_budget_id, target_household_id, first_start, budget_limit, caller);

  perform private.record_activity(
    target_household_id, 'budget_created', 'budget', new_budget_id,
    jsonb_build_object(
      'category', budget_category,
      'period', budget_kind,
      'limit_minor', budget_limit,
      'starts_on', first_start
    )
  );
  return new_budget_id;
end;
$$;

-- A new limit, from the current period on. Earlier periods keep theirs.
-- The same limit again changes nothing and writes no event.
create function public.update_budget(
  target_budget_id uuid,
  budget_limit bigint,
  expected_updated_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.budgets%rowtype;
  from_start date;
  old_limit bigint;
begin
  b := private.lock_budget(target_budget_id);
  if b.archived_at is not null then
    raise exception 'The budget has been removed' using errcode = 'HJ028';
  end if;
  if expected_updated_at is not null and b.updated_at <> expected_updated_at then
    raise exception 'The budget changed since it was loaded' using errcode = 'HJ029';
  end if;

  from_start := private.budget_period_start(private.household_today(b.household_id), b.period);
  old_limit := private.budget_limit_on(b.id, from_start);
  if old_limit = budget_limit then
    return;
  end if;

  insert into public.budget_limits (budget_id, household_id, starts_on, limit_minor, set_by)
  values (b.id, b.household_id, from_start, budget_limit, (select auth.uid()))
  on conflict (budget_id, starts_on) do update
    set limit_minor = excluded.limit_minor,
        set_by = excluded.set_by,
        set_at = now();
  update public.budgets x set updated_at = now() where x.id = b.id;

  perform private.record_activity(
    b.household_id, 'budget_updated', 'budget', b.id,
    jsonb_build_object(
      'category', b.category,
      'period', b.period,
      'before_limit_minor', old_limit,
      'after_limit_minor', budget_limit,
      'from_on', from_start
    )
  );
end;
$$;

-- Removed: it no longer covers the current period or any later one, but
-- stays for the periods that had ended. Removed already: nothing happens.
create function public.archive_budget(target_budget_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.budgets%rowtype;
  today date;
begin
  b := private.lock_budget(target_budget_id);
  if b.archived_at is not null then
    return;
  end if;
  today := private.household_today(b.household_id);
  update public.budgets x
  set archived_at = now(), archived_by = (select auth.uid()), archived_on = today
  where x.id = b.id;
  perform private.record_activity(
    b.household_id, 'budget_archived', 'budget', b.id,
    jsonb_build_object(
      'category', b.category,
      'period', b.period,
      'limit_minor', private.budget_limit_on(b.id, private.budget_period_start(today, b.period))
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads (security invoker: RLS applies on top of an explicit membership
-- check; stable, so everything in one answer is one snapshot)
-- ---------------------------------------------------------------------------

-- The budgets of one kind of period, for the period that contains on_date
-- (today by default), with what was spent against each. Money as text.
create function public.household_budgets(
  target_household_id uuid,
  budget_kind public.budget_period,
  on_date date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  today date;
  period_start date;
  period_end date;
  result jsonb;
begin
  if (select auth.uid()) is null or not private.is_household_member(target_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if budget_kind is null then
    raise exception 'Choose a period' using errcode = '22023';
  end if;
  if on_date is not null and on_date not between date '2000-01-01' and date '2099-12-31' then
    raise exception 'The date is out of range' using errcode = '22023';
  end if;

  today := private.household_today(target_household_id);
  period_start := private.budget_period_start(coalesce(on_date, today), budget_kind);
  period_end := private.budget_period_end(period_start, budget_kind);

  with shown as (
    -- Budgets that cover this period: started by its first day, and not
    -- removed before it ended.
    select b.*
    from public.budgets b
    where b.household_id = target_household_id
      and b.period = budget_kind
      and b.starts_on <= period_start
      and (b.archived_on is null or b.archived_on > period_end)
  ),
  -- Counted expenses of the period, read once (the Phase 8 partial index on
  -- household_id, expense_date for expenses that aren't deleted).
  spending as materialized (
    select e.category, e.amount_minor
    from public.expenses e
    where e.household_id = target_household_id
      and e.deleted_at is null
      and e.expense_date between period_start and period_end
  ),
  figures as (
    select
      s.id, s.household_id, s.category, s.period, s.starts_on, s.archived_at,
      s.updated_at,
      private.budget_limit_on(s.id, period_start) as limit_minor,
      coalesce((
        select sum(x.amount_minor)
        from spending x
        where s.category is null or x.category = s.category
      ), 0) as spent_minor,
      (
        select count(*)
        from spending x
        where s.category is null or x.category = s.category
      ) as expense_count
    from shown s
  )
  select jsonb_build_object(
    'today', today,
    'period', budget_kind,
    'period_start', period_start,
    'period_end', period_end,
    'total_spent_minor', (select coalesce(sum(x.amount_minor), 0) from spending x)::text,
    'total_count', (select count(*) from spending x),
    'active_counts', jsonb_build_object(
      'week', (select count(*) from public.budgets b where b.household_id = target_household_id and b.archived_at is null and b.period = 'week'),
      'month', (select count(*) from public.budgets b where b.household_id = target_household_id and b.archived_at is null and b.period = 'month'),
      'quarter', (select count(*) from public.budgets b where b.household_id = target_household_id and b.archived_at is null and b.period = 'quarter')
    ),
    'budgets', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'budget_id', f.id,
          'household_id', f.household_id,
          'category', f.category,
          'period', f.period,
          'starts_on', f.starts_on,
          'archived', f.archived_at is not null,
          'updated_at', f.updated_at,
          'limit_minor', f.limit_minor::text,
          'spent_minor', f.spent_minor::text,
          'expense_count', f.expense_count
        )
        -- The whole household first, then categories in D17's order.
        order by f.category nulls first
      )
      from figures f
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

-- What the household spent between two dates (inclusive), optionally in one
-- category or paid by one person: totals, a period to compare with (by
-- default the same number of days just before; the app passes the same days
-- of last month for "this month so far"), by category, over time, by person
-- (paid and share, kept apart) and the largest expenses. Everything is summed
-- here; no expense list is sent to the browser beyond the largest ten.
create function public.household_analytics(
  target_household_id uuid,
  date_from date,
  date_to date,
  category_filter public.expense_category default null,
  payer_filter uuid default null,
  compare_from date default null,
  compare_to date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  span integer;
  prev_from date;
  prev_to date;
  bucket text;
  result jsonb;
begin
  if (select auth.uid()) is null or not private.is_household_member(target_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if date_from is null or date_to is null
    or date_from not between date '2000-01-01' and date '2099-12-31'
    or date_to not between date '2000-01-01' and date '2099-12-31'
  then
    raise exception 'Choose a start and an end date' using errcode = '22023';
  end if;
  if date_from > date_to then
    raise exception 'A range can''t start after it ends' using errcode = '22023';
  end if;
  span := date_to - date_from + 1;
  if span > 731 then
    raise exception 'Choose at most two years' using errcode = '22023';
  end if;
  if (compare_from is null) <> (compare_to is null) then
    raise exception 'A comparison needs a start and an end' using errcode = '22023';
  end if;
  if compare_from is null then
    prev_to := date_from - 1;
    prev_from := date_from - span;
  else
    -- Before the range, and no longer than it.
    if compare_from > compare_to or compare_to >= date_from
      or compare_to - compare_from + 1 > span
      or compare_from < date '2000-01-01'
    then
      raise exception 'The comparison must come before the range' using errcode = '22023';
    end if;
    prev_from := compare_from;
    prev_to := compare_to;
  end if;
  -- Days for two weeks or less, weeks up to about three months, months
  -- beyond: never more than 26 points.
  bucket := case when span <= 14 then 'day' when span <= 92 then 'week' else 'month' end;

  with counted as materialized (
    -- Counted expenses of both ranges, read once (the Phase 8 partial index).
    select e.id, e.description, e.amount_minor, e.category, e.expense_date,
           e.paid_by, e.created_at
    from public.expenses e
    where e.household_id = target_household_id
      and e.deleted_at is null
      and e.expense_date between prev_from and date_to
      and (category_filter is null or e.category = category_filter)
      and (payer_filter is null or e.paid_by = payer_filter)
  ),
  current_rows as (
    select c.* from counted c where c.expense_date >= date_from
  ),
  previous_rows as (
    select c.* from counted c where c.expense_date <= prev_to
  ),
  shares as (
    select s.user_id, sum(s.share_minor) as share_minor
    from public.expense_splits s
    join current_rows c on c.id = s.expense_id
    group by s.user_id
  ),
  paid as (
    select c.paid_by as user_id, sum(c.amount_minor) as paid_minor, count(*) as paid_count
    from current_rows c
    group by c.paid_by
  ),
  members as (
    select coalesce(p.user_id, s.user_id) as user_id,
           coalesce(p.paid_minor, 0) as paid_minor,
           coalesce(p.paid_count, 0) as paid_count,
           coalesce(s.share_minor, 0) as share_minor
    from paid p
    full join shares s on s.user_id = p.user_id
  ),
  buckets as (
    select g::date as bucket_start
    from generate_series(
      case bucket
        when 'day' then date_from::timestamp
        when 'week' then private.budget_period_start(date_from, 'week')::timestamp
        else date_trunc('month', date_from::timestamp)
      end,
      date_to::timestamp,
      case bucket when 'day' then interval '1 day' when 'week' then interval '1 week' else interval '1 month' end
    ) g
  ),
  trend as (
    select b.bucket_start,
           coalesce(sum(c.amount_minor), 0) as total_minor,
           count(c.id) as expense_count
    from buckets b
    left join current_rows c
      on c.expense_date >= b.bucket_start
      and c.expense_date < (
        b.bucket_start::timestamp
        + case bucket when 'day' then interval '1 day' when 'week' then interval '1 week' else interval '1 month' end
      )::date
    group by b.bucket_start
  ),
  people as (
    select pr.id, pr.display_name,
      exists (
        select 1
        from public.household_members hm
        where hm.household_id = target_household_id
          and hm.user_id = pr.id
          and hm.left_at is null
      ) as is_active
    from public.profiles pr
    where pr.id in (
      select m.user_id from members m
      union select c.paid_by from current_rows c
      union select payer_filter where payer_filter is not null
    )
  )
  select jsonb_build_object(
    'from', date_from,
    'to', date_to,
    'previous_from', prev_from,
    'previous_to', prev_to,
    'bucket', bucket,
    'total_minor', (select coalesce(sum(c.amount_minor), 0) from current_rows c)::text,
    'expense_count', (select count(*) from current_rows c),
    'previous_total_minor', (select coalesce(sum(p.amount_minor), 0) from previous_rows p)::text,
    'previous_count', (select count(*) from previous_rows p),
    'by_category', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'category', x.category,
          'total_minor', x.total::text,
          'expense_count', x.n
        )
        order by x.total desc, x.category
      )
      from (
        select c.category, sum(c.amount_minor) as total, count(*) as n
        from current_rows c
        group by c.category
      ) x
    ), '[]'::jsonb),
    'trend', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'start', t.bucket_start,
          'total_minor', t.total_minor::text,
          'expense_count', t.expense_count
        )
        order by t.bucket_start
      )
      from trend t
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', m.user_id,
          'paid_minor', m.paid_minor::text,
          'paid_count', m.paid_count,
          'share_minor', m.share_minor::text
        )
        order by m.user_id
      )
      from members m
    ), '[]'::jsonb),
    'largest', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'expense_id', l.id,
          'description', l.description,
          'amount_minor', l.amount_minor::text,
          'category', l.category,
          'expense_date', l.expense_date,
          'paid_by', l.paid_by
        )
        order by l.position
      )
      from (
        select c.*, row_number() over (
          order by c.amount_minor desc, c.expense_date desc, c.created_at desc, c.id desc
        ) as position
        from current_rows c
        order by position
        limit 10
      ) l
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', p.id,
          'display_name', p.display_name,
          'is_active', p.is_active
        )
        order by p.id
      )
      from people p
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- The household journal (roadmap Phase 13) shows the budget events
-- ---------------------------------------------------------------------------

-- Same signature, grants and behaviour as in 20261118120100, plus the budget
-- events (filter 'budgets'), their fields, and whether the budget is still
-- active.
create or replace function public.household_journal(
  target_household_id uuid,
  category_filter text default null,
  before_us bigint default null,
  before_id uuid default null,
  page_size integer default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  household_types constant public.activity_event_type[] := array[
    'household_created', 'member_joined', 'member_left', 'member_removed',
    'ownership_transferred', 'invitation_created', 'invitation_revoked'
  ]::public.activity_event_type[];
  expense_types constant public.activity_event_type[] := array[
    'expense_created', 'expense_updated', 'expense_deleted', 'expense_restored'
  ]::public.activity_event_type[];
  settlement_types constant public.activity_event_type[] := array[
    'settlement_recorded', 'settlement_voided'
  ]::public.activity_event_type[];
  bill_types constant public.activity_event_type[] := array[
    'bill_created', 'bill_updated', 'bill_paused', 'bill_resumed', 'bill_ended',
    'bill_skipped', 'bill_unskipped'
  ]::public.activity_event_type[];
  shopping_types constant public.activity_event_type[] := array[
    'shopping_item_added', 'shopping_item_updated', 'shopping_item_purchased',
    'shopping_item_reopened', 'shopping_item_removed'
  ]::public.activity_event_type[];
  chore_types constant public.activity_event_type[] := array[
    'chore_created', 'chore_updated', 'chore_completed', 'chore_reopened',
    'chore_removed'
  ]::public.activity_event_type[];
  budget_types constant public.activity_event_type[] := array[
    'budget_created', 'budget_updated', 'budget_archived'
  ]::public.activity_event_type[];
  shown_types public.activity_event_type[];
  cursor_at timestamptz;
  today date;
  result jsonb;
begin
  if (select auth.uid()) is null or not private.is_household_member(target_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if category_filter is not null
    and category_filter not in (
      'expenses', 'settlements', 'bills', 'shopping', 'chores', 'budgets', 'household'
    )
  then
    raise exception 'Unknown journal category' using errcode = '22023';
  end if;
  if page_size is null or page_size not between 1 and 100 then
    raise exception 'Pages hold 1 to 100 entries' using errcode = '22023';
  end if;
  if (before_us is null) <> (before_id is null) then
    raise exception 'A cursor needs both its time and its id' using errcode = '22023';
  end if;
  -- 253402300799999999 µs is 9999-12-31 23:59:59.999999 UTC.
  if before_us not between 0 and 253402300799999999 then
    raise exception 'The cursor time is out of range' using errcode = '22023';
  end if;

  -- The journal's types: an allowlist.
  shown_types := case category_filter
    when 'expenses' then expense_types
    when 'settlements' then settlement_types
    when 'bills' then bill_types
    when 'shopping' then shopping_types
    when 'chores' then chore_types
    when 'budgets' then budget_types
    when 'household' then household_types
    else household_types || expense_types || settlement_types || bill_types
      || shopping_types || chore_types || budget_types
  end;

  -- Whole seconds, then the microseconds: exact, with no rounding through a
  -- fractional double.
  if before_us is not null then
    cursor_at := to_timestamp(before_us / 1000000)
      + (before_us % 1000000) * interval '1 microsecond';
  end if;
  today := private.household_today(target_household_id);

  with page as (
    select a.id, a.household_id, a.actor_id, a.type, a.entity_type, a.entity_id,
           a.summary, a.created_at
    from public.activity_events a
    where a.household_id = target_household_id
      and a.type = any(shown_types)
      -- Strictly older than the cursor, by (created_at, id). The first line
      -- is the index range; the second breaks the tie at the cursor's time.
      and a.created_at <= coalesce(cursor_at, 'infinity'::timestamptz)
      and (cursor_at is null or a.created_at < cursor_at or a.id < before_id)
      -- Invite links revoked as part of their creator leaving or being
      -- removed: same household, same transaction (so exactly the same
      -- time), same person.
      and not (
        a.type = 'invitation_revoked'
        and exists (
          select 1
          from public.activity_events m
          where m.household_id = a.household_id
            and m.created_at = a.created_at
            and m.type in ('member_left', 'member_removed')
            and m.summary ->> 'user_id' = a.summary ->> 'created_by'
        )
      )
    order by a.created_at desc, a.id desc
    limit page_size + 1
  ),
  shown as (
    select p.*, row_number() over (order by p.created_at desc, p.id desc) as position
    from page p
    order by p.created_at desc, p.id desc
    limit page_size
  ),
  entries as (
    select
      s.*,
      case s.type
        when 'household_created' then
          jsonb_build_object('name', s.summary ->> 'name')
        when 'member_joined' then jsonb_build_object(
          'user_id', s.summary ->> 'user_id',
          -- Who created the link they joined with; the link stays out.
          'inviter_id', (
            select i.created_by
            from public.invitations i
            where i.id = (s.summary ->> 'invitation_id')::uuid
              and i.household_id = s.household_id
          )
        )
        when 'member_left' then
          jsonb_build_object('user_id', s.summary ->> 'user_id')
        when 'member_removed' then
          jsonb_build_object('user_id', s.summary ->> 'user_id')
        when 'ownership_transferred' then jsonb_build_object(
          'from_user_id', s.summary ->> 'from_user_id',
          'to_user_id', s.summary ->> 'to_user_id'
        )
        when 'invitation_created' then '{}'::jsonb
        when 'invitation_revoked' then
          jsonb_build_object('created_by', s.summary ->> 'created_by')
        when 'expense_created' then private.journal_expense(s.summary -> 'after')
        when 'expense_restored' then private.journal_expense(s.summary -> 'after')
        when 'expense_deleted' then private.journal_expense(s.summary -> 'before')
        when 'expense_updated' then jsonb_build_object(
          'before', private.journal_expense_change(s.summary -> 'before'),
          'after', private.journal_expense_change(s.summary -> 'after'),
          -- Whether anyone's share changed, without the shares.
          'shares_changed',
            (s.summary -> 'before' -> 'splits') is distinct from (s.summary -> 'after' -> 'splits')
        )
        when 'settlement_recorded' then private.journal_settlement(s.summary -> 'after')
        when 'settlement_voided' then private.journal_settlement(s.summary -> 'before')
        when 'bill_created' then private.journal_bill(s.summary -> 'after')
        when 'bill_updated' then jsonb_build_object(
          'before', private.journal_bill(s.summary -> 'before'),
          'after', private.journal_bill(s.summary -> 'after')
        )
        when 'bill_paused' then
          jsonb_build_object('description', s.summary ->> 'description')
        when 'bill_resumed' then
          jsonb_build_object('description', s.summary ->> 'description')
        when 'bill_ended' then jsonb_build_object(
          'description', s.summary ->> 'description',
          'ends_on', s.summary ->> 'ends_on'
        )
        when 'bill_skipped' then jsonb_build_object(
          'description', s.summary ->> 'description',
          'due_on', s.summary ->> 'due_on'
        )
        when 'bill_unskipped' then jsonb_build_object(
          'description', s.summary ->> 'description',
          'due_on', s.summary ->> 'due_on'
        )
        when 'shopping_item_added' then private.journal_shopping_item(s.summary -> 'after')
        when 'shopping_item_updated' then jsonb_build_object(
          'before', private.journal_shopping_item(s.summary -> 'before'),
          'after', private.journal_shopping_item(s.summary -> 'after'),
          'note_changed', coalesce((s.summary ->> 'note_changed')::boolean, false)
        )
        when 'shopping_item_purchased' then jsonb_build_object(
          'name', s.summary ->> 'name', 'quantity', s.summary ->> 'quantity'
        )
        when 'shopping_item_reopened' then jsonb_build_object(
          'name', s.summary ->> 'name', 'quantity', s.summary ->> 'quantity'
        )
        when 'shopping_item_removed' then jsonb_build_object(
          'name', s.summary ->> 'name', 'quantity', s.summary ->> 'quantity'
        )
        when 'chore_created' then private.journal_chore(s.summary -> 'after')
        when 'chore_updated' then jsonb_build_object(
          'before', private.journal_chore(s.summary -> 'before'),
          'after', private.journal_chore(s.summary -> 'after'),
          'description_changed', coalesce((s.summary ->> 'description_changed')::boolean, false)
        )
        when 'chore_completed' then jsonb_build_object('title', s.summary ->> 'title')
        when 'chore_reopened' then jsonb_build_object('title', s.summary ->> 'title')
        when 'chore_removed' then jsonb_build_object('title', s.summary ->> 'title')
        when 'budget_created' then jsonb_build_object(
          'category', s.summary ->> 'category',
          'period', s.summary ->> 'period',
          'limit_minor', s.summary ->> 'limit_minor',
          'starts_on', s.summary ->> 'starts_on'
        )
        when 'budget_updated' then jsonb_build_object(
          'category', s.summary ->> 'category',
          'period', s.summary ->> 'period',
          'before_limit_minor', s.summary ->> 'before_limit_minor',
          'after_limit_minor', s.summary ->> 'after_limit_minor',
          'from_on', s.summary ->> 'from_on'
        )
        when 'budget_archived' then jsonb_build_object(
          'category', s.summary ->> 'category',
          'period', s.summary ->> 'period',
          'limit_minor', s.summary ->> 'limit_minor'
        )
      end as detail
    from shown s
  ),
  mentioned as (
    select e.actor_id as user_id from entries e
    union select (e.detail ->> 'user_id')::uuid from entries e
    union select (e.detail ->> 'inviter_id')::uuid from entries e
    union select (e.detail ->> 'from_user_id')::uuid from entries e
    union select (e.detail ->> 'to_user_id')::uuid from entries e
    union select (e.detail ->> 'created_by')::uuid from entries e
    union select (e.detail ->> 'paid_by')::uuid from entries e
    union select (e.detail ->> 'from_user')::uuid from entries e
    union select (e.detail ->> 'to_user')::uuid from entries e
    union select (e.detail ->> 'recorded_by')::uuid from entries e
    union select (e.detail ->> 'payer_id')::uuid from entries e
    union select (e.detail ->> 'assignee_id')::uuid from entries e
    union select (e.detail -> 'before' ->> 'paid_by')::uuid from entries e
    union select (e.detail -> 'after' ->> 'paid_by')::uuid from entries e
    union select (e.detail -> 'before' ->> 'payer_id')::uuid from entries e
    union select (e.detail -> 'after' ->> 'payer_id')::uuid from entries e
    union select (e.detail -> 'before' ->> 'assignee_id')::uuid from entries e
    union select (e.detail -> 'after' ->> 'assignee_id')::uuid from entries e
    union
    select jsonb_array_elements_text(e.detail -> 'before' -> 'participants')::uuid
    from entries e
    where e.type = 'expense_updated'
    union
    select jsonb_array_elements_text(e.detail -> 'after' -> 'participants')::uuid
    from entries e
    where e.type = 'expense_updated'
  ),
  people as (
    select
      pr.id,
      pr.display_name,
      exists (
        select 1
        from public.household_members hm
        where hm.household_id = target_household_id
          and hm.user_id = pr.id
          and hm.left_at is null
      ) as is_active
    from public.profiles pr
    where pr.id in (select m.user_id from mentioned m where m.user_id is not null)
  )
  select jsonb_build_object(
    'has_more', (select count(*) from page) > page_size,
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'event_id', e.id,
          'household_id', e.household_id,
          'type', e.type,
          'actor_id', e.actor_id,
          'created_us', (extract(epoch from e.created_at) * 1000000)::bigint::text,
          'detail', e.detail,
          'entity', case
            when e.entity_type = 'expense' then coalesce((
              select jsonb_build_object(
                'available', true,
                'id', x.id,
                'state', case when x.deleted_at is null then 'active' else 'deleted' end
              )
              from public.expenses x
              where x.id = e.entity_id
                and x.household_id = target_household_id
            ), jsonb_build_object('available', false))
            when e.entity_type = 'settlement' then coalesce((
              select jsonb_build_object(
                'available', true,
                'id', t.id,
                'state', case when t.voided_at is null then 'active' else 'voided' end
              )
              from public.settlements t
              where t.id = e.entity_id
                and t.household_id = target_household_id
            ), jsonb_build_object('available', false))
            when e.entity_type = 'recurring_bill' then coalesce((
              select jsonb_build_object(
                'available', true,
                'id', rb.id,
                'state', case
                  when rb.paused_at is not null then 'paused'
                  when not private.bill_has_next(rb, today) then 'ended'
                  else 'active'
                end
              )
              from public.recurring_bills rb
              where rb.id = e.entity_id
                and rb.household_id = target_household_id
            ), jsonb_build_object('available', false))
            when e.entity_type = 'shopping_item' then coalesce((
              select jsonb_build_object(
                'available', true,
                'id', si.id,
                'state', case
                  when si.removed_at is not null then 'removed'
                  when si.purchased_at is not null then 'purchased'
                  else 'active'
                end
              )
              from public.shopping_items si
              where si.id = e.entity_id
                and si.household_id = target_household_id
            ), jsonb_build_object('available', false))
            when e.entity_type = 'chore' then coalesce((
              select jsonb_build_object(
                'available', true,
                'id', ch.id,
                'state', case
                  when ch.removed_at is not null then 'removed'
                  when ch.completed_at is not null then 'completed'
                  else 'active'
                end
              )
              from public.chores ch
              where ch.id = e.entity_id
                and ch.household_id = target_household_id
            ), jsonb_build_object('available', false))
            when e.entity_type = 'budget' then coalesce((
              select jsonb_build_object(
                'available', true,
                'id', bu.id,
                'state', case when bu.archived_at is null then 'active' else 'archived' end
              )
              from public.budgets bu
              where bu.id = e.entity_id
                and bu.household_id = target_household_id
            ), jsonb_build_object('available', false))
          end
        )
        order by e.position
      )
      from entries e
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', p.id,
          'display_name', p.display_name,
          'is_active', p.is_active
        )
        order by p.id
      )
      from people p
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access: active members read; nobody writes directly (ADR-006)
-- ---------------------------------------------------------------------------

alter table public.budgets enable row level security;
alter table public.budget_limits enable row level security;

create policy "Members read their household's budgets"
on public.budgets for select to authenticated
using (private.is_household_member(household_id));

create policy "Members read their household's budget limits"
on public.budget_limits for select to authenticated
using (private.is_household_member(household_id));

revoke all on table public.budgets, public.budget_limits from anon, authenticated;
grant all on table public.budgets, public.budget_limits to service_role;
grant select on table public.budgets, public.budget_limits to authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function private.budget_period_start(date, public.budget_period) from public;
revoke all on function private.budget_period_end(date, public.budget_period) from public;
revoke all on function private.lock_budget(uuid) from public;
revoke all on function private.budget_limit_on(uuid, date) from public;
-- The reads run as the caller, so the caller needs these. The period
-- helpers read no table; budget_limit_on runs as the caller, under RLS.
-- The private schema isn't exposed through the Data API.
grant execute on function private.budget_period_start(date, public.budget_period) to authenticated;
grant execute on function private.budget_period_end(date, public.budget_period) to authenticated;
grant execute on function private.budget_limit_on(uuid, date) to authenticated;

revoke all on function public.create_budget(uuid, public.budget_period, bigint, public.expense_category, uuid) from public, anon;
revoke all on function public.update_budget(uuid, bigint, timestamptz) from public, anon;
revoke all on function public.archive_budget(uuid) from public, anon;
revoke all on function public.household_budgets(uuid, public.budget_period, date) from public, anon;
revoke all on function public.household_analytics(uuid, date, date, public.expense_category, uuid, date, date) from public, anon;

grant execute on function public.create_budget(uuid, public.budget_period, bigint, public.expense_category, uuid) to authenticated;
grant execute on function public.update_budget(uuid, bigint, timestamptz) to authenticated;
grant execute on function public.archive_budget(uuid) to authenticated;
grant execute on function public.household_budgets(uuid, public.budget_period, date) to authenticated;
grant execute on function public.household_analytics(uuid, date, date, public.expense_category, uuid, date, date) to authenticated;

-- create or replace keeps existing grants; restated for clarity.
revoke all on function public.household_journal(uuid, text, bigint, uuid, integer) from public, anon;
grant execute on function public.household_journal(uuid, text, bigint, uuid, integer) to authenticated;
