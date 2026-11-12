-- Roadmap Phase 12: expense history with search, filters, sorting and pages.
--
-- One read function, public.expense_history. It runs as the caller (security
-- invoker), so RLS applies on top of an explicit membership check, and it's
-- stable, so the page of rows, the summary and the household totals are read
-- from one snapshot and always agree with each other. The app verifies them
-- before showing anything (src/lib/expenses/history-payload.ts).
--
-- Rules:
--   D7   Deleted expenses are listed only when asked for, and never count
--        towards a total.
--   D1   One currency per household, so every amount here is in the same
--        minor units and totals never mix currencies.
--   D11  Dates are calendar dates; the app resolves "today", "this week" and
--        the like in the household's timezone and sends plain dates.
--   D17  Categories are the fixed enum.
--
-- Additive: one function. No tables, columns, indexes or data changes. The
-- Phase 8 partial indexes on (household_id, expense_date, created_at) for
-- counted expenses and (household_id, deleted_at) for deleted ones serve the
-- household-scoped scans; each branch below repeats its index's predicate
-- literally so the planner can use it. See docs/database.md.
--
-- Input that can't be right is refused with 22023 (invalid_parameter_value):
-- an unknown sort, a page size outside 1–100, a page below 1, more than 120
-- characters of search, or a range whose start is after its end. The app
-- checks all of these first.

