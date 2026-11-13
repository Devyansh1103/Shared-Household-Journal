-- Roadmap Phase 14: recurring bills and their periods (D10, D11, ADR-010;
-- D27 proposed).
--
-- A recurring bill is a reminder, never money: it describes a repeating
-- obligation and pre-fills an expense when someone records a period of it.
-- Nothing is created automatically and nothing counts until a member records
-- the expense ("Record this bill"), through the same create_expense the
-- expense form uses (ADR-010). Unpaid periods are never part of any balance or
-- total.
--
-- Four separate records:
--   recurring_bills     the definition: what, how much (expected), category,
--                       who usually pays, the default split, the schedule
--   bill_occurrences    one period of it (its due date and expected amount),
--                       stored only once something happens to it (see below)
--   expenses            what was actually spent, linked to the period it
--                       paid by recurring_bill_id + recurrence_period
--   settlements         unchanged: how people even out between themselves
--
-- No scheduler (ADR-010: "the first release needs no scheduler"). A bill's
-- periods follow from its schedule, so the reads work them out in the
-- household's timezone (D11) every time: the periods that have come and are
-- still open, and the next one. Nothing goes stale, nothing has to catch up
-- after downtime, and nothing can be generated twice. A period is stored
-- (bill_occurrences) only inside the transaction of an action that needs it:
-- recording, skipping, and, before a change of schedule, pause or end, every
-- period that has already come, so it keeps the dates it came with (D10:
-- edits apply to future periods only).
--
-- The schedule (D10, ADR-010): weekly, monthly or yearly, every N of them,
-- counted from its first due date (anchor_on). The k-th period is always
-- worked out from the anchor, never from the period before, so a bill on the
-- 31st falls on the last day of shorter months and comes back to the 31st
-- (Postgres adds months that way); a yearly bill on 29 February falls on
-- 28 February in other years. The same rules are in src/lib/bills/schedule.ts
-- and the tests compare the two.
--
-- Rules:
--   D10   One counted expense per bill per period: a unique index on
--         expenses (recurring_bill_id, recurrence_period) for expenses that
--         aren't deleted, and a foreign key to the stored period, so an
--         expense can only be linked to a real period of a bill in its own
--         household.
--   D6    Recording uses create_expense: payer and participants are active
--         members, the split adds up, the journal gets expense_created.
--   D7    Deleting the expense reopens the period; restoring it is refused
--         if the period was recorded again or skipped meanwhile (HJ025).
--   D27   (proposed) Any member adds a bill or records a period; the person
--         who added it, the person who usually pays and the owner change,
--         pause, resume, end it or skip a period. Skipping can be undone.
--
-- Additive: three tables, two columns, a check and a foreign key on expenses
-- (both satisfied by every existing row, where the columns are null), indexes,
-- functions, triggers, policies and grants. restore_expense and
-- household_journal are replaced with the same signatures and grants. No data
-- changes.
--
-- New error codes (mapped in src/lib/households/errors.ts):
--   HJ018  no such bill (also for other households' ids)
--   HJ019  the schedule isn't valid (dates out of range, an end before a
--          period that has already come, or too many periods at once)
--   HJ020  the bill changed since it was loaded
--   HJ021  the bill is already paused / not paused / already ended
--   HJ022  that period is already recorded
--   HJ023  that period is skipped (record) / not skipped (undo) / already
--          skipped
--   HJ024  that isn't a period of the bill that can be acted on
--   HJ025  the expense's period was recorded again or skipped (restore)

-- ---------------------------------------------------------------------------
-- recurring_bills
-- ---------------------------------------------------------------------------

create table public.recurring_bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- Pre-fills the expense's description, so the same rule.
  description text not null
    constraint recurring_bills_description_length
    check (char_length(description) between 1 and 120 and description = btrim(description)),
  notes text
    constraint recurring_bills_notes_length
    check (notes is null or (char_length(notes) between 1 and 500 and notes = btrim(notes))),
  -- The expected amount, in the household's currency (D1, D2). A period can
  -- be recorded for a different amount; this doesn't change when it is.
  amount_minor bigint not null
    constraint recurring_bills_amount_range check (amount_minor between 1 and 999999999999),
  category public.expense_category not null,
  -- Who usually pays: pre-fills "Paid by".
  payer_id uuid not null references public.profiles (id) on delete restrict,
  split_method public.split_method not null,
  frequency public.bill_frequency not null,
  interval_count integer not null
    constraint recurring_bills_interval_range check (interval_count between 1 and 52),
  -- The first due date of the current schedule. Period k (from 0) is due on
  -- private.bill_due_date(anchor_on, frequency, interval_count, k).
  anchor_on date not null,
  -- Periods 0 .. next_index - 1 of the current schedule are stored.
  next_index integer not null default 0
    constraint recurring_bills_next_index_non_negative check (next_index >= 0),
  -- No period is due after this date (inclusive), if set.
  ends_on date,
  paused_at timestamptz,
  paused_by uuid references public.profiles (id) on delete restrict,
  created_by uuid not null references public.profiles (id) on delete restrict,
  -- Makes create_recurring_bill idempotent for a repeated form submission.
  creation_key uuid,
  created_at timestamptz not null default now(),
  -- Changed by the functions when the definition changes (not when a period
  -- is stored), so an edit form can tell if someone else changed it.
  updated_at timestamptz not null default now(),
  constraint recurring_bills_paused_together check ((paused_at is null) = (paused_by is null)),
  constraint recurring_bills_id_household_id_key unique (id, household_id)
);

comment on table public.recurring_bills is
  'Repeating bills (reminders, D10). Active members read; writes go through the recurring bill functions only.';

create unique index recurring_bills_created_by_creation_key
  on public.recurring_bills (created_by, creation_key)
  where creation_key is not null;
create index recurring_bills_household_id_idx on public.recurring_bills (household_id);
create index recurring_bills_payer_id_idx on public.recurring_bills (payer_id);
create index recurring_bills_created_by_idx on public.recurring_bills (created_by);
create index recurring_bills_paused_by_idx on public.recurring_bills (paused_by);

