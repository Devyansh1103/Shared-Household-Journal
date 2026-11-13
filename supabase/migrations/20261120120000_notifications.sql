-- Roadmap Phase 17: in-app notifications.
--
-- Confirmed (D12, ADR-011, 2026-11-02): notifications are in-app only; each
-- notification row links to an activity_events row; each user switches
-- notifications on or off per household and per type. Decided by the owner
-- on 2026-11-13 (D30): a notification goes to the people an event concerns,
-- never to the person who did it and never to someone who isn't an active
-- member; reminders that aren't events (bills due, chores due, budgets near
-- their limit) are worked out live, not stored (no scheduler, ADR-010).
--
-- How notifications are made: an AFTER INSERT trigger on activity_events
-- writes them in the same transaction as the event, which is the same
-- transaction as the change itself (ADR-006). A change that fails writes no
-- event and so no notification; a retry that writes no second event writes no
-- second notification; and unique (user_id, activity_event_id) makes a
-- duplicate impossible anyway.
--
-- What a notification says is the journal's own projection of its event
-- (no notes, split shares or invite settings), so the journal's projection
-- moves into shared helpers, and household_journal is replaced with the same
-- signature, grants and output, built on them.
--
-- Additive: one type, two tables, functions, triggers, policies and grants;
-- household_journal is replaced. No data changes; no notifications are made
-- for events written before this migration.

-- ---------------------------------------------------------------------------
-- Notification types: the journal's categories (D12's "per type")
-- ---------------------------------------------------------------------------

create type public.notification_category as enum (
  'household', 'expenses', 'settlements', 'bills', 'shopping', 'chores', 'budgets'
);

-- The category of an event type: the journal's filter it's under, and the
-- notification type a person can switch off.
create function private.journal_category(event_type public.activity_event_type)
returns public.notification_category
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when event_type in (
      'household_created', 'member_joined', 'member_left', 'member_removed',
      'ownership_transferred', 'invitation_created', 'invitation_revoked'
    ) then 'household'
    when event_type in (
      'expense_created', 'expense_updated', 'expense_deleted', 'expense_restored'
    ) then 'expenses'
    when event_type in ('settlement_recorded', 'settlement_voided') then 'settlements'
    when event_type in (
      'bill_created', 'bill_updated', 'bill_paused', 'bill_resumed', 'bill_ended',
      'bill_skipped', 'bill_unskipped'
    ) then 'bills'
    when event_type in (
      'shopping_item_added', 'shopping_item_updated', 'shopping_item_purchased',
      'shopping_item_reopened', 'shopping_item_removed'
    ) then 'shopping'
    when event_type in (
      'chore_created', 'chore_updated', 'chore_completed', 'chore_reopened',
      'chore_removed'
    ) then 'chores'
    when event_type in ('budget_created', 'budget_updated', 'budget_archived') then 'budgets'
  end::public.notification_category;
$$;

-- ---------------------------------------------------------------------------
-- The journal's projection, shared by household_journal and my_notifications
-- (moved here unchanged from 20261119120100). They run as the caller, so RLS
-- applies to every lookup.
-- ---------------------------------------------------------------------------

