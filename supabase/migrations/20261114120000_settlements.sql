-- Roadmap Phase 10 (the owner's brief calls it Phase 11): settlements.
--
-- A settlement is a record that one member paid another back outside the
-- app. The app never moves money and never checks that a payment happened
-- (knowledge base rule 2): "Recorded in the app — no money is moved."
--
-- Rules:
--   D9 / ADR-007  Recorded by hand, by the payer or the recipient only. Never
--                 edited: a mistake is voided (voided_at, voided_by) and
--                 recorded again. The payer, the recipient or the owner can
--                 void. Partial amounts are allowed; the app warns when the
--                 amount is more than what's currently owed (record_settlement
--                 refuses with HJ017 until the caller acknowledges the figure).
--   ADR-005       A settlement that isn't voided reduces what the payer owes
--                 the recipient. Net = paid − shares + settlements paid −
--                 settlements received. Still derived on every read, never
--                 stored.
--   D8            Settlements aren't linked to expenses. Expenses and their
--                 splits are never changed by a settlement.
--   D1            One currency per household. Settlement amounts are minor
--                 units of it, so a settlement locks the currency too.
--   D13, O8       Leaving or removal needs a zero balance, which now includes
--                 settlements (member_net_minor).
--   O9 (Open)     How a former member's balance is settled isn't decided, so
--                 both people in a new settlement must be active members.
--   ADR-006       Writes go through SECURITY DEFINER functions that check the
--                 caller from auth.uid() and write the journal; signed-in
--                 users have no direct write privileges on settlements.
--
-- Additive: one table, enum values, functions, triggers, policies and
-- grants. public.household_balances, private.member_net_minor and
-- private.lock_household_currency are replaced with the same signatures and
-- grants. No data changes.
--
-- New error codes (mapped in src/lib/households/errors.ts):
--   HJ014  no such settlement (also for other households' ids)
--   HJ015  the settlement is already voided
--   HJ016  the payer and the recipient must be two different active members
--   HJ017  the amount is more than the payer currently owes the recipient;
--          DETAIL carries what's owed now (signed minor units, as text)

-- ---------------------------------------------------------------------------
-- Journal types
-- ---------------------------------------------------------------------------

alter type public.activity_event_type add value 'settlement_recorded';
alter type public.activity_event_type add value 'settlement_voided';
alter type public.activity_entity_type add value 'settlement';

-- ---------------------------------------------------------------------------
-- settlements
-- ---------------------------------------------------------------------------

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- Who paid whom, outside the app (D9).
  from_user uuid not null references public.profiles (id) on delete restrict,
  to_user uuid not null references public.profiles (id) on delete restrict,
  -- Integer minor units in the household's currency (D1, D2), with the same
  -- bounds as an expense.
  amount_minor bigint not null
    constraint settlements_amount_range check (amount_minor between 1 and 999999999999),
  -- The day the money changed hands: a calendar date, not an instant (D11).
  settled_on date not null,
  note text
    constraint settlements_note_length
    check (note is null or (char_length(note) between 1 and 200 and note = btrim(note))),
  -- D9: only the payer or the recipient records a settlement.
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  -- Makes record_settlement idempotent for a repeated form submission.
  creation_key uuid,
  created_at timestamptz not null default now(),
  -- D9 / ADR-007: voided, never edited or deleted. Voided ones stay readable.
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  constraint settlements_two_people check (from_user <> to_user),
  constraint settlements_recorded_by_a_party check (recorded_by in (from_user, to_user)),
  constraint settlements_voided_together check ((voided_at is null) = (voided_by is null)),
  constraint settlements_voided_after_created check (voided_at is null or voided_at >= created_at)
);

comment on table public.settlements is
  'Payments members record making to each other outside the app. Active members read; writes go through record_settlement and void_settlement only.';

create unique index settlements_recorded_by_creation_key
  on public.settlements (recorded_by, creation_key)
  where creation_key is not null;
create index settlements_household_id_settled_on_idx
  on public.settlements (household_id, settled_on desc, created_at desc)
  where voided_at is null;
create index settlements_household_id_voided_at_idx
  on public.settlements (household_id, voided_at desc)
  where voided_at is not null;
create index settlements_from_user_idx on public.settlements (from_user);
create index settlements_to_user_idx on public.settlements (to_user);
create index settlements_recorded_by_idx on public.settlements (recorded_by);
create index settlements_voided_by_idx on public.settlements (voided_by);