-- The default split, pre-filled when a period is recorded: who shares it, and
-- their percentage (percentage splits) or amount (custom splits). Equal
-- splits store neither.
create table public.recurring_bill_shares (
  bill_id uuid not null,
  household_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete restrict,
  percentage_bp integer
    constraint recurring_bill_shares_percentage_range check (percentage_bp between 0 and 10000),
  share_minor bigint
    constraint recurring_bill_shares_share_non_negative check (share_minor >= 0),
  primary key (bill_id, user_id),
  constraint recurring_bill_shares_bill_fkey
    foreign key (bill_id, household_id)
    references public.recurring_bills (id, household_id) on delete cascade
);

comment on table public.recurring_bill_shares is
  'A recurring bill''s default split. Active members read; written with the bill.';

create index recurring_bill_shares_user_id_idx on public.recurring_bill_shares (user_id);

-- ---------------------------------------------------------------------------
-- bill_occurrences: periods that something has happened to
-- ---------------------------------------------------------------------------

create table public.bill_occurrences (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null,
  household_id uuid not null,
  due_on date not null,
  -- The bill's expected amount when the period was stored. Editing the bill
  -- changes later periods only.
  expected_amount_minor bigint not null
    constraint bill_occurrences_amount_range check (expected_amount_minor between 1 and 999999999999),
  skipped_at timestamptz,
  skipped_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint bill_occurrences_skipped_together check ((skipped_at is null) = (skipped_by is null)),
  constraint bill_occurrences_one_per_due_date unique (bill_id, due_on),
  -- Target of the expenses foreign key, which carries the household too.
  constraint bill_occurrences_bill_due_household_key unique (bill_id, due_on, household_id),
  constraint bill_occurrences_bill_fkey
    foreign key (bill_id, household_id)
    references public.recurring_bills (id, household_id) on delete cascade
);

comment on table public.bill_occurrences is
  'Stored periods of recurring bills. Active members read; only the bill functions write.';

create index bill_occurrences_household_id_due_on_idx
  on public.bill_occurrences (household_id, due_on);
create index bill_occurrences_skipped_by_idx on public.bill_occurrences (skipped_by);

-- A stored period keeps its bill, date and expected amount for good. The only
-- change is skipping it or undoing that; the only removal is the cascade from
-- deleting the household itself (D14).
create function private.protect_bill_occurrences()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.households where id = old.household_id) then
      return old;
    end if;
    raise exception 'Bill periods are never deleted' using errcode = '42501';
  end if;

  if (new.id, new.bill_id, new.household_id, new.due_on, new.expected_amount_minor, new.created_at)
    is not distinct from
     (old.id, old.bill_id, old.household_id, old.due_on, old.expected_amount_minor, old.created_at)
  then
    return new;
  end if;
  raise exception 'A bill period can only be skipped or un-skipped' using errcode = '42501';
end;
$$;

create trigger bill_occurrences_protect
before update or delete on public.bill_occurrences
for each row execute function private.protect_bill_occurrences();

-- ---------------------------------------------------------------------------
-- expenses: the period an expense pays (D10)
-- ---------------------------------------------------------------------------

alter table public.expenses
  add column recurring_bill_id uuid,
  add column recurrence_period date;

comment on column public.expenses.recurring_bill_id is
  'The recurring bill this expense records a period of (D10). Set only by record_bill_payment.';
comment on column public.expenses.recurrence_period is
  'The due date of the period it records.';

alter table public.expenses
  add constraint expenses_bill_link_together
    check ((recurring_bill_id is null) = (recurrence_period is null)),
  -- A real, stored period of a bill in the expense's own household.
  add constraint expenses_bill_occurrence_fkey
    foreign key (recurring_bill_id, recurrence_period, household_id)
    references public.bill_occurrences (bill_id, due_on, household_id);

-- D10: one counted expense per bill per period. A deleted one (D7) doesn't
-- count, so the period can be recorded again.
create unique index expenses_one_per_bill_period
  on public.expenses (recurring_bill_id, recurrence_period)
  where recurring_bill_id is not null and deleted_at is null;
create index expenses_recurring_bill_idx
  on public.expenses (recurring_bill_id, recurrence_period)
  where recurring_bill_id is not null;

-- ---------------------------------------------------------------------------
-- Dates
-- ---------------------------------------------------------------------------

-- Period k (from 0) of a schedule. Always from the anchor: Postgres adds months
-- and years by clamping to the end of a shorter month, and since each period
-- starts again from the anchor, the 31st comes back after a short month.
create function private.bill_due_date(
  anchor date,
  unit public.bill_frequency,
  every integer,
  k integer
)
returns date
language sql
immutable
set search_path = ''
as $$
  select case unit
    when 'week' then anchor + 7 * every * k
    when 'month' then (anchor + make_interval(months => every * k))::date
    else (anchor + make_interval(years => every * k))::date
  end;
$$;

-- Today in the household's timezone (D11).
create function private.household_today(target_household_id uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone h.timezone)::date
  from public.households h
  where h.id = target_household_id;
$$;

-- The bill's periods that aren't stored yet and can be shown: each one due on
-- or before today (still open, since nothing has happened to it), then the
-- next one after today (upcoming), within the end date. None while paused.
-- At most `max_rows` (a bill nobody has touched for years stays bounded).
create function private.bill_periods_ahead(
  b public.recurring_bills,
  today date,
  max_rows integer default 500
)
returns table (due_on date, is_upcoming boolean)
language plpgsql
stable
set search_path = ''
as $$
declare
  k integer := b.next_index;
  d date;
  n integer := 0;
begin
  if b.paused_at is not null then
    return;
  end if;
  loop
    d := private.bill_due_date(b.anchor_on, b.frequency, b.interval_count, k);
    exit when b.ends_on is not null and d > b.ends_on;
    due_on := d;
    is_upcoming := d > today;
    return next;
    exit when d > today;
    n := n + 1;
    exit when n >= max_rows;
    k := k + 1;
  end loop;
end;
$$;

-- True while the bill has a period to come after today: not paused, and its
-- schedule not past its end date. A bill without one has ended (the app says
-- so the same way, src/lib/bills/board.ts).
create function private.bill_has_next(b public.recurring_bills, today date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from private.bill_periods_ahead(b, today) a where a.is_upcoming
  );
$$;