-- What an entry shows of its event: only the fields the journal shows.
create function private.journal_detail(
  event_type public.activity_event_type,
  event_summary jsonb,
  event_household_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case event_type
    when 'household_created' then
      jsonb_build_object('name', event_summary ->> 'name')
    when 'member_joined' then jsonb_build_object(
      'user_id', event_summary ->> 'user_id',
      -- Who created the link they joined with; the link stays out.
      'inviter_id', (
        select i.created_by
        from public.invitations i
        where i.id = (event_summary ->> 'invitation_id')::uuid
          and i.household_id = event_household_id
      )
    )
    when 'member_left' then
      jsonb_build_object('user_id', event_summary ->> 'user_id')
    when 'member_removed' then
      jsonb_build_object('user_id', event_summary ->> 'user_id')
    when 'ownership_transferred' then jsonb_build_object(
      'from_user_id', event_summary ->> 'from_user_id',
      'to_user_id', event_summary ->> 'to_user_id'
    )
    when 'invitation_created' then '{}'::jsonb
    when 'invitation_revoked' then
      jsonb_build_object('created_by', event_summary ->> 'created_by')
    when 'expense_created' then private.journal_expense(event_summary -> 'after')
    when 'expense_restored' then private.journal_expense(event_summary -> 'after')
    when 'expense_deleted' then private.journal_expense(event_summary -> 'before')
    when 'expense_updated' then jsonb_build_object(
      'before', private.journal_expense_change(event_summary -> 'before'),
      'after', private.journal_expense_change(event_summary -> 'after'),
      -- Whether anyone's share changed, without the shares.
      'shares_changed',
        (event_summary -> 'before' -> 'splits') is distinct from (event_summary -> 'after' -> 'splits')
    )
    when 'settlement_recorded' then private.journal_settlement(event_summary -> 'after')
    when 'settlement_voided' then private.journal_settlement(event_summary -> 'before')
    when 'bill_created' then private.journal_bill(event_summary -> 'after')
    when 'bill_updated' then jsonb_build_object(
      'before', private.journal_bill(event_summary -> 'before'),
      'after', private.journal_bill(event_summary -> 'after')
    )
    when 'bill_paused' then
      jsonb_build_object('description', event_summary ->> 'description')
    when 'bill_resumed' then
      jsonb_build_object('description', event_summary ->> 'description')
    when 'bill_ended' then jsonb_build_object(
      'description', event_summary ->> 'description',
      'ends_on', event_summary ->> 'ends_on'
    )
    when 'bill_skipped' then jsonb_build_object(
      'description', event_summary ->> 'description',
      'due_on', event_summary ->> 'due_on'
    )
    when 'bill_unskipped' then jsonb_build_object(
      'description', event_summary ->> 'description',
      'due_on', event_summary ->> 'due_on'
    )
    when 'shopping_item_added' then private.journal_shopping_item(event_summary -> 'after')
    when 'shopping_item_updated' then jsonb_build_object(
      'before', private.journal_shopping_item(event_summary -> 'before'),
      'after', private.journal_shopping_item(event_summary -> 'after'),
      'note_changed', coalesce((event_summary ->> 'note_changed')::boolean, false)
    )
    when 'shopping_item_purchased' then jsonb_build_object(
      'name', event_summary ->> 'name', 'quantity', event_summary ->> 'quantity'
    )
    when 'shopping_item_reopened' then jsonb_build_object(
      'name', event_summary ->> 'name', 'quantity', event_summary ->> 'quantity'
    )
    when 'shopping_item_removed' then jsonb_build_object(
      'name', event_summary ->> 'name', 'quantity', event_summary ->> 'quantity'
    )
    when 'chore_created' then private.journal_chore(event_summary -> 'after')
    when 'chore_updated' then jsonb_build_object(
      'before', private.journal_chore(event_summary -> 'before'),
      'after', private.journal_chore(event_summary -> 'after'),
      'description_changed', coalesce((event_summary ->> 'description_changed')::boolean, false)
    )
    when 'chore_completed' then jsonb_build_object('title', event_summary ->> 'title')
    when 'chore_reopened' then jsonb_build_object('title', event_summary ->> 'title')
    when 'chore_removed' then jsonb_build_object('title', event_summary ->> 'title')
    when 'budget_created' then jsonb_build_object(
      'category', event_summary ->> 'category',
      'period', event_summary ->> 'period',
      'limit_minor', event_summary ->> 'limit_minor',
      'starts_on', event_summary ->> 'starts_on'
    )
    when 'budget_updated' then jsonb_build_object(
      'category', event_summary ->> 'category',
      'period', event_summary ->> 'period',
      'before_limit_minor', event_summary ->> 'before_limit_minor',
      'after_limit_minor', event_summary ->> 'after_limit_minor',
      'from_on', event_summary ->> 'from_on'
    )
    when 'budget_archived' then jsonb_build_object(
      'category', event_summary ->> 'category',
      'period', event_summary ->> 'period',
      'limit_minor', event_summary ->> 'limit_minor'
    )
  end;
$$;

-- Everyone an entry's detail names (the actor is added by the callers).
create function private.journal_mentions(
  event_type public.activity_event_type,
  detail jsonb
)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct m.user_id) filter (where m.user_id is not null), '{}')
  from (
    select (detail ->> 'user_id')::uuid as user_id
    union all select (detail ->> 'inviter_id')::uuid
    union all select (detail ->> 'from_user_id')::uuid
    union all select (detail ->> 'to_user_id')::uuid
    union all select (detail ->> 'created_by')::uuid
    union all select (detail ->> 'paid_by')::uuid
    union all select (detail ->> 'from_user')::uuid
    union all select (detail ->> 'to_user')::uuid
    union all select (detail ->> 'recorded_by')::uuid
    union all select (detail ->> 'payer_id')::uuid
    union all select (detail ->> 'assignee_id')::uuid
    union all select (detail -> 'before' ->> 'paid_by')::uuid
    union all select (detail -> 'after' ->> 'paid_by')::uuid
    union all select (detail -> 'before' ->> 'payer_id')::uuid
    union all select (detail -> 'after' ->> 'payer_id')::uuid
    union all select (detail -> 'before' ->> 'assignee_id')::uuid
    union all select (detail -> 'after' ->> 'assignee_id')::uuid
    union all
    select jsonb_array_elements_text(
      case when event_type = 'expense_updated' then detail -> 'before' -> 'participants' end
    )::uuid
    union all
    select jsonb_array_elements_text(
      case when event_type = 'expense_updated' then detail -> 'after' -> 'participants' end
    )::uuid
  ) m;