-- Settlements are never edited and never deleted, for every role including
-- the service role. The only change allowed is voiding, once: voided_at and
-- voided_by go from null to set, and nothing else moves. The one exception is
-- the cascade from deleting the household itself (D14): by the time it
-- reaches these rows, the household row is already gone.
create function private.protect_settlements()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.households where id = old.household_id) then
      return old;
    end if;
    raise exception 'Settlements are never deleted; void them instead' using errcode = '42501';
  end if;

  if old.voided_at is null
    and new.voided_at is not null
    and new.voided_by is not null
    and (new.id, new.household_id, new.from_user, new.to_user, new.amount_minor,
         new.settled_on, new.note, new.recorded_by, new.creation_key, new.created_at)
      is not distinct from
        (old.id, old.household_id, old.from_user, old.to_user, old.amount_minor,
         old.settled_on, old.note, old.recorded_by, old.creation_key, old.created_at)
  then
    return new;
  end if;
  raise exception 'A settlement can''t be changed; void it and record it again' using errcode = '42501';
end;
$$;

create trigger settlements_protect
before update or delete on public.settlements
for each row execute function private.protect_settlements();

-- ---------------------------------------------------------------------------
-- D1: the currency is locked once the household has an expense or a
-- settlement (voided or deleted ones included: they keep their amounts).
-- Same trigger function as Phase 8, one more check.
-- ---------------------------------------------------------------------------

create or replace function private.lock_household_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.currency_code is distinct from old.currency_code
    and (
      exists (select 1 from public.expenses where household_id = new.id)
      or exists (select 1 from public.settlements where household_id = new.id)
    )
  then
    raise exception 'The currency is locked once the household has expenses or settlements'
      using errcode = 'HJ012';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Balances with settlements (ADR-005)
-- ---------------------------------------------------------------------------

-- Per person: the settlements they paid and received that aren't voided.
-- Runs as the caller, like balance_people.
create function private.settlement_people(target_household_id uuid)
returns table (
  user_id uuid,
  paid_minor numeric,
  received_minor numeric,
  paid_count bigint,
  received_count bigint
)
language sql
stable
set search_path = ''
as $$
  with counted as (
    select t.from_user, t.to_user, t.amount_minor
    from public.settlements t
    where t.household_id = target_household_id
      and t.voided_at is null
  ),
  paid as (
    select c.from_user as user_id, sum(c.amount_minor) as paid_minor, count(*) as paid_count
    from counted c
    group by c.from_user
  ),
  received as (
    select c.to_user as user_id, sum(c.amount_minor) as received_minor, count(*) as received_count
    from counted c
    group by c.to_user
  ),
  people as (
    select p.user_id from paid p
    union
    select r.user_id from received r
  )
  select
    people.user_id,
    coalesce(p.paid_minor, 0),
    coalesce(r.received_minor, 0),
    coalesce(p.paid_count, 0),
    coalesce(r.received_count, 0)
  from people
  left join paid p on p.user_id = people.user_id
  left join received r on r.user_id = people.user_id;
$$;

-- The one definition of a balance from roadmap Phase 10 on: what someone paid
-- for counted expenses minus their shares (balance_people), plus the
-- settlements they paid, minus the settlements they received. There's a row
-- for every active member, and for anyone else in a counted expense or
-- settlement (someone who has left), so the rows always cover every counted
-- amount and the nets add up to zero. Sums are numeric.
create function private.person_balances(target_household_id uuid)
returns table (
  user_id uuid,
  paid_minor numeric,
  share_minor numeric,
  paid_count bigint,
  share_count bigint,
  settlements_paid_minor numeric,
  settlements_received_minor numeric,
  settlements_paid_count bigint,
  settlements_received_count bigint,
  net_minor numeric
)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(b.user_id, s.user_id),
    coalesce(b.paid_minor, 0),
    coalesce(b.share_minor, 0),
    coalesce(b.paid_count, 0),
    coalesce(b.share_count, 0),
    coalesce(s.paid_minor, 0),
    coalesce(s.received_minor, 0),
    coalesce(s.paid_count, 0),
    coalesce(s.received_count, 0),
    coalesce(b.paid_minor, 0) - coalesce(b.share_minor, 0)
      + coalesce(s.paid_minor, 0) - coalesce(s.received_minor, 0)
  from private.balance_people(target_household_id) b
  full join private.settlement_people(target_household_id) s on s.user_id = b.user_id;