-- ---------------------------------------------------------------------------
-- Helpers for the bill functions (SECURITY DEFINER, ADR-006)
-- ---------------------------------------------------------------------------

-- Locks a bill the caller can see, or raises HJ018 (also for other
-- households' bills).
create function private.lock_bill(target_bill_id uuid)
returns public.recurring_bills
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  b public.recurring_bills%rowtype;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into b from public.recurring_bills rb where rb.id = target_bill_id for update;
  if not found or not private.is_active_member(b.household_id, caller) then
    raise exception 'No such bill' using errcode = 'HJ018';
  end if;
  return b;
end;
$$;

-- D27 (proposed): the person who added it, the person who usually pays, or
-- the owner.
create function private.can_manage_bill(b public.recurring_bills)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select b.created_by = (select auth.uid())
    or b.payer_id = (select auth.uid())
    or private.household_role(b.household_id) = 'owner';
$$;

-- Stores the bill's periods from its cursor through `through` (inclusive),
-- within its end date, and moves the cursor past them. Nothing while paused.
-- The caller holds the bill's row lock. Bounded: HJ019 rather than an endless
-- loop.
create function private.store_bill_periods(target_bill_id uuid, through date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.recurring_bills%rowtype;
  k integer;
  d date;
begin
  select * into b from public.recurring_bills rb where rb.id = target_bill_id;
  if b.paused_at is not null then
    return;
  end if;
  k := b.next_index;
  loop
    d := private.bill_due_date(b.anchor_on, b.frequency, b.interval_count, k);
    exit when d > through or (b.ends_on is not null and d > b.ends_on);
    if k - b.next_index >= 2000 then
      raise exception 'Too many periods at once' using errcode = 'HJ019';
    end if;
    insert into public.bill_occurrences (bill_id, household_id, due_on, expected_amount_minor)
    values (b.id, b.household_id, d, b.amount_minor)
    on conflict (bill_id, due_on) do nothing;
    k := k + 1;
  end loop;
  if k <> b.next_index then
    update public.recurring_bills rb set next_index = k where rb.id = b.id;
  end if;
end;
$$;

-- The period of the bill due on `due`: the stored one, or, from the cursor, a
-- period due on or before today or the first one after today (an early
-- payment). Stores it and every period before it. HJ024 for anything else: a
-- date the schedule doesn't have, a period further ahead, or a new period
-- while the bill is paused.
create function private.bill_period(target_bill_id uuid, due date)
returns public.bill_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.recurring_bills%rowtype;
  o public.bill_occurrences%rowtype;
  today date;
  k integer;
  d date;
begin
  select * into o from public.bill_occurrences bo where bo.bill_id = target_bill_id and bo.due_on = due;
  if found then
    return o;
  end if;

  select * into b from public.recurring_bills rb where rb.id = target_bill_id;
  if b.paused_at is null and due is not null then
    today := private.household_today(b.household_id);
    k := b.next_index;
    loop
      d := private.bill_due_date(b.anchor_on, b.frequency, b.interval_count, k);
      exit when d > due or (b.ends_on is not null and d > b.ends_on) or k - b.next_index > 2000;
      if d = due then
        perform private.store_bill_periods(b.id, due);
        select * into o from public.bill_occurrences bo where bo.bill_id = target_bill_id and bo.due_on = due;
        return o;
      end if;
      -- Only the first period after today can be acted on early.
      exit when d > today;
      k := k + 1;
    end loop;
  end if;
  raise exception 'That isn''t a period of this bill that can be recorded or skipped'
    using errcode = 'HJ024';
end;
$$;

-- True when a counted (not deleted) expense records this period.
create function private.bill_period_recorded(target_bill_id uuid, due date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.expenses x
    where x.recurring_bill_id = target_bill_id
      and x.recurrence_period = due
      and x.deleted_at is null
  );
$$;

-- Replaces the default split from [{user_id, share_minor, percentage_bp}]
-- (the shape create_expense takes), keeping what the method uses. Everyone
-- must be an active member (HJ007); percentages total 100% and custom amounts
-- the expected amount (HJ008).
create function private.write_bill_shares(
  target_bill_id uuid,
  target_household_id uuid,
  method public.split_method,
  amount bigint,
  shares jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  missing integer;
  total numeric;
begin
  if shares is null or jsonb_typeof(shares) <> 'array' or jsonb_array_length(shares) = 0 then
    raise exception 'Choose at least one participant' using errcode = 'HJ008';
  end if;

  delete from public.recurring_bill_shares s where s.bill_id = target_bill_id;
  begin
    insert into public.recurring_bill_shares (bill_id, household_id, user_id, share_minor, percentage_bp)
    select
      target_bill_id,
      target_household_id,
      (item ->> 'user_id')::uuid,
      case when method = 'custom' then (item ->> 'share_minor')::bigint end,
      case when method = 'percentage' then (item ->> 'percentage_bp')::integer end
    from jsonb_array_elements(shares) as item;
  exception
    when unique_violation or invalid_text_representation or numeric_value_out_of_range
      or not_null_violation or check_violation or null_value_not_allowed then
      raise exception 'The split is not valid' using errcode = 'HJ008';
  end;

  if exists (
    select 1 from public.recurring_bill_shares s
    where s.bill_id = target_bill_id
      and not private.is_active_member(target_household_id, s.user_id)
  ) then
    raise exception 'Everyone in the split must be an active member' using errcode = 'HJ007';
  end if;

  if method = 'percentage' then
    select count(*) filter (where s.percentage_bp is null), coalesce(sum(s.percentage_bp), 0)
    into missing, total
    from public.recurring_bill_shares s where s.bill_id = target_bill_id;
    if missing > 0 or total <> 10000 then
      raise exception 'Percentages must total 100%%' using errcode = 'HJ008';
    end if;
  elsif method = 'custom' then
    select count(*) filter (where s.share_minor is null), coalesce(sum(s.share_minor), 0)
    into missing, total
    from public.recurring_bill_shares s where s.bill_id = target_bill_id;
    if missing > 0 or total <> amount then
      raise exception 'Amounts must add up to the expected amount' using errcode = 'HJ008';
    end if;
  end if;
end;
$$;

-- The bill as JSON for the journal: what it is and its schedule. Notes stay
-- out.
create function private.bill_snapshot(target_bill_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'description', b.description,
    'amount_minor', b.amount_minor,
    'category', b.category,
    'payer_id', b.payer_id,
    'split_method', b.split_method,
    'frequency', b.frequency,
    'interval_count', b.interval_count,
    'anchor_on', b.anchor_on,
    'ends_on', b.ends_on
  )
  from public.recurring_bills b
  where b.id = target_bill_id;
$$;

-- ---------------------------------------------------------------------------
-- create_recurring_bill: any active member (D27)
-- ---------------------------------------------------------------------------

create function public.create_recurring_bill(
  target_household_id uuid,
  title text,
  amount bigint,
  bill_category public.expense_category,
  bill_payer_id uuid,
  method public.split_method,
  shares jsonb,
  repeat_unit public.bill_frequency,
  repeat_every integer,
  first_due_on date,
  last_due_on date default null,
  memo text default null,
  request_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  new_bill_id uuid;
  today date;
begin
  if caller is null or not private.is_active_member(target_household_id, caller) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  if request_key is not null then
    select rb.id into new_bill_id
    from public.recurring_bills rb
    where rb.created_by = caller and rb.creation_key = request_key;
    if found then
      return new_bill_id;
    end if;
  end if;

  if not private.is_active_member(target_household_id, bill_payer_id) then
    raise exception 'Who usually pays must be an active member' using errcode = 'HJ007';
  end if;
  -- A first due date within the past year (so catching up stays small) and
  -- the next ten; an end on or after it.
  today := private.household_today(target_household_id);
  if first_due_on is null
    or first_due_on < today - 366
    or first_due_on > today + 3660
    or last_due_on < first_due_on
  then
    raise exception 'The schedule isn''t valid' using errcode = 'HJ019';
  end if;

  begin
    insert into public.recurring_bills (
      household_id, description, notes, amount_minor, category, payer_id,
      split_method, frequency, interval_count, anchor_on, ends_on,
      created_by, creation_key
    )
    values (
      target_household_id, title, memo, amount, bill_category, bill_payer_id,
      method, repeat_unit, repeat_every, first_due_on, last_due_on,
      caller, request_key
    )
    returning id into new_bill_id;
  exception when unique_violation then
    -- A concurrent request with the same key won the race.
    select rb.id into strict new_bill_id
    from public.recurring_bills rb
    where rb.created_by = caller and rb.creation_key = request_key;
    return new_bill_id;
  end;

  perform private.write_bill_shares(new_bill_id, target_household_id, method, amount, shares);

  perform private.record_activity(
    target_household_id, 'bill_created', 'recurring_bill', new_bill_id,
    jsonb_build_object('after', private.bill_snapshot(new_bill_id))
  );
  return new_bill_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Changing a bill (D10: edits apply to future periods only). Two functions,
-- so an edit of the details can never move the schedule by accident.
-- ---------------------------------------------------------------------------

-- Locks the bill for a change by someone allowed to make it (D27), checks it
-- hasn't changed since the form loaded (HJ020), and stores every period that
-- has already come, under the schedule and amount it came with.
create function private.prepare_bill_change(
  target_bill_id uuid,
  expected_updated_at timestamptz
)
returns public.recurring_bills
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.recurring_bills%rowtype;
begin
  b := private.lock_bill(target_bill_id);
  if not private.can_manage_bill(b) then
    raise exception 'Only the person who added it, who usually pays it or the owner can change this bill'
      using errcode = '42501';
  end if;
  if expected_updated_at is not null and b.updated_at <> expected_updated_at then
    raise exception 'The bill changed since it was loaded' using errcode = 'HJ020';
  end if;
  perform private.store_bill_periods(b.id, private.household_today(b.household_id));
  select * into b from public.recurring_bills rb where rb.id = target_bill_id;
  return b;
end;
$$;

-- What the bill is, how much, who usually pays, the default split, the notes
-- and the end date. Later periods are recorded with the new values; stored
-- periods keep the amount they came with. The end date can't be before a
-- stored period.
create function public.update_recurring_bill(
  target_bill_id uuid,
  title text,
  amount bigint,
  bill_category public.expense_category,
  bill_payer_id uuid,
  method public.split_method,
  shares jsonb,
  last_due_on date default null,
  memo text default null,
  expected_updated_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.recurring_bills%rowtype;
  latest date;
  before_values jsonb;
  after_values jsonb;
begin
  b := private.prepare_bill_change(target_bill_id, expected_updated_at);
  if not private.is_active_member(b.household_id, bill_payer_id) then
    raise exception 'Who usually pays must be an active member' using errcode = 'HJ007';
  end if;
  select max(bo.due_on) into latest from public.bill_occurrences bo where bo.bill_id = b.id;
  if last_due_on < latest then
    raise exception 'The end date can''t be before a period that has already come'
      using errcode = 'HJ019';
  end if;

  before_values := private.bill_snapshot(b.id);
  update public.recurring_bills rb
  set description = title,
      notes = memo,
      amount_minor = amount,
      category = bill_category,
      payer_id = bill_payer_id,
      split_method = method,
      ends_on = last_due_on,
      updated_at = now()
  where rb.id = b.id;
  perform private.write_bill_shares(b.id, b.household_id, method, amount, shares);

  after_values := private.bill_snapshot(b.id);
  if after_values is distinct from before_values then
    perform private.record_activity(
      b.household_id, 'bill_updated', 'recurring_bill', b.id,
      jsonb_build_object('before', before_values, 'after', after_values)
    );
  end if;
end;
$$;

-- A new schedule from `next_due_on` on: today or later, after every stored
-- period, and not after the end date. Stored periods keep their dates.
create function public.reschedule_recurring_bill(
  target_bill_id uuid,
  repeat_unit public.bill_frequency,
  repeat_every integer,
  next_due_on date,
  expected_updated_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.recurring_bills%rowtype;
  today date;
  latest date;
  before_values jsonb;
begin
  b := private.prepare_bill_change(target_bill_id, expected_updated_at);
  today := private.household_today(b.household_id);
  select max(bo.due_on) into latest from public.bill_occurrences bo where bo.bill_id = b.id;
  if next_due_on is null
    or next_due_on < today
    or next_due_on > today + 3660
    or next_due_on <= latest
    or next_due_on > b.ends_on
  then
    raise exception 'The new schedule must start today or later, after every period so far'
      using errcode = 'HJ019';
  end if;

  before_values := private.bill_snapshot(b.id);
  update public.recurring_bills rb
  set frequency = repeat_unit,
      interval_count = repeat_every,
      anchor_on = next_due_on,
      next_index = 0,
      updated_at = now()
  where rb.id = b.id;

  perform private.record_activity(
    b.household_id, 'bill_updated', 'recurring_bill', b.id,
    jsonb_build_object('before', before_values, 'after', private.bill_snapshot(b.id))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Pause, resume, end (D10: disabling stops future reminders)
-- ---------------------------------------------------------------------------

-- Periods that have already come are stored (they stay open until recorded
-- or skipped); no new period comes while it's paused.
create function public.pause_recurring_bill(target_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.recurring_bills%rowtype;
  today date;
begin
  b := private.lock_bill(target_bill_id);
  if not private.can_manage_bill(b) then
    raise exception 'Only the person who added it, who usually pays it or the owner can pause this bill'
      using errcode = '42501';
  end if;
  today := private.household_today(b.household_id);
  if b.paused_at is not null or not private.bill_has_next(b, today) then
    raise exception 'The bill is already paused or ended' using errcode = 'HJ021';
  end if;

  perform private.store_bill_periods(b.id, today);
  update public.recurring_bills rb
  set paused_at = now(), paused_by = (select auth.uid()), updated_at = now()
  where rb.id = b.id;

  perform private.record_activity(
    b.household_id, 'bill_paused', 'recurring_bill', b.id,
    jsonb_build_object('description', b.description)
  );
end;
$$;

-- The next period is the first one on the schedule from today: the periods
-- that fell while it was paused never come.
create function public.resume_recurring_bill(target_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.recurring_bills%rowtype;
  today date;
  k integer;
begin
  b := private.lock_bill(target_bill_id);
  if not private.can_manage_bill(b) then
    raise exception 'Only the person who added it, who usually pays it or the owner can resume this bill'
      using errcode = '42501';
  end if;
  if b.paused_at is null then
    raise exception 'The bill isn''t paused' using errcode = 'HJ021';
  end if;

  today := private.household_today(b.household_id);
  k := b.next_index;
  while private.bill_due_date(b.anchor_on, b.frequency, b.interval_count, k) < today loop
    k := k + 1;
    if k - b.next_index > 100000 then
      raise exception 'The schedule can''t be resumed' using errcode = 'HJ019';
    end if;
  end loop;

  update public.recurring_bills rb
  set paused_at = null, paused_by = null, next_index = k, updated_at = now()
  where rb.id = b.id;

  perform private.record_activity(
    b.household_id, 'bill_resumed', 'recurring_bill', b.id,
    jsonb_build_object('description', b.description)
  );
end;
$$;

-- No period after today (or after one already recorded early). Periods that
-- have come stay, open until recorded or skipped.
create function public.end_recurring_bill(target_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.recurring_bills%rowtype;
  today date;
  latest date;
begin
  b := private.lock_bill(target_bill_id);
  if not private.can_manage_bill(b) then
    raise exception 'Only the person who added it, who usually pays it or the owner can end this bill'
      using errcode = '42501';
  end if;
  today := private.household_today(b.household_id);
  if b.ends_on <= today then
    raise exception 'The bill has already ended' using errcode = 'HJ021';
  end if;

  perform private.store_bill_periods(b.id, today);
  select max(bo.due_on) into latest from public.bill_occurrences bo where bo.bill_id = b.id;
  update public.recurring_bills rb
  set ends_on = greatest(today, latest), updated_at = now()
  where rb.id = b.id;

  perform private.record_activity(
    b.household_id, 'bill_ended', 'recurring_bill', b.id,
    jsonb_build_object('description', b.description, 'ends_on', greatest(today, latest))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Skipping a period (D27, proposed): no expense, not paid, can be undone
-- ---------------------------------------------------------------------------

create function public.skip_bill_occurrence(target_bill_id uuid, occurrence_due_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.recurring_bills%rowtype;
  o public.bill_occurrences%rowtype;
begin
  b := private.lock_bill(target_bill_id);
  if not private.can_manage_bill(b) then
    raise exception 'Only the person who added it, who usually pays it or the owner can skip a period'
      using errcode = '42501';
  end if;
  o := private.bill_period(b.id, occurrence_due_on);
  if private.bill_period_recorded(b.id, o.due_on) then
    raise exception 'That period is already recorded' using errcode = 'HJ022';
  end if;
  if o.skipped_at is not null then
    raise exception 'That period is already skipped' using errcode = 'HJ023';
  end if;

  update public.bill_occurrences bo
  set skipped_at = now(), skipped_by = (select auth.uid())
  where bo.id = o.id;

  perform private.record_activity(
    b.household_id, 'bill_skipped', 'recurring_bill', b.id,
    jsonb_build_object('description', b.description, 'due_on', o.due_on)
  );
end;
$$;

create function public.unskip_bill_occurrence(target_bill_id uuid, occurrence_due_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.recurring_bills%rowtype;
  o public.bill_occurrences%rowtype;
begin
  b := private.lock_bill(target_bill_id);
  if not private.can_manage_bill(b) then
    raise exception 'Only the person who added it, who usually pays it or the owner can undo a skip'
      using errcode = '42501';
  end if;
  select * into o from public.bill_occurrences bo
  where bo.bill_id = b.id and bo.due_on = occurrence_due_on;
  if not found then
    raise exception 'No such period' using errcode = 'HJ024';
  end if;
  if o.skipped_at is null then
    raise exception 'That period isn''t skipped' using errcode = 'HJ023';
  end if;

  update public.bill_occurrences bo
  set skipped_at = null, skipped_by = null
  where bo.id = o.id;

  perform private.record_activity(
    b.household_id, 'bill_unskipped', 'recurring_bill', b.id,
    jsonb_build_object('description', b.description, 'due_on', o.due_on)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- record_bill_payment: "Record this bill" (D10, ADR-010)
-- ---------------------------------------------------------------------------

-- Records one period of a bill as an expense, through create_expense (any
-- active member, D6's checks, the split engine's invariants, expense_created
-- in the journal), and links it to the period, all in one transaction. The
-- household is the bill's, never an argument. A repeated request_key returns
-- the expense it recorded; a period that's recorded (HJ022) or skipped (HJ023)
-- is refused; two people recording the same period at once queue on the
-- bill's row lock, and the unique index is the last word.
create function public.record_bill_payment(
  target_bill_id uuid,
  occurrence_due_on date,
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
  b public.recurring_bills%rowtype;
  o public.bill_occurrences%rowtype;
  new_expense_id uuid;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if request_key is not null then
    select x.id into new_expense_id
    from public.expenses x
    where x.created_by = caller and x.creation_key = request_key;
    if found then
      return new_expense_id;
    end if;
  end if;

  b := private.lock_bill(target_bill_id);
  o := private.bill_period(b.id, occurrence_due_on);
  if o.skipped_at is not null then
    raise exception 'That period is skipped' using errcode = 'HJ023';
  end if;
  if private.bill_period_recorded(b.id, o.due_on) then
    raise exception 'That period is already recorded' using errcode = 'HJ022';
  end if;

  new_expense_id := public.create_expense(
    b.household_id, title, amount, expense_category, spent_on, payer_id,
    method, shares, request_key
  );
  begin
    update public.expenses x
    set recurring_bill_id = b.id, recurrence_period = o.due_on
    where x.id = new_expense_id;
  exception when unique_violation then
    raise exception 'That period is already recorded' using errcode = 'HJ022';
  end;
  return new_expense_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- restore_expense (D7): as in Phase 8, plus HJ025 for a bill period that was
-- recorded again or skipped since the expense was deleted
-- ---------------------------------------------------------------------------

create or replace function public.restore_expense(target_expense_id uuid)
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
  if e.recurring_bill_id is not null and (
    private.bill_period_recorded(e.recurring_bill_id, e.recurrence_period)
    or exists (
      select 1 from public.bill_occurrences bo
      where bo.bill_id = e.recurring_bill_id
        and bo.due_on = e.recurrence_period
        and bo.skipped_at is not null
    )
  ) then
    raise exception 'That bill period was recorded again or skipped' using errcode = 'HJ025';
  end if;

  update public.expenses set deleted_at = null, deleted_by = null where id = e.id;

  perform private.record_activity(
    e.household_id, 'expense_restored', 'expense', e.id,
    jsonb_build_object('after', private.expense_snapshot(e.id))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads (security invoker, stable: RLS applies, one snapshot). Money as text.
-- ---------------------------------------------------------------------------

-- household_bills: everything the bills page shows.
--   today          the household's date (D11)
--   bills          [{ bill_id, household_id, description, amount_minor,
--                     category, payer_id, frequency, interval_count, ends_on,
--                     paused, created_by, next_due_on }]
--                  next_due_on: the next period after today, or null (paused,
--                  or no period left before the end date)
--   open           [{ bill_id, due_on, expected_amount_minor, stored }]
--                  periods due on or before today (and any stored later one)
--                  that are neither recorded nor skipped, oldest first
--   paid_recently  [{ bill_id, due_on, expense_id, amount_minor,
--                     expense_date, paid_by }]
--                  periods whose expense is dated in the last 30 days
--   people         [{ user_id, display_name, is_active }]
create function public.household_bills(target_household_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  today date;
  result jsonb;
begin
  if (select auth.uid()) is null or not private.is_household_member(target_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  today := private.household_today(target_household_id);

  with bills as (
    select b.* from public.recurring_bills b where b.household_id = target_household_id
  ),
  ahead as materialized (
    select b.id as bill_id, b.amount_minor, a.due_on, a.is_upcoming
    from public.recurring_bills b
    cross join lateral private.bill_periods_ahead(b, today) a
    where b.household_id = target_household_id
  ),
  stored as materialized (
    select
      o.bill_id,
      o.due_on,
      o.expected_amount_minor,
      o.skipped_at,
      x.id as expense_id,
      x.amount_minor as expense_amount_minor,
      x.expense_date,
      x.paid_by
    from public.bill_occurrences o
    left join public.expenses x
      on x.recurring_bill_id = o.bill_id
     and x.recurrence_period = o.due_on
     and x.deleted_at is null
    where o.household_id = target_household_id
  ),
  open_periods as (
    select s.bill_id, s.due_on, s.expected_amount_minor, true as is_stored
    from stored s
    where s.expense_id is null and s.skipped_at is null
    union all
    select a.bill_id, a.due_on, a.amount_minor, false
    from ahead a
    where not a.is_upcoming
  ),
  paid as (
    select s.* from stored s
    where s.expense_id is not null and s.expense_date >= today - 30
  ),
  mentioned as (
    select b.payer_id as user_id from bills b
    union select b.created_by from bills b
    union select p.paid_by from paid p
  )
  select jsonb_build_object(
    'today', today,
    'bills', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'bill_id', b.id,
          'household_id', b.household_id,
          'description', b.description,
          'amount_minor', b.amount_minor::text,
          'category', b.category,
          'payer_id', b.payer_id,
          'frequency', b.frequency,
          'interval_count', b.interval_count,
          'ends_on', b.ends_on,
          'paused', b.paused_at is not null,
          'created_by', b.created_by,
          'next_due_on', (
            select a.due_on from ahead a where a.bill_id = b.id and a.is_upcoming
          )
        )
        order by b.description, b.id
      )
      from bills b
    ), '[]'::jsonb),
    'open', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'bill_id', p.bill_id,
          'due_on', p.due_on,
          'expected_amount_minor', p.expected_amount_minor::text,
          'stored', p.is_stored
        )
        order by p.due_on, p.bill_id
      )
      from open_periods p
    ), '[]'::jsonb),
    'paid_recently', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'bill_id', p.bill_id,
          'due_on', p.due_on,
          'expense_id', p.expense_id,
          'amount_minor', p.expense_amount_minor::text,
          'expense_date', p.expense_date,
          'paid_by', p.paid_by
        )
        order by p.expense_date desc, p.due_on desc, p.bill_id
      )
      from paid p
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', pr.id,
          'display_name', pr.display_name,
          'is_active', exists (
            select 1 from public.household_members hm
            where hm.household_id = target_household_id
              and hm.user_id = pr.id
              and hm.left_at is null
          )
        )
        order by pr.id
      )
      from public.profiles pr
      where pr.id in (select m.user_id from mentioned m)
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

-- recurring_bill: one bill with its periods, newest first. HJ018 for a bill
-- the caller can't see.
--   today, bill { …household_bills' fields…, notes, anchor_on, split_method,
--                 paused_at, paused_by, created_at, updated_at,
--                 cursor_due_on, latest_stored_due_on }
--   shares     [{ user_id, percentage_bp, share_minor }]
--   periods    [{ due_on, stored, expected_amount_minor,
--                 status: upcoming | open | recorded | skipped,
--                 expense: { expense_id, amount_minor, expense_date, paid_by }
--                   | null,
--                 deleted_expense_count, skipped_at, skipped_by }]
--              the next period, the open ones that haven't been stored, and
--              the newest 200 stored
--   stored_count   how many periods are stored
--   people
create function public.recurring_bill(target_bill_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  b public.recurring_bills%rowtype;
  today date;
  result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into b from public.recurring_bills rb where rb.id = target_bill_id;
  if not found or not private.is_household_member(b.household_id) then
    raise exception 'No such bill' using errcode = 'HJ018';
  end if;
  today := private.household_today(b.household_id);

  with ahead as materialized (
    select a.due_on, a.is_upcoming from private.bill_periods_ahead(b, today) a
  ),
  stored as materialized (
    select
      o.due_on,
      o.expected_amount_minor,
      o.skipped_at,
      o.skipped_by,
      x.id as expense_id,
      x.amount_minor as expense_amount_minor,
      x.expense_date,
      x.paid_by,
      (
        select count(*) from public.expenses d
        where d.recurring_bill_id = o.bill_id
          and d.recurrence_period = o.due_on
          and d.deleted_at is not null
      ) as deleted_expense_count
    from public.bill_occurrences o
    left join public.expenses x
      on x.recurring_bill_id = o.bill_id
     and x.recurrence_period = o.due_on
     and x.deleted_at is null
    where o.bill_id = b.id
    order by o.due_on desc
    limit 200
  ),
  periods as (
    select
      a.due_on,
      false as is_stored,
      b.amount_minor as expected_amount_minor,
      case when a.is_upcoming then 'upcoming' else 'open' end as status,
      null::uuid as expense_id,
      null::bigint as expense_amount_minor,
      null::date as expense_date,
      null::uuid as paid_by,
      0::bigint as deleted_expense_count,
      null::timestamptz as skipped_at,
      null::uuid as skipped_by
    from ahead a
    union all
    select
      s.due_on,
      true,
      s.expected_amount_minor,
      case
        when s.expense_id is not null then 'recorded'
        when s.skipped_at is not null then 'skipped'
        when s.due_on > today then 'upcoming'
        else 'open'
      end,
      s.expense_id,
      s.expense_amount_minor,
      s.expense_date,
      s.paid_by,
      s.deleted_expense_count,
      s.skipped_at,
      s.skipped_by
    from stored s
  ),
  mentioned as (
    select b.payer_id as user_id
    union select b.created_by
    union select b.paused_by
    union select sh.user_id from public.recurring_bill_shares sh where sh.bill_id = b.id
    union select p.paid_by from periods p
    union select p.skipped_by from periods p
  )
  select jsonb_build_object(
    'today', today,
    'bill', jsonb_build_object(
      'bill_id', b.id,
      'household_id', b.household_id,
      'description', b.description,
      'notes', b.notes,
      'amount_minor', b.amount_minor::text,
      'category', b.category,
      'payer_id', b.payer_id,
      'split_method', b.split_method,
      'frequency', b.frequency,
      'interval_count', b.interval_count,
      'anchor_on', b.anchor_on,
      'ends_on', b.ends_on,
      'paused', b.paused_at is not null,
      'paused_at', b.paused_at,
      'paused_by', b.paused_by,
      'created_by', b.created_by,
      'created_at', b.created_at,
      'updated_at', b.updated_at,
      'next_due_on', (select a.due_on from ahead a where a.is_upcoming),
      'cursor_due_on', private.bill_due_date(b.anchor_on, b.frequency, b.interval_count, b.next_index),
      'latest_stored_due_on', (
        select max(o.due_on) from public.bill_occurrences o where o.bill_id = b.id
      )
    ),
    'shares', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', sh.user_id,
          'percentage_bp', sh.percentage_bp,
          'share_minor', sh.share_minor::text
        )
        order by sh.user_id
      )
      from public.recurring_bill_shares sh
      where sh.bill_id = b.id
    ), '[]'::jsonb),
    'periods', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'due_on', p.due_on,
          'stored', p.is_stored,
          'expected_amount_minor', p.expected_amount_minor::text,
          'status', p.status,
          'expense', case when p.expense_id is not null then jsonb_build_object(
            'expense_id', p.expense_id,
            'amount_minor', p.expense_amount_minor::text,
            'expense_date', p.expense_date,
            'paid_by', p.paid_by
          ) end,
          'deleted_expense_count', p.deleted_expense_count,
          'skipped_at', p.skipped_at,
          'skipped_by', p.skipped_by
        )
        order by p.due_on desc
      )
      from periods p
    ), '[]'::jsonb),
    'stored_count', (select count(*) from public.bill_occurrences o where o.bill_id = b.id),
    'people', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', pr.id,
          'display_name', pr.display_name,
          'is_active', exists (
            select 1 from public.household_members hm
            where hm.household_id = b.household_id
              and hm.user_id = pr.id
              and hm.left_at is null
          )
        )
        order by pr.id
      )
      from public.profiles pr
      where pr.id in (select m.user_id from mentioned m where m.user_id is not null)
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- The household journal (roadmap Phase 13) shows the bills' events
-- ---------------------------------------------------------------------------