$$;

-- The record an entry is about, as it is now (null for entries that aren't
-- about one): unavailable if it isn't in the household any more.
create function private.journal_entity(
  event_entity_type public.activity_entity_type,
  event_entity_id uuid,
  event_household_id uuid,
  today date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when event_entity_type = 'expense' then coalesce((
      select jsonb_build_object(
        'available', true,
        'id', x.id,
        'state', case when x.deleted_at is null then 'active' else 'deleted' end
      )
      from public.expenses x
      where x.id = event_entity_id
        and x.household_id = event_household_id
    ), jsonb_build_object('available', false))
    when event_entity_type = 'settlement' then coalesce((
      select jsonb_build_object(
        'available', true,
        'id', t.id,
        'state', case when t.voided_at is null then 'active' else 'voided' end
      )
      from public.settlements t
      where t.id = event_entity_id
        and t.household_id = event_household_id
    ), jsonb_build_object('available', false))
    when event_entity_type = 'recurring_bill' then coalesce((
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
      where rb.id = event_entity_id
        and rb.household_id = event_household_id
    ), jsonb_build_object('available', false))
    when event_entity_type = 'shopping_item' then coalesce((
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
      where si.id = event_entity_id
        and si.household_id = event_household_id
    ), jsonb_build_object('available', false))
    when event_entity_type = 'chore' then coalesce((
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
      where ch.id = event_entity_id
        and ch.household_id = event_household_id
    ), jsonb_build_object('available', false))
    when event_entity_type = 'budget' then coalesce((
      select jsonb_build_object(
        'available', true,
        'id', bu.id,
        'state', case when bu.archived_at is null then 'active' else 'archived' end
      )
      from public.budgets bu
      where bu.id = event_entity_id
        and bu.household_id = event_household_id
    ), jsonb_build_object('available', false))
  end;
$$;

-- Same signature, grants and output as in 20261119120100, built on the
-- helpers above.
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
    select s.*, private.journal_detail(s.type, s.summary, s.household_id) as detail
    from shown s
  ),
  mentioned as (
    select e.actor_id as user_id from entries e
    union
    select unnest(private.journal_mentions(e.type, e.detail)) from entries e
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
          'entity', private.journal_entity(e.entity_type, e.entity_id, target_household_id, today)
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
-- notifications and notification_preferences
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  -- The recipient. Their notifications go with their account.
  user_id uuid not null references public.profiles (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  activity_event_id uuid not null references public.activity_events (id) on delete cascade,
  category public.notification_category not null,
  -- The event's time, for the order.
  created_at timestamptz not null,
  read_at timestamptz,
  constraint notifications_user_event_unique unique (user_id, activity_event_id)
);

comment on table public.notifications is
  'In-app notifications (D12): one row per recipient and journal event. The recipient reads and marks their own while they''re an active member; rows are written only by the activity_events trigger.';

create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc, id desc);
create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;
create index notifications_household_id_idx on public.notifications (household_id);
create index notifications_activity_event_id_idx on public.notifications (activity_event_id);

-- D12: on or off per household and per type. No row means on.
create table public.notification_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  category public.notification_category not null,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, household_id, category)
);

comment on table public.notification_preferences is
  'Which notification types each person receives in each household (D12). No row means on. Written only by set_notification_preferences.';

create index notification_preferences_household_id_idx
  on public.notification_preferences (household_id);

-- ---------------------------------------------------------------------------
-- Who an event concerns (D30, decided by the owner 2026-11-13)
-- ---------------------------------------------------------------------------