$$;

-- Who owes whom, the one definition: each participant in a counted expense
-- owes the payer their share (a payer's own share isn't owed to anyone), and
-- a settlement from A to B that isn't voided reduces what A owes B, which is
-- the same as B owing A that amount. Between two people the directions
-- offset; nothing moves between pairs (that would be debt simplification,
-- Phase 21). low_owes > 0 means the lower id owes the higher id.
create function private.balance_pairs(target_household_id uuid)
returns table (low_id uuid, high_id uuid, low_owes numeric)
language sql
stable
set search_path = ''
as $$
  with moves as (
    select s.user_id as debtor, e.paid_by as creditor, s.share_minor as minor
    from public.expense_splits s
    join public.expenses e on e.id = s.expense_id
    where e.household_id = target_household_id
      and e.deleted_at is null
      and s.user_id <> e.paid_by
      and s.share_minor > 0
    union all
    select t.to_user, t.from_user, t.amount_minor
    from public.settlements t
    where t.household_id = target_household_id
      and t.voided_at is null
  )
  select
    least(m.debtor, m.creditor),
    greatest(m.debtor, m.creditor),
    sum(case when m.debtor < m.creditor then m.minor else -m.minor end)
  from moves m
  group by 1, 2;
$$;

-- What someone has to settle before leaving or being removed (D13, O8). Same
-- signature as Phase 9; now from person_balances, so it includes settlements
-- and can't disagree with the balance people see.
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
    select b.net_minor::bigint
    from private.person_balances(target_household_id) b
    where b.user_id = target_user_id
  ), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- household_balances: everything the balances pages show, in one call.
-- Same signature, grants and checks as Phase 9; settlements added.
-- ---------------------------------------------------------------------------

-- Runs as the caller (security invoker), so RLS applies on top of the
-- explicit membership check. Stable, so every part is read from the same
-- snapshot and the parts always agree with each other. Money is text.
--
--   expense_count, total_minor   counted expenses and what they add up to
--   settlement_count, settlement_total_minor
--            settlements that aren't voided and what they add up to
--   people   [{ user_id, display_name, is_active, paid_minor, share_minor,
--              settlements_paid_minor, settlements_received_minor,
--              net_minor, paid_count, share_count,
--              settlements_paid_count, settlements_received_count }]
--            active members in join order, then people who have left
--   pairs    [{ debtor_id, creditor_id, amount_minor }]
--            who owes whom, settlements included; largest first
--   entry_count, entries   only with focus_user_id: the counted expenses that
--            person paid for or shares, newest first (at most 200), as in
--            Phase 9
--   settlement_entry_count, settlement_entries   only with focus_user_id: the
--            counted settlements that person paid or received, newest first
--            (at most 200): [{ settlement_id, settled_on, amount_minor,
--            from_user, to_user, net_minor }]; net_minor is + when the focus
--            person paid it and − when they received it.
create or replace function public.household_balances(
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
  counted_settlements as (
    select t.id, t.from_user, t.to_user, t.amount_minor, t.settled_on, t.created_at
    from public.settlements t
    where t.household_id = target_household_id
      and t.voided_at is null
  ),
  people as (
    select
      b.user_id,
      b.paid_minor,
      b.share_minor,
      b.paid_count,
      b.share_count,
      b.settlements_paid_minor,
      b.settlements_received_minor,
      b.settlements_paid_count,
      b.settlements_received_count,
      b.net_minor,
      pr.display_name,
      m.joined_at,
      m.user_id is not null as is_active
    from private.person_balances(target_household_id) b
    left join public.household_members m
      on m.household_id = target_household_id
     and m.user_id = b.user_id
     and m.left_at is null
    left join public.profiles pr on pr.id = b.user_id
  ),
  pairs as (
    select x.low_id, x.high_id, x.low_owes
    from private.balance_pairs(target_household_id) x
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
  ),
  focus_settlements as (
    select t.id, t.from_user, t.to_user, t.amount_minor, t.settled_on, t.created_at
    from counted_settlements t
    where focus_user_id is not null
      and (t.from_user = focus_user_id or t.to_user = focus_user_id)
  )
  select jsonb_build_object(
    'expense_count', (select count(*) from counted),
    'total_minor', (select coalesce(sum(c.amount_minor), 0) from counted c)::text,
    'settlement_count', (select count(*) from counted_settlements),
    'settlement_total_minor',
      (select coalesce(sum(t.amount_minor), 0) from counted_settlements t)::text,
    'people', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', p.user_id,
          'display_name', p.display_name,
          'is_active', p.is_active,
          'paid_minor', p.paid_minor::text,
          'share_minor', p.share_minor::text,
          'settlements_paid_minor', p.settlements_paid_minor::text,
          'settlements_received_minor', p.settlements_received_minor::text,
          'net_minor', p.net_minor::text,
          'paid_count', p.paid_count,
          'share_count', p.share_count,
          'settlements_paid_count', p.settlements_paid_count,
          'settlements_received_count', p.settlements_received_count
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
    ), '[]'::jsonb),
    'settlement_entry_count', (select count(*) from focus_settlements),
    'settlement_entries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'settlement_id', f.id,
          'settled_on', f.settled_on,
          'amount_minor', f.amount_minor::text,
          'from_user', f.from_user,
          'to_user', f.to_user,
          'net_minor',
            (case when f.from_user = focus_user_id then f.amount_minor else -f.amount_minor end)::text
        )
        order by f.settled_on desc, f.created_at desc, f.id
      )
      from (
        select *
        from focus_settlements
        order by settled_on desc, created_at desc, id
        limit 200
      ) f
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers for the settlement functions
-- ---------------------------------------------------------------------------