create function public.expense_history(
  target_household_id uuid,
  search_text text default null,
  search_categories public.expense_category[] default null,
  date_from date default null,
  date_to date default null,
  categories public.expense_category[] default null,
  payers uuid[] default null,
  amount_min bigint default null,
  amount_max bigint default null,
  deleted_only boolean default false,
  sort_order text default 'newest',
  page_size integer default 25,
  page_number integer default 1
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
  if sort_order is null
    or sort_order not in ('newest', 'oldest', 'highest', 'lowest', 'recent')
  then
    raise exception 'Unknown sort order' using errcode = '22023';
  end if;
  if page_size is null or page_size not between 1 and 100
    or page_number is null or page_number < 1
  then
    raise exception 'Pages hold 1 to 100 expenses and start at 1' using errcode = '22023';
  end if;
  if char_length(search_text) > 120 then
    raise exception 'Search text is too long' using errcode = '22023';
  end if;
  if date_from > date_to or amount_min > amount_max then
    raise exception 'A range can''t start after it ends' using errcode = '22023';
  end if;

  -- Every expense of the household, read once. Each branch repeats its
  -- partial index's predicate (counted: deleted_at is null; deleted: is not
  -- null) so the planner can use the Phase 8 indexes, and the rows are
  -- materialised so the RLS check on expenses runs once per row, not once
  -- per row for each total below.
  with household_rows as materialized (
    select e.id, e.household_id, e.description, e.amount_minor, e.category,
           e.expense_date, e.paid_by, e.created_at, e.deleted_at,
           false as is_deleted
    from public.expenses e
    where e.household_id = target_household_id
      and e.deleted_at is null
    union all
    select e.id, e.household_id, e.description, e.amount_minor, e.category,
           e.expense_date, e.paid_by, e.created_at, e.deleted_at,
           true as is_deleted
    from public.expenses e
    where e.household_id = target_household_id
      and e.deleted_at is not null
  ),
  -- The whole household, whatever the filters, to compare against: counted
  -- spending (D7) and how many are deleted.
  household_totals as (
    select
      count(*) filter (where not h.is_deleted) as counted,
      coalesce(sum(h.amount_minor) filter (where not h.is_deleted), 0) as counted_total,
      count(*) filter (where h.is_deleted) as deleted
    from household_rows h
  ),
  matching as (
    select c.*
    from household_rows c
    where c.is_deleted = coalesce(deleted_only, false)
      and (date_from is null or c.expense_date >= date_from)
      and (date_to is null or c.expense_date <= date_to)
      and (coalesce(cardinality(categories), 0) = 0 or c.category = any(categories))
      and (coalesce(cardinality(payers), 0) = 0 or c.paid_by = any(payers))
      and (amount_min is null or c.amount_minor >= amount_min)
      and (amount_max is null or c.amount_minor <= amount_max)
      -- Search: the text anywhere in the description, ignoring case, or a
      -- category whose name matches (the app works those out from D17's
      -- labels). Plain string functions on a parameter: no pattern syntax,
      -- so nothing typed is ever treated as a wildcard or as SQL.
      and (
        coalesce(search_text, '') = ''
        or strpos(lower(c.description), lower(search_text)) > 0
        or c.category = any(coalesce(search_categories, '{}'::public.expense_category[]))
      )
  ),
  stats as (
    select count(*) as n, coalesce(sum(m.amount_minor), 0) as total
    from matching m
  ),
  -- A page past the end (say, after a filter change) is the last page.
  paging as (
    select
      greatest(1, ceil(s.n::numeric / page_size))::integer as page_count,
      least(page_number, greatest(1, ceil(s.n::numeric / page_size))::integer) as page
    from stats s
  ),
  -- Deterministic orders; the id is the last tie-breaker, so every row has
  -- exactly one position and pages never overlap or skip:
  --   newest   date ↓, added ↓, id ↓
  --   oldest   date ↑, added ↑, id ↑
  --   highest  amount ↓, then as newest
  --   lowest   amount ↑, then as newest
  --   recent   added ↓, then as newest
  ordered as (
    select
      m.*,
      row_number() over (
        order by
          case when sort_order = 'highest' then m.amount_minor end desc nulls last,
          case when sort_order = 'lowest' then m.amount_minor end asc nulls last,
          case when sort_order = 'recent' then m.created_at end desc nulls last,
          case when sort_order = 'oldest' then m.expense_date end asc nulls last,
          case when sort_order = 'oldest' then m.created_at end asc nulls last,
          case when sort_order = 'oldest' then m.id end asc nulls last,
          m.expense_date desc, m.created_at desc, m.id desc
      ) as position
    from matching m
  ),
  page_rows as (
    select o.*
    from ordered o
    cross join paging p
    where o.position > (p.page - 1)::bigint * page_size
      and o.position <= p.page::bigint * page_size
  ),
  largest as (
    select m.id, m.description, m.amount_minor, m.expense_date
    from matching m
    order by m.amount_minor desc, m.expense_date desc, m.created_at desc, m.id desc
    limit 1
  )
  select jsonb_build_object(
    'total_count', s.n,
    'total_minor', s.total::text,
    -- Rounded to the nearest minor unit, halves away from zero.
    'average_minor', case when s.n > 0 then round(s.total / s.n)::text end,
    'largest', (
      select jsonb_build_object(
        'expense_id', l.id,
        'description', l.description,
        'amount_minor', l.amount_minor::text,
        'expense_date', l.expense_date
      )
      from largest l
    ),
    'page', p.page,
    'page_count', p.page_count,
    'page_size', page_size,
    'household_count', ht.counted,
    'household_total_minor', ht.counted_total::text,
    'household_deleted_count', ht.deleted,
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'expense_id', r.id,
          'household_id', r.household_id,
          'position', r.position,
          'description', r.description,
          'amount_minor', r.amount_minor::text,
          'category', r.category,
          'expense_date', r.expense_date,
          'paid_by', r.paid_by,
          -- One primary-key lookup per row on the page (under the profiles
          -- RLS policy), never a scan of every profile.
          'payer_name', (
            select pr.display_name from public.profiles pr where pr.id = r.paid_by
          ),
          'payer_is_active', exists (
            select 1
            from public.household_members hm
            where hm.household_id = target_household_id
              and hm.user_id = r.paid_by
              and hm.left_at is null
          ),
          -- Microseconds since the epoch, as text, so the app can check the
          -- order exactly (timestamps as text don't compare reliably).
          'created_us', (extract(epoch from r.created_at) * 1000000)::bigint::text,
          'deleted_at', r.deleted_at
        )
        order by r.position
      )
      from page_rows r
    ), '[]'::jsonb)
  )
  into result
  from stats s
  cross join paging p
  cross join household_totals ht;

  return result;
end;
$$;

revoke all on function public.expense_history(
  uuid, text, public.expense_category[], date, date, public.expense_category[],
  uuid[], bigint, bigint, boolean, text, integer, integer
) from public, anon;
grant execute on function public.expense_history(
  uuid, text, public.expense_category[], date, date, public.expense_category[],
  uuid[], bigint, bigint, boolean, text, integer, integer
) to authenticated;