-- The payer and everyone in the split of an expense snapshot.
create function private.expense_people(snapshot jsonb)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct p.user_id) filter (where p.user_id is not null), '{}')
  from (
    select (snapshot ->> 'paid_by')::uuid as user_id
    union all
    select (s ->> 'user_id')::uuid
    from jsonb_array_elements(coalesce(snapshot -> 'splits', '[]'::jsonb)) s
  ) p;
$$;

-- Everyone an event concerns, before leaving out the actor, people who
-- aren't active members and switched-off types:
--   membership changes and budgets   everyone in the household
--   an expense                       its payer and the people in its split
--                                    (before and after an edit)
--   a payment                        both people (so the other one, D9)
--   a bill                           who usually pays it and its split
--   a shopping item or a chore       its assignee (before and after a
--                                    change); also who added it when it's
--                                    bought or done
-- Invite links and the household's creation concern no one.
create function private.notification_recipients(e public.activity_events)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  people uuid[] := '{}';
begin
  case e.type
    when 'member_joined', 'member_left', 'member_removed', 'ownership_transferred',
         'budget_created', 'budget_updated', 'budget_archived' then
      select coalesce(array_agg(hm.user_id), '{}') into people
      from public.household_members hm
      where hm.household_id = e.household_id
        and hm.left_at is null;
    when 'expense_created', 'expense_restored' then
      people := private.expense_people(e.summary -> 'after');
    when 'expense_deleted' then
      people := private.expense_people(e.summary -> 'before');
    when 'expense_updated' then
      people := private.expense_people(e.summary -> 'before')
        || private.expense_people(e.summary -> 'after');
    when 'settlement_recorded' then
      people := array[
        (e.summary -> 'after' ->> 'from_user')::uuid,
        (e.summary -> 'after' ->> 'to_user')::uuid
      ];
    when 'settlement_voided' then
      people := array[
        (e.summary -> 'before' ->> 'from_user')::uuid,
        (e.summary -> 'before' ->> 'to_user')::uuid
      ];
    when 'bill_created', 'bill_updated', 'bill_paused', 'bill_resumed', 'bill_ended',
         'bill_skipped', 'bill_unskipped' then
      select coalesce(array_agg(x.user_id), '{}') into people
      from (
        select b.payer_id as user_id
        from public.recurring_bills b
        where b.id = e.entity_id and b.household_id = e.household_id
        union
        select sh.user_id
        from public.recurring_bill_shares sh
        where sh.bill_id = e.entity_id and sh.household_id = e.household_id
      ) x;
      if e.type = 'bill_updated' then
        people := people || (e.summary -> 'before' ->> 'payer_id')::uuid;
      end if;
    when 'shopping_item_added' then
      people := array[(e.summary -> 'after' ->> 'assignee_id')::uuid];
    when 'shopping_item_updated' then
      people := array[
        (e.summary -> 'before' ->> 'assignee_id')::uuid,
        (e.summary -> 'after' ->> 'assignee_id')::uuid
      ];
    when 'shopping_item_purchased' then
      select array[i.assignee_id, i.added_by] into people
      from public.shopping_items i
      where i.id = e.entity_id and i.household_id = e.household_id;
    when 'shopping_item_reopened', 'shopping_item_removed' then
      select array[i.assignee_id] into people
      from public.shopping_items i
      where i.id = e.entity_id and i.household_id = e.household_id;
    when 'chore_created' then
      people := array[(e.summary -> 'after' ->> 'assignee_id')::uuid];
    when 'chore_updated' then
      people := array[
        (e.summary -> 'before' ->> 'assignee_id')::uuid,
        (e.summary -> 'after' ->> 'assignee_id')::uuid
      ];
    when 'chore_completed' then
      select array[c.assignee_id, c.created_by] into people
      from public.chores c
      where c.id = e.entity_id and c.household_id = e.household_id;
    when 'chore_reopened', 'chore_removed' then
      select array[c.assignee_id] into people
      from public.chores c
      where c.id = e.entity_id and c.household_id = e.household_id;
    else
      people := '{}';
  end case;
  return coalesce(people, '{}');
end;
$$;