-- The settlement as JSON, for the journal. Settlements never change apart
-- from being voided, so this is the whole record.
create function private.settlement_snapshot(target_settlement_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'from_user', t.from_user,
    'to_user', t.to_user,
    'amount_minor', t.amount_minor,
    'settled_on', t.settled_on,
    'note', t.note,
    'recorded_by', t.recorded_by
  )
  from public.settlements t
  where t.id = target_settlement_id;
$$;

-- ---------------------------------------------------------------------------
-- record_settlement (D9)
-- ---------------------------------------------------------------------------

-- Records that payer_id paid recipient_id `amount` minor units on `paid_on`.
-- The caller must be one of the two (recorded_by is the caller, never an
-- argument). Both must be active members (O9 is open).
--
-- Partial amounts are fine. An amount above what the payer owes the recipient
-- right now (from the same pairs the balances show) is refused with HJ017,
-- DETAIL = that figure, unless acknowledged_owed equals it: the caller has
-- seen exactly the warning that applies and still wants to record it (D9:
-- "the app warns"). If what's owed changes in between, the warning comes back.
--
-- Settlements in one household are recorded one at a time (a row lock on the
-- household), so two people recording the same payment at once can't both
-- pass that check on the same figure. A repeated request_key returns the
-- settlement it already recorded.
create function public.record_settlement(
  target_household_id uuid,
  payer_id uuid,
  recipient_id uuid,
  amount bigint,
  paid_on date,
  memo text default null,
  request_key uuid default null,
  acknowledged_owed bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  new_settlement_id uuid;
  owed numeric;
begin
  if caller is null or not private.is_active_member(target_household_id, caller) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  -- One settlement at a time per household. FOR NO KEY UPDATE conflicts with
  -- itself but not with the key-share locks that inserting expenses or
  -- members takes, so it only queues other settlements.
  perform 1 from public.households h where h.id = target_household_id for no key update;

  -- Checked after the lock, so a retry that raced the first attempt sees it.
  if request_key is not null then
    select t.id into new_settlement_id
    from public.settlements t
    where t.recorded_by = caller and t.creation_key = request_key;
    if found then
      return new_settlement_id;
    end if;
  end if;

  -- D9: only the payer or the recipient records a settlement.
  if caller is distinct from payer_id and caller is distinct from recipient_id then
    raise exception 'Only the payer or the recipient can record a settlement'
      using errcode = '42501';
  end if;
  if payer_id = recipient_id
    or not private.is_active_member(target_household_id, payer_id)
    or not private.is_active_member(target_household_id, recipient_id)
  then
    raise exception 'A settlement is between two different active members' using errcode = 'HJ016';
  end if;
  -- The amount's own bounds (the same as settlements_amount_range) come
  -- before the warning, so an amount that could never be recorded isn't
  -- answered with "more than what's owed".
  if amount is null or amount not between 1 and 999999999999 then
    raise exception 'The amount must be between 1 and 999999999999 minor units'
      using errcode = '23514';
  end if;

  perform private.assert_balances_reconcile(target_household_id);

  select case when payer_id < recipient_id then x.low_owes else -x.low_owes end
  into owed
  from private.balance_pairs(target_household_id) x
  where x.low_id = least(payer_id, recipient_id)
    and x.high_id = greatest(payer_id, recipient_id);
  owed := coalesce(owed, 0);

  if amount > owed and acknowledged_owed is distinct from owed then
    raise exception 'The amount is more than what''s owed right now'
      using errcode = 'HJ017', detail = owed::text;
  end if;

  begin
    insert into public.settlements (
      household_id, from_user, to_user, amount_minor, settled_on, note,
      recorded_by, creation_key
    )
    values (
      target_household_id, payer_id, recipient_id, amount, paid_on, memo,
      caller, request_key
    )
    returning id into new_settlement_id;
  exception when unique_violation then
    -- A concurrent request with the same key won the race.
    select t.id into strict new_settlement_id
    from public.settlements t
    where t.recorded_by = caller and t.creation_key = request_key;
    return new_settlement_id;
  end;

  perform private.record_activity(
    target_household_id, 'settlement_recorded', 'settlement', new_settlement_id,
    jsonb_build_object('after', private.settlement_snapshot(new_settlement_id))
  );

  return new_settlement_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_settlement (D9, ADR-007): the payer, the recipient or the owner. The
-- row stays, readable, with who voided it and when; it stops counting.
-- ---------------------------------------------------------------------------

create function public.void_settlement(target_settlement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  t public.settlements%rowtype;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  -- Locked, so two voids at once can't both succeed: the second waits, then
  -- sees the first one's voided_at.
  select * into t from public.settlements s where s.id = target_settlement_id for update;
  if not found or not private.is_active_member(t.household_id, caller) then
    raise exception 'No such settlement' using errcode = 'HJ014';
  end if;
  if t.voided_at is not null then
    raise exception 'The settlement is already voided' using errcode = 'HJ015';
  end if;
  if caller is distinct from t.from_user
    and caller is distinct from t.to_user
    and private.household_role(t.household_id) is distinct from 'owner'
  then
    raise exception 'Only the payer, the recipient or the owner can void this settlement'
      using errcode = '42501';
  end if;

  update public.settlements
  set voided_at = now(), voided_by = caller
  where id = t.id;

  perform private.record_activity(
    t.household_id, 'settlement_voided', 'settlement', t.id,
    jsonb_build_object('before', private.settlement_snapshot(t.id))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function private.protect_settlements() from public;
revoke all on function private.settlement_people(uuid) from public;
revoke all on function private.person_balances(uuid) from public;
revoke all on function private.balance_pairs(uuid) from public;
revoke all on function private.settlement_snapshot(uuid) from public;
-- household_balances runs as the caller, so the caller needs these as well.
-- They read through RLS, and the private schema isn't exposed through the
-- Data API, so they can't be called directly.
grant execute on function private.settlement_people(uuid) to authenticated;
grant execute on function private.person_balances(uuid) to authenticated;
grant execute on function private.balance_pairs(uuid) to authenticated;

revoke all on function public.record_settlement(uuid, uuid, uuid, bigint, date, text, uuid, bigint) from public, anon;
revoke all on function public.void_settlement(uuid) from public, anon;
grant execute on function public.record_settlement(uuid, uuid, uuid, bigint, date, text, uuid, bigint) to authenticated;
grant execute on function public.void_settlement(uuid) to authenticated;

-- create or replace keeps existing grants; restated for clarity.
revoke all on function private.lock_household_currency() from public;
revoke all on function private.member_net_minor(uuid, uuid) from public;
revoke all on function public.household_balances(uuid, uuid) from public, anon;
grant execute on function public.household_balances(uuid, uuid) to authenticated;

alter table public.settlements enable row level security;

-- Voided settlements stay readable (D9); queries filter voided_at themselves.
create policy "Members read their household's settlements"
on public.settlements for select to authenticated
using (private.is_household_member(household_id));

revoke all on table public.settlements from anon, authenticated;
grant all on table public.settlements to service_role;
grant select on table public.settlements to authenticated;
