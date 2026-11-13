-- Roadmap Phase 13: the household journal (activity feed).
--
-- The journal's events have been written since Phase 6, by
-- private.record_activity, inside the same transaction as the change each one
-- describes: every membership, expense and settlement function calls it before
-- returning, and the invitations trigger calls it for invite links. So an
-- event exists exactly when its change was committed, and a refused or failed
-- change leaves none. The table is append-only for every role (Phase 6).
-- This migration adds only the way to read them: public.household_journal.
--
-- Rules:
--   requirements-notes §3  activity_events: members read; nobody edits.
--   D6    Expense changes are journalled with old and new values; the journal
--         shows what changed.
--   D9    Settlements are recorded or voided, never pending or completed:
--         "A recorded a payment of ₹500 to B." Voided ones no longer count.
--   D11   Event times are instants (timestamptz); the app shows them in the
--         household's timezone.
--   D13   People who have left keep their name on past records ("(left)").
--
-- What a member gets is a read model, not the raw events:
--   * Only the event types listed in journal_types below. It's an allowlist:
--     a type added later stays out of the journal until this function is
--     changed to show it.
--   * For each type, only the fields the journal shows. No settlement notes,
--     no split amounts, no invite-link expiry or use limits, no raw summary.
--   * An invite link revoked because its creator left or was removed is part
--     of that leave or removal, not an entry of its own. Both events were
--     written in one transaction, so they share its timestamp exactly.
--   * The names of the people on the page, and whether each is still a
--     member, read in the same snapshot.
--   * For an expense or payment entry, whether that record is still in this
--     household, and whether it has since been deleted or voided, so the app
--     only links to a record the member can open.
--
-- Runs as the caller (security invoker), so RLS applies on top of the
-- explicit membership check; stable, so the page, the names and the record
-- states are one snapshot. Pages are keyset pages, newest first, ordered by
-- (created_at, id): the id breaks ties between events written in the same
-- transaction, every event has exactly one position, and a page never repeats
-- or skips an entry (events are never changed). The cursor is the last entry
-- shown: created_at as microseconds since the epoch, and its id.
--
-- Additive: one public function and three private helpers. No tables,
-- columns, indexes, policies or data changes. The existing index on
-- activity_events (household_id, created_at desc) serves the scan; see
-- docs/database.md.
--
-- Input that can't be right is refused with 22023 (invalid_parameter_value):
-- an unknown category, a page size outside 1-100, half a cursor, or a cursor
-- time outside 0 .. 9999-12-31. The app checks all of these first.

-- ---------------------------------------------------------------------------
-- Helpers: the journal's fields from the snapshots the write functions store.
-- Pure functions of their argument; they read no table.
-- ---------------------------------------------------------------------------

-- An expense, from private.expense_snapshot (Phase 8): what it was, how much
-- (money as text: JSON numbers are doubles), its category and who paid.
create function private.journal_expense(snapshot jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'description', snapshot ->> 'description',
    'amount_minor', snapshot ->> 'amount_minor',
    'category', snapshot ->> 'category',
    'paid_by', snapshot ->> 'paid_by'
  );
$$;

-- The same, plus what an edit can change: the date, the split method and who
-- shares it. The shares themselves stay out; whether any changed is reported
-- separately.
create function private.journal_expense_change(snapshot jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select private.journal_expense(snapshot) || jsonb_build_object(
    'expense_date', snapshot ->> 'expense_date',
    'split_method', snapshot ->> 'split_method',
    'participants', coalesce((
      select jsonb_agg(s ->> 'user_id' order by s ->> 'user_id')
      from jsonb_array_elements(snapshot -> 'splits') s
    ), '[]'::jsonb)
  );
$$;

-- A settlement, from private.settlement_snapshot (roadmap Phase 10). The note
-- stays out: it's on the payment's own page for anyone who opens it.
create function private.journal_settlement(snapshot jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'from_user', snapshot ->> 'from_user',
    'to_user', snapshot ->> 'to_user',
    'amount_minor', snapshot ->> 'amount_minor',
    'settled_on', snapshot ->> 'settled_on',
    'recorded_by', snapshot ->> 'recorded_by'
  );
$$;

-- ---------------------------------------------------------------------------
-- household_journal: one page of the household's journal
-- ---------------------------------------------------------------------------

--   category_filter   null for everything, or 'expenses', 'settlements' or
--                     'household' (members, ownership and invite links)
--   before_us, before_id   the cursor: only entries older than the entry with
--                     this time and id; both or neither
--   page_size         1-100 entries (the app uses 25)
--
-- Returns:
--   has_more   whether older entries exist past this page
--   rows       [{ event_id, household_id, type, actor_id, created_us, detail,
--                 entity }], newest first
--              created_us   when it happened (created_at), in microseconds
--                           since the epoch, as text: exact, so the app can
--                           check the order and build the next cursor
--              detail       the type's own fields (see the CASE below)
--              entity       null, except for expense and payment entries:
--                           { available: false } when the record isn't in
--                           this household, otherwise { available: true,
--                           id, state: active | deleted | voided }
--   people     [{ user_id, display_name, is_active }] for everyone the rows
--              mention
create function public.household_journal(
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
  shown_types public.activity_event_type[];
  cursor_at timestamptz;
  result jsonb;
begin
  if (select auth.uid()) is null or not private.is_household_member(target_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if category_filter is not null
    and category_filter not in ('expenses', 'settlements', 'household')
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
    when 'household' then household_types
    else household_types || expense_types || settlement_types
  end;

  -- Whole seconds, then the microseconds: exact, with no rounding through a
  -- fractional double.
  if before_us is not null then
    cursor_at := to_timestamp(before_us / 1000000)
      + (before_us % 1000000) * interval '1 microsecond';
  end if;

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
    union select (e.detail -> 'before' ->> 'paid_by')::uuid from entries e
    union select (e.detail -> 'after' ->> 'paid_by')::uuid from entries e
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
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function private.journal_expense(jsonb) from public;
revoke all on function private.journal_expense_change(jsonb) from public;
revoke all on function private.journal_settlement(jsonb) from public;
-- household_journal runs as the caller, so the caller needs these. They read
-- no table, and the private schema isn't exposed through the Data API, so
-- they can't be called directly.
grant execute on function private.journal_expense(jsonb) to authenticated;
grant execute on function private.journal_expense_change(jsonb) to authenticated;
grant execute on function private.journal_settlement(jsonb) to authenticated;

revoke all on function public.household_journal(uuid, text, bigint, uuid, integer) from public, anon;
grant execute on function public.household_journal(uuid, text, bigint, uuid, integer) to authenticated;