-- Writes an event's notifications, in the event's transaction.
create function private.notify_on_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_category public.notification_category := private.journal_category(new.type);
begin
  if event_category is null then
    return null;
  end if;
  insert into public.notifications (user_id, household_id, activity_event_id, category, created_at)
  select distinct r.user_id, new.household_id, new.id, event_category, new.created_at
  from unnest(private.notification_recipients(new)) as r(user_id)
  where r.user_id is not null
    -- Never the person who did it.
    and r.user_id is distinct from new.actor_id
    -- Never the person who left or was removed.
    and not (
      new.type in ('member_left', 'member_removed')
      and r.user_id = (new.summary ->> 'user_id')::uuid
    )
    -- Only active members (D13).
    and exists (
      select 1
      from public.household_members hm
      where hm.household_id = new.household_id
        and hm.user_id = r.user_id
        and hm.left_at is null
    )
    -- Unless they switched this type off here (D12).
    and not exists (
      select 1
      from public.notification_preferences p
      where p.user_id = r.user_id
        and p.household_id = new.household_id
        and p.category = event_category
        and not p.enabled
    )
  on conflict (user_id, activity_event_id) do nothing;
  return null;
end;
$$;

create trigger activity_events_notify
after insert on public.activity_events
for each row execute function private.notify_on_activity();

-- ---------------------------------------------------------------------------
-- Reading and marking: the signed-in person's own, in households they're an
-- active member of
-- ---------------------------------------------------------------------------

-- A page of the caller's notifications, newest first, with what each event
-- says (the journal's projection), its household, the record's state now and
-- the people it names. Keyset pages by (created_at, id), like the journal.
create function public.my_notifications(
  unread_only boolean default false,
  before_us bigint default null,
  before_id uuid default null,
  page_size integer default 20,
  target_notification_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  cursor_at timestamptz;
  result jsonb;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if page_size is null or page_size not between 1 and 100 then
    raise exception 'Pages hold 1 to 100 notifications' using errcode = '22023';
  end if;
  if (before_us is null) <> (before_id is null) then
    raise exception 'A cursor needs both its time and its id' using errcode = '22023';
  end if;
  if before_us not between 0 and 253402300799999999 then
    raise exception 'The cursor time is out of range' using errcode = '22023';
  end if;
  if before_us is not null then
    cursor_at := to_timestamp(before_us / 1000000)
      + (before_us % 1000000) * interval '1 microsecond';
  end if;

  with page as (
    select n.id, n.household_id, n.activity_event_id, n.category, n.created_at, n.read_at
    from public.notifications n
    where n.user_id = caller
      and (target_notification_id is null or n.id = target_notification_id)
      and (not coalesce(unread_only, false) or n.read_at is null)
      and n.created_at <= coalesce(cursor_at, 'infinity'::timestamptz)
      and (cursor_at is null or n.created_at < cursor_at or n.id < before_id)
      -- RLS says the same; stated so the rule is visible here.
      and exists (
        select 1
        from public.household_members hm
        where hm.household_id = n.household_id
          and hm.user_id = caller
          and hm.left_at is null
      )
    order by n.created_at desc, n.id desc
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
      a.type, a.actor_id, a.entity_type, a.entity_id,
      private.journal_detail(a.type, a.summary, a.household_id) as detail
    from shown s
    join public.activity_events a
      on a.id = s.activity_event_id
      and a.household_id = s.household_id
  ),
  mentioned as (
    select e.household_id, e.actor_id as user_id from entries e
    union
    select e.household_id, unnest(private.journal_mentions(e.type, e.detail)) from entries e
  ),
  people as (
    select
      m.household_id,
      pr.id,
      pr.display_name,
      exists (
        select 1
        from public.household_members hm
        where hm.household_id = m.household_id
          and hm.user_id = pr.id
          and hm.left_at is null
      ) as is_active
    from mentioned m
    join public.profiles pr on pr.id = m.user_id
  )
  select jsonb_build_object(
    'has_more', (select count(*) from page) > page_size,
    'unread_count', (
      select count(*)
      from public.notifications n
      where n.user_id = caller
        and n.read_at is null
        and exists (
          select 1
          from public.household_members hm
          where hm.household_id = n.household_id
            and hm.user_id = caller
            and hm.left_at is null
        )
    ),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'notification_id', e.id,
          'household_id', e.household_id,
          'household_name', h.name,
          'currency_code', h.currency_code,
          'timezone', h.timezone,
          'category', e.category,
          'read', e.read_at is not null,
          'created_us', (extract(epoch from e.created_at) * 1000000)::bigint::text,
          'event', jsonb_build_object(
            'event_id', e.activity_event_id,
            'type', e.type,
            'actor_id', e.actor_id,
            'detail', e.detail,
            'entity', private.journal_entity(
              e.entity_type, e.entity_id, e.household_id,
              private.household_today(e.household_id)
            )
          )
        )
        order by e.position
      )
      from entries e
      join public.households h on h.id = e.household_id
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'household_id', p.household_id,
          'user_id', p.id,
          'display_name', p.display_name,
          'is_active', p.is_active
        )
        order by p.household_id, p.id
      )
      from people p
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