-- A bill, from private.bill_snapshot: what the journal shows of it.
create function private.journal_bill(snapshot jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'description', snapshot ->> 'description',
    'amount_minor', snapshot ->> 'amount_minor',
    'category', snapshot ->> 'category',
    'payer_id', snapshot ->> 'payer_id',
    'frequency', snapshot ->> 'frequency',
    'interval_count', (snapshot ->> 'interval_count')::integer,
    'anchor_on', snapshot ->> 'anchor_on',
    'ends_on', snapshot ->> 'ends_on'
  );
$$;

-- Same signature, grants and behaviour as in 20261116120000, plus the seven
-- bill events (filter 'bills'), their fields, and for a bill entry the bill's
-- state now (active, paused or ended).
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
  shown_types public.activity_event_type[];
  cursor_at timestamptz;
  today date;
  result jsonb;
begin
  if (select auth.uid()) is null or not private.is_household_member(target_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if category_filter is not null
    and category_filter not in ('expenses', 'settlements', 'bills', 'household')
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
    when 'household' then household_types
    else household_types || expense_types || settlement_types || bill_types
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
    union select (e.detail -> 'before' ->> 'paid_by')::uuid from entries e
    union select (e.detail -> 'after' ->> 'paid_by')::uuid from entries e
    union select (e.detail -> 'before' ->> 'payer_id')::uuid from entries e
    union select (e.detail -> 'after' ->> 'payer_id')::uuid from entries e
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

alter table public.recurring_bills enable row level security;
alter table public.recurring_bill_shares enable row level security;
alter table public.bill_occurrences enable row level security;

create policy "Members read their household's recurring bills"
on public.recurring_bills for select to authenticated
using (private.is_household_member(household_id));

create policy "Members read their household's recurring bill shares"
on public.recurring_bill_shares for select to authenticated
using (private.is_household_member(household_id));

create policy "Members read their household's bill periods"
on public.bill_occurrences for select to authenticated
using (private.is_household_member(household_id));

revoke all on table public.recurring_bills, public.recurring_bill_shares, public.bill_occurrences
  from anon, authenticated;
grant all on table public.recurring_bills, public.recurring_bill_shares, public.bill_occurrences
  to service_role;
grant select on table public.recurring_bills, public.recurring_bill_shares, public.bill_occurrences
  to authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function private.protect_bill_occurrences() from public;
revoke all on function private.bill_due_date(date, public.bill_frequency, integer, integer) from public;
revoke all on function private.household_today(uuid) from public;
revoke all on function private.bill_periods_ahead(public.recurring_bills, date, integer) from public;
revoke all on function private.bill_has_next(public.recurring_bills, date) from public;
revoke all on function private.lock_bill(uuid) from public;
revoke all on function private.can_manage_bill(public.recurring_bills) from public;
revoke all on function private.store_bill_periods(uuid, date) from public;
revoke all on function private.bill_period(uuid, date) from public;
revoke all on function private.bill_period_recorded(uuid, date) from public;
revoke all on function private.write_bill_shares(uuid, uuid, public.split_method, bigint, jsonb) from public;
revoke all on function private.bill_snapshot(uuid) from public;
revoke all on function private.prepare_bill_change(uuid, timestamptz) from public;
revoke all on function private.journal_bill(jsonb) from public;
-- The read functions run as the caller, so the caller needs these. They read
-- no table (household_today reads the household under RLS), and the private
-- schema isn't exposed through the Data API.
grant execute on function private.bill_due_date(date, public.bill_frequency, integer, integer) to authenticated;
grant execute on function private.household_today(uuid) to authenticated;
grant execute on function private.bill_periods_ahead(public.recurring_bills, date, integer) to authenticated;
grant execute on function private.bill_has_next(public.recurring_bills, date) to authenticated;
grant execute on function private.journal_bill(jsonb) to authenticated;

revoke all on function public.create_recurring_bill(uuid, text, bigint, public.expense_category, uuid, public.split_method, jsonb, public.bill_frequency, integer, date, date, text, uuid) from public, anon;
revoke all on function public.update_recurring_bill(uuid, text, bigint, public.expense_category, uuid, public.split_method, jsonb, date, text, timestamptz) from public, anon;
revoke all on function public.reschedule_recurring_bill(uuid, public.bill_frequency, integer, date, timestamptz) from public, anon;
revoke all on function public.pause_recurring_bill(uuid) from public, anon;
revoke all on function public.resume_recurring_bill(uuid) from public, anon;
revoke all on function public.end_recurring_bill(uuid) from public, anon;
revoke all on function public.skip_bill_occurrence(uuid, date) from public, anon;
revoke all on function public.unskip_bill_occurrence(uuid, date) from public, anon;
revoke all on function public.record_bill_payment(uuid, date, text, bigint, public.expense_category, date, uuid, public.split_method, jsonb, uuid) from public, anon;
revoke all on function public.household_bills(uuid) from public, anon;
revoke all on function public.recurring_bill(uuid) from public, anon;

grant execute on function public.create_recurring_bill(uuid, text, bigint, public.expense_category, uuid, public.split_method, jsonb, public.bill_frequency, integer, date, date, text, uuid) to authenticated;
grant execute on function public.update_recurring_bill(uuid, text, bigint, public.expense_category, uuid, public.split_method, jsonb, date, text, timestamptz) to authenticated;
grant execute on function public.reschedule_recurring_bill(uuid, public.bill_frequency, integer, date, timestamptz) to authenticated;
grant execute on function public.pause_recurring_bill(uuid) to authenticated;
grant execute on function public.resume_recurring_bill(uuid) to authenticated;
grant execute on function public.end_recurring_bill(uuid) to authenticated;
grant execute on function public.skip_bill_occurrence(uuid, date) to authenticated;
grant execute on function public.unskip_bill_occurrence(uuid, date) to authenticated;
grant execute on function public.record_bill_payment(uuid, date, text, bigint, public.expense_category, date, uuid, public.split_method, jsonb, uuid) to authenticated;
grant execute on function public.household_bills(uuid) to authenticated;
grant execute on function public.recurring_bill(uuid) to authenticated;

-- create or replace keeps existing grants; restated for clarity.
revoke all on function public.restore_expense(uuid) from public, anon;
grant execute on function public.restore_expense(uuid) to authenticated;
revoke all on function public.household_journal(uuid, text, bigint, uuid, integer) from public, anon;
grant execute on function public.household_journal(uuid, text, bigint, uuid, integer) to authenticated;