-- How many unread notifications the caller has (for the bell).
create function public.my_unread_notification_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
  from public.notifications n
  where n.user_id = (select auth.uid())
    and n.read_at is null
    and exists (
      select 1
      from public.household_members hm
      where hm.household_id = n.household_id
        and hm.user_id = (select auth.uid())
        and hm.left_at is null
    );
$$;

-- Marks the caller's own notifications as read: the ones given, or all of
-- them. Anyone else's, or ones already read, are left alone; nothing says
-- whether an id exists. Returns how many changed.
create function public.mark_notifications_read(target_notification_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  changed integer;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if cardinality(target_notification_ids) > 100 then
    raise exception 'At most 100 at a time' using errcode = '22023';
  end if;
  update public.notifications n
  set read_at = now()
  where n.user_id = caller
    and n.read_at is null
    and (target_notification_ids is null or n.id = any(target_notification_ids))
    and private.is_active_member(n.household_id, caller);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- The caller's notification types for one household: everything not in
-- muted_categories is on. The caller must be an active member there.
create function public.set_notification_preferences(
  target_household_id uuid,
  muted_categories public.notification_category[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or not private.is_active_member(target_household_id, caller) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  insert into public.notification_preferences (user_id, household_id, category, enabled)
  select caller, target_household_id, c, not (c = any(coalesce(muted_categories, '{}')))
  from unnest(enum_range(null::public.notification_category)) as c
  on conflict (user_id, household_id, category) do update
    set enabled = excluded.enabled, updated_at = now()
    where public.notification_preferences.enabled is distinct from excluded.enabled;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access: each person reads only their own, in their active households
-- ---------------------------------------------------------------------------

alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;

create policy "People read their own notifications"
on public.notifications for select to authenticated
using (user_id = (select auth.uid()) and private.is_household_member(household_id));

create policy "People read their own notification preferences"
on public.notification_preferences for select to authenticated
using (user_id = (select auth.uid()) and private.is_household_member(household_id));

revoke all on table public.notifications, public.notification_preferences from anon, authenticated;
grant all on table public.notifications, public.notification_preferences to service_role;
grant select on table public.notifications, public.notification_preferences to authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function private.journal_category(public.activity_event_type) from public;
revoke all on function private.journal_detail(public.activity_event_type, jsonb, uuid) from public;
revoke all on function private.journal_mentions(public.activity_event_type, jsonb) from public;
revoke all on function private.journal_entity(public.activity_entity_type, uuid, uuid, date) from public;
revoke all on function private.expense_people(jsonb) from public;
revoke all on function private.notification_recipients(public.activity_events) from public;
revoke all on function private.notify_on_activity() from public;
-- household_journal and my_notifications run as the caller, so the caller
-- needs these. They run as the caller too (RLS applies), and the private
-- schema isn't exposed through the Data API.
grant execute on function private.journal_category(public.activity_event_type) to authenticated;
grant execute on function private.journal_detail(public.activity_event_type, jsonb, uuid) to authenticated;
grant execute on function private.journal_mentions(public.activity_event_type, jsonb) to authenticated;
grant execute on function private.journal_entity(public.activity_entity_type, uuid, uuid, date) to authenticated;

revoke all on function public.my_notifications(boolean, bigint, uuid, integer, uuid) from public, anon;
revoke all on function public.my_unread_notification_count() from public, anon;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
revoke all on function public.set_notification_preferences(uuid, public.notification_category[]) from public, anon;
grant execute on function public.my_notifications(boolean, bigint, uuid, integer, uuid) to authenticated;
grant execute on function public.my_unread_notification_count() to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.set_notification_preferences(uuid, public.notification_category[]) to authenticated;

-- create or replace keeps existing grants; restated for clarity.
revoke all on function public.household_journal(uuid, text, bigint, uuid, integer) from public, anon;
grant execute on function public.household_journal(uuid, text, bigint, uuid, integer) to authenticated;
