-- Roadmap Phase 15: the shared shopping list and one-off chores.
--
-- The model confirmed on 2026-11-02 (requirements-notes §3):
--   shopping_items  name, quantity (text), added_by, purchased_at,
--                   purchased_by: items belong to the household, so there is
--                   one shared list per household
--   chores          title, assignee_id, due_date, completed_at,
--                   completed_by; one-off chores only (no recurrence)
-- D28 (proposed) adds what nothing approved covered: a note and an assignee
-- on an item; a description and a priority on a chore; removal (kept, never
-- deleted, like expenses and settlements); and who may do what.
--
-- Rules:
--   ADR-006  Writes go through SECURITY DEFINER functions that take the
--            caller from auth.uid() and check membership; members have no
--            direct write privileges.
--   D13      An assignee must be an active member when assigned. If they
--            leave later, the assignment stays, shown with "(left)", and
--            anyone may reassign or finish the task: nothing is moved to an
--            arbitrary member.
--   D11      A chore's due date is a calendar date; "overdue" is worked out
--            from the household's date by the app, never stored.
--   Journal  Every change is an event in the same transaction. Purchasing,
--            reopening, completing or removing something that's already
--            that way changes nothing and writes no event (a double tap or a
--            retry). Notes and descriptions stay out of the journal.
--
-- Nothing here touches money: shopping items and chores have no amounts.
--
-- Additive: two tables, functions, triggers, policies and grants;
-- household_journal is replaced with the same signature and grants. No data
-- changes.
--
-- New error codes (mapped in src/lib/households/errors.ts):
--   HJ026  no such shopping item (also for other households' ids)
--   HJ027  no such chore (also for other households' ids)
--   HJ028  it has been removed
--   HJ029  it changed since it was loaded
--   HJ030  the assignee must be an active member

-- ---------------------------------------------------------------------------
-- shopping_items
-- ---------------------------------------------------------------------------

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null
    constraint shopping_items_name_length
    check (char_length(name) between 1 and 120 and name = btrim(name)),
  -- Free text, as confirmed: "2", "1 kg", "a big bag".
  quantity text
    constraint shopping_items_quantity_length
    check (quantity is null or (char_length(quantity) between 1 and 40 and quantity = btrim(quantity))),
  note text
    constraint shopping_items_note_length
    check (note is null or (char_length(note) between 1 and 300 and note = btrim(note))),
  assignee_id uuid references public.profiles (id) on delete restrict,
  added_by uuid not null references public.profiles (id) on delete restrict,
  -- Makes add_shopping_item idempotent for a repeated submission.
  creation_key uuid,
  purchased_at timestamptz,
  purchased_by uuid references public.profiles (id) on delete restrict,
  removed_at timestamptz,
  removed_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shopping_items_purchased_together check ((purchased_at is null) = (purchased_by is null)),
  constraint shopping_items_removed_together check ((removed_at is null) = (removed_by is null))
);

comment on table public.shopping_items is
  'The household''s shared shopping list. Active members read; writes go through the shopping functions only.';

create unique index shopping_items_added_by_creation_key
  on public.shopping_items (added_by, creation_key)
  where creation_key is not null;
create index shopping_items_household_open_idx
  on public.shopping_items (household_id, created_at)
  where removed_at is null and purchased_at is null;
create index shopping_items_household_purchased_idx
  on public.shopping_items (household_id, purchased_at desc)
  where removed_at is null and purchased_at is not null;
create index shopping_items_assignee_id_idx on public.shopping_items (assignee_id);
create index shopping_items_added_by_idx on public.shopping_items (added_by);
create index shopping_items_purchased_by_idx on public.shopping_items (purchased_by);
create index shopping_items_removed_by_idx on public.shopping_items (removed_by);

create trigger shopping_items_set_updated_at
before update on public.shopping_items
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- chores
-- ---------------------------------------------------------------------------

create table public.chores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null
    constraint chores_title_length
    check (char_length(title) between 1 and 120 and title = btrim(title)),
  description text
    constraint chores_description_length
    check (description is null or (char_length(description) between 1 and 1000 and description = btrim(description))),
  assignee_id uuid references public.profiles (id) on delete restrict,
  -- A calendar date (D11), optional.
  due_on date
    constraint chores_due_on_range check (due_on between date '2000-01-01' and date '2099-12-31'),
  priority public.chore_priority not null default 'medium',
  created_by uuid not null references public.profiles (id) on delete restrict,
  creation_key uuid,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete restrict,
  removed_at timestamptz,
  removed_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chores_completed_together check ((completed_at is null) = (completed_by is null)),
  constraint chores_removed_together check ((removed_at is null) = (removed_by is null))
);

comment on table public.chores is
  'One-off household chores. Active members read; writes go through the chore functions only.';

create unique index chores_created_by_creation_key
  on public.chores (created_by, creation_key)
  where creation_key is not null;
create index chores_household_open_idx
  on public.chores (household_id, due_on)
  where removed_at is null and completed_at is null;
create index chores_household_completed_idx
  on public.chores (household_id, completed_at desc)
  where removed_at is null and completed_at is not null;
create index chores_assignee_id_idx on public.chores (assignee_id);
create index chores_created_by_idx on public.chores (created_by);
create index chores_completed_by_idx on public.chores (completed_by);
create index chores_removed_by_idx on public.chores (removed_by);

create trigger chores_set_updated_at
before update on public.chores
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER, ADR-006)
-- ---------------------------------------------------------------------------

-- Locks an item the caller can see, or HJ026 (also for other households').
create function private.lock_shopping_item(target_item_id uuid)
returns public.shopping_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  item public.shopping_items%rowtype;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into item from public.shopping_items si where si.id = target_item_id for update;
  if not found or not private.is_active_member(item.household_id, caller) then
    raise exception 'No such shopping item' using errcode = 'HJ026';
  end if;
  return item;
end;
$$;

-- Locks a chore the caller can see, or HJ027 (also for other households').
create function private.lock_chore(target_chore_id uuid)
returns public.chores
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  c public.chores%rowtype;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into c from public.chores ch where ch.id = target_chore_id for update;
  if not found or not private.is_active_member(c.household_id, caller) then
    raise exception 'No such chore' using errcode = 'HJ027';
  end if;
  return c;
end;
$$;

-- D28 (proposed): who may change or remove a chore: the person who added it,
-- the person it's assigned to, or the owner. Never null: an unassigned
-- chore's "assignee_id = caller" is null, and "if not null" doesn't refuse.
create function private.can_manage_chore(c public.chores)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    c.created_by = (select auth.uid())
      or c.assignee_id = (select auth.uid())
      or private.household_role(c.household_id) = 'owner',
    false
  );
$$;

-- D28 (proposed): who may complete or reopen it: the same people, or anyone
-- when it's assigned to nobody or to someone who has left (D13).
create function private.can_finish_chore(c public.chores)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.can_manage_chore(c)
      or c.assignee_id is null
      or not private.is_active_member(c.household_id, c.assignee_id),
    false
  );
$$;

-- An assignee is nobody, or an active member (HJ030).
create function private.check_assignee(target_household_id uuid, target_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if target_user_id is not null
    and not private.is_active_member(target_household_id, target_user_id)
  then
    raise exception 'The assignee must be an active member' using errcode = 'HJ030';
  end if;
end;
$$;

-- What the journal keeps of an item and a chore: no note, no description.
create function private.shopping_item_snapshot(target_item_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', i.name,
    'quantity', i.quantity,
    'assignee_id', i.assignee_id
  )
  from public.shopping_items i
  where i.id = target_item_id;
$$;

create function private.chore_snapshot(target_chore_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', c.title,
    'assignee_id', c.assignee_id,
    'due_on', c.due_on,
    'priority', c.priority
  )
  from public.chores c
  where c.id = target_chore_id;
$$;

-- ---------------------------------------------------------------------------
-- The shopping list: any active member does everything on it (D28)
-- ---------------------------------------------------------------------------

create function public.add_shopping_item(
  target_household_id uuid,
  item_name text,
  item_quantity text default null,
  item_note text default null,
  item_assignee_id uuid default null,
  request_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  new_item_id uuid;
begin
  if caller is null or not private.is_active_member(target_household_id, caller) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if request_key is not null then
    select si.id into new_item_id
    from public.shopping_items si
    where si.added_by = caller and si.creation_key = request_key;
    if found then
      return new_item_id;
    end if;
  end if;
  perform private.check_assignee(target_household_id, item_assignee_id);

  begin
    insert into public.shopping_items (
      household_id, name, quantity, note, assignee_id, added_by, creation_key
    )
    values (
      target_household_id, item_name, item_quantity, item_note, item_assignee_id,
      caller, request_key
    )
    returning id into new_item_id;
  exception when unique_violation then
    -- A concurrent request with the same key won the race.
    select si.id into strict new_item_id
    from public.shopping_items si
    where si.added_by = caller and si.creation_key = request_key;
    return new_item_id;
  end;

  perform private.record_activity(
    target_household_id, 'shopping_item_added', 'shopping_item', new_item_id,
    jsonb_build_object('after', private.shopping_item_snapshot(new_item_id))
  );
  return new_item_id;
end;
$$;

-- Replaces the name, quantity, note and assignee. Journalled only when
-- something changed; a changed note is flagged, never copied.
create function public.update_shopping_item(
  target_item_id uuid,
  item_name text,
  item_quantity text default null,
  item_note text default null,
  item_assignee_id uuid default null,
  expected_updated_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.shopping_items%rowtype;
  before_values jsonb;
  after_values jsonb;
begin
  item := private.lock_shopping_item(target_item_id);
  if item.removed_at is not null then
    raise exception 'The item has been removed' using errcode = 'HJ028';
  end if;
  if expected_updated_at is not null and item.updated_at <> expected_updated_at then
    raise exception 'The item changed since it was loaded' using errcode = 'HJ029';
  end if;
  -- Kept as it is, a former member's assignment stays (D13).
  if item_assignee_id is distinct from item.assignee_id then
    perform private.check_assignee(item.household_id, item_assignee_id);
  end if;

  before_values := private.shopping_item_snapshot(item.id);
  update public.shopping_items si
  set name = item_name, quantity = item_quantity, note = item_note, assignee_id = item_assignee_id
  where si.id = item.id;
  after_values := private.shopping_item_snapshot(item.id);

  if after_values is distinct from before_values or item_note is distinct from item.note then
    perform private.record_activity(
      item.household_id, 'shopping_item_updated', 'shopping_item', item.id,
      jsonb_build_object(
        'before', before_values,
        'after', after_values,
        'note_changed', item_note is distinct from item.note
      )
    );
  end if;
end;
$$;

-- Bought: who and when, from the session. Already bought: nothing happens.
create function public.purchase_shopping_item(target_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.shopping_items%rowtype;
begin
  item := private.lock_shopping_item(target_item_id);
  if item.removed_at is not null then
    raise exception 'The item has been removed' using errcode = 'HJ028';
  end if;
  if item.purchased_at is not null then
    return;
  end if;
  update public.shopping_items si
  set purchased_at = now(), purchased_by = (select auth.uid())
  where si.id = item.id;
  perform private.record_activity(
    item.household_id, 'shopping_item_purchased', 'shopping_item', item.id,
    jsonb_build_object('name', item.name, 'quantity', item.quantity)
  );
end;
$$;

-- Back on the list (still needed after all). Not bought: nothing happens.
create function public.reopen_shopping_item(target_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.shopping_items%rowtype;
begin
  item := private.lock_shopping_item(target_item_id);
  if item.removed_at is not null then
    raise exception 'The item has been removed' using errcode = 'HJ028';
  end if;
  if item.purchased_at is null then
    return;
  end if;
  update public.shopping_items si
  set purchased_at = null, purchased_by = null
  where si.id = item.id;
  perform private.record_activity(
    item.household_id, 'shopping_item_reopened', 'shopping_item', item.id,
    jsonb_build_object('name', item.name, 'quantity', item.quantity)
  );
end;
$$;

-- Off the list. The row stays (who added and bought it), and so does the
-- journal; it can't be changed any more. Already removed: nothing happens.
create function public.remove_shopping_item(target_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.shopping_items%rowtype;
begin
  item := private.lock_shopping_item(target_item_id);
  if item.removed_at is not null then
    return;
  end if;
  update public.shopping_items si
  set removed_at = now(), removed_by = (select auth.uid())
  where si.id = item.id;
  perform private.record_activity(
    item.household_id, 'shopping_item_removed', 'shopping_item', item.id,
    jsonb_build_object('name', item.name, 'quantity', item.quantity)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Chores (D28: any member adds one; who changes and finishes it, above)
-- ---------------------------------------------------------------------------

create function public.create_chore(
  target_household_id uuid,
  chore_title text,
  chore_description text default null,
  chore_assignee_id uuid default null,
  chore_due_on date default null,
  chore_priority_level public.chore_priority default 'medium',
  request_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  new_chore_id uuid;
begin
  if caller is null or not private.is_active_member(target_household_id, caller) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if request_key is not null then
    select ch.id into new_chore_id
    from public.chores ch
    where ch.created_by = caller and ch.creation_key = request_key;
    if found then
      return new_chore_id;
    end if;
  end if;
  perform private.check_assignee(target_household_id, chore_assignee_id);

  begin
    insert into public.chores (
      household_id, title, description, assignee_id, due_on, priority,
      created_by, creation_key
    )
    values (
      target_household_id, chore_title, chore_description, chore_assignee_id,
      chore_due_on, coalesce(chore_priority_level, 'medium'), caller, request_key
    )
    returning id into new_chore_id;
  exception when unique_violation then
    select ch.id into strict new_chore_id
    from public.chores ch
    where ch.created_by = caller and ch.creation_key = request_key;
    return new_chore_id;
  end;

  perform private.record_activity(
    target_household_id, 'chore_created', 'chore', new_chore_id,
    jsonb_build_object('after', private.chore_snapshot(new_chore_id))
  );
  return new_chore_id;
end;
$$;

-- Replaces the title, description, assignee, due date and priority (so this
-- is also how a chore is reassigned). Journalled with old and new values
-- when something changed; a changed description is flagged, never copied.
create function public.update_chore(
  target_chore_id uuid,
  chore_title text,
  chore_description text default null,
  chore_assignee_id uuid default null,
  chore_due_on date default null,
  chore_priority_level public.chore_priority default 'medium',
  expected_updated_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chores%rowtype;
  before_values jsonb;
  after_values jsonb;
begin
  c := private.lock_chore(target_chore_id);
  if c.removed_at is not null then
    raise exception 'The chore has been removed' using errcode = 'HJ028';
  end if;
  if not private.can_manage_chore(c) then
    raise exception 'Only the person who added it, its assignee or the owner can change this chore'
      using errcode = '42501';
  end if;
  if expected_updated_at is not null and c.updated_at <> expected_updated_at then
    raise exception 'The chore changed since it was loaded' using errcode = 'HJ029';
  end if;
  if chore_assignee_id is distinct from c.assignee_id then
    perform private.check_assignee(c.household_id, chore_assignee_id);
  end if;

  before_values := private.chore_snapshot(c.id);
  update public.chores ch
  set title = chore_title,
      description = chore_description,
      assignee_id = chore_assignee_id,
      due_on = chore_due_on,
      priority = coalesce(chore_priority_level, 'medium')
  where ch.id = c.id;
  after_values := private.chore_snapshot(c.id);

  if after_values is distinct from before_values or chore_description is distinct from c.description then
    perform private.record_activity(
      c.household_id, 'chore_updated', 'chore', c.id,
      jsonb_build_object(
        'before', before_values,
        'after', after_values,
        'description_changed', chore_description is distinct from c.description
      )
    );
  end if;
end;
$$;

-- Done: who and when, from the session. Already done: nothing happens.
create function public.complete_chore(target_chore_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chores%rowtype;
begin
  c := private.lock_chore(target_chore_id);
  if c.removed_at is not null then
    raise exception 'The chore has been removed' using errcode = 'HJ028';
  end if;
  if not private.can_finish_chore(c) then
    raise exception 'Only its assignee, the person who added it or the owner can complete this chore'
      using errcode = '42501';
  end if;
  if c.completed_at is not null then
    return;
  end if;
  update public.chores ch
  set completed_at = now(), completed_by = (select auth.uid())
  where ch.id = c.id;
  perform private.record_activity(
    c.household_id, 'chore_completed', 'chore', c.id,
    jsonb_build_object('title', c.title)
  );
end;
$$;

-- Not done after all. Not done: nothing happens.
create function public.reopen_chore(target_chore_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chores%rowtype;
begin
  c := private.lock_chore(target_chore_id);
  if c.removed_at is not null then
    raise exception 'The chore has been removed' using errcode = 'HJ028';
  end if;
  if not private.can_finish_chore(c) then
    raise exception 'Only its assignee, the person who added it or the owner can reopen this chore'
      using errcode = '42501';
  end if;
  if c.completed_at is null then
    return;
  end if;
  update public.chores ch
  set completed_at = null, completed_by = null
  where ch.id = c.id;
  perform private.record_activity(
    c.household_id, 'chore_reopened', 'chore', c.id,
    jsonb_build_object('title', c.title)
  );
end;
$$;

-- Off the board. The row and the journal stay. Already removed: nothing
-- happens.
create function public.remove_chore(target_chore_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chores%rowtype;
begin
  c := private.lock_chore(target_chore_id);
  if c.removed_at is not null then
    return;
  end if;
  if not private.can_manage_chore(c) then
    raise exception 'Only the person who added it, its assignee or the owner can remove this chore'
      using errcode = '42501';
  end if;
  update public.chores ch
  set removed_at = now(), removed_by = (select auth.uid())
  where ch.id = c.id;
  perform private.record_activity(
    c.household_id, 'chore_removed', 'chore', c.id,
    jsonb_build_object('title', c.title)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The household journal (roadmap Phase 13) shows the new events
-- ---------------------------------------------------------------------------

create function private.journal_shopping_item(snapshot jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'name', snapshot ->> 'name',
    'quantity', snapshot ->> 'quantity',
    'assignee_id', snapshot ->> 'assignee_id'
  );
$$;

create function private.journal_chore(snapshot jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'title', snapshot ->> 'title',
    'assignee_id', snapshot ->> 'assignee_id',
    'due_on', snapshot ->> 'due_on',
    'priority', snapshot ->> 'priority'
  );
$$;

-- Same signature, grants and behaviour as in 20261117120100, plus the
-- shopping and chore events (filters 'shopping' and 'chores'), their fields,
-- and the item's or chore's state now.
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
  shown_types public.activity_event_type[];
  cursor_at timestamptz;
  today date;
  result jsonb;
begin
  if (select auth.uid()) is null or not private.is_household_member(target_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if category_filter is not null
    and category_filter not in ('expenses', 'settlements', 'bills', 'shopping', 'chores', 'household')
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
    when 'household' then household_types
    else household_types || expense_types || settlement_types || bill_types
      || shopping_types || chore_types
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

alter table public.shopping_items enable row level security;
alter table public.chores enable row level security;

create policy "Members read their household's shopping list"
on public.shopping_items for select to authenticated
using (private.is_household_member(household_id));

create policy "Members read their household's chores"
on public.chores for select to authenticated
using (private.is_household_member(household_id));

revoke all on table public.shopping_items, public.chores from anon, authenticated;
grant all on table public.shopping_items, public.chores to service_role;
grant select on table public.shopping_items, public.chores to authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function private.lock_shopping_item(uuid) from public;
revoke all on function private.lock_chore(uuid) from public;
revoke all on function private.can_manage_chore(public.chores) from public;
revoke all on function private.can_finish_chore(public.chores) from public;
revoke all on function private.check_assignee(uuid, uuid) from public;
revoke all on function private.shopping_item_snapshot(uuid) from public;
revoke all on function private.chore_snapshot(uuid) from public;
revoke all on function private.journal_shopping_item(jsonb) from public;
revoke all on function private.journal_chore(jsonb) from public;
-- household_journal runs as the caller, so the caller needs these two. They
-- read no table, and the private schema isn't exposed through the Data API.
grant execute on function private.journal_shopping_item(jsonb) to authenticated;
grant execute on function private.journal_chore(jsonb) to authenticated;

revoke all on function public.add_shopping_item(uuid, text, text, text, uuid, uuid) from public, anon;
revoke all on function public.update_shopping_item(uuid, text, text, text, uuid, timestamptz) from public, anon;
revoke all on function public.purchase_shopping_item(uuid) from public, anon;
revoke all on function public.reopen_shopping_item(uuid) from public, anon;
revoke all on function public.remove_shopping_item(uuid) from public, anon;
revoke all on function public.create_chore(uuid, text, text, uuid, date, public.chore_priority, uuid) from public, anon;
revoke all on function public.update_chore(uuid, text, text, uuid, date, public.chore_priority, timestamptz) from public, anon;
revoke all on function public.complete_chore(uuid) from public, anon;
revoke all on function public.reopen_chore(uuid) from public, anon;
revoke all on function public.remove_chore(uuid) from public, anon;

grant execute on function public.add_shopping_item(uuid, text, text, text, uuid, uuid) to authenticated;
grant execute on function public.update_shopping_item(uuid, text, text, text, uuid, timestamptz) to authenticated;
grant execute on function public.purchase_shopping_item(uuid) to authenticated;
grant execute on function public.reopen_shopping_item(uuid) to authenticated;
grant execute on function public.remove_shopping_item(uuid) to authenticated;
grant execute on function public.create_chore(uuid, text, text, uuid, date, public.chore_priority, uuid) to authenticated;
grant execute on function public.update_chore(uuid, text, text, uuid, date, public.chore_priority, timestamptz) to authenticated;
grant execute on function public.complete_chore(uuid) to authenticated;
grant execute on function public.reopen_chore(uuid) to authenticated;
grant execute on function public.remove_chore(uuid) to authenticated;

-- create or replace keeps existing grants; restated for clarity.
revoke all on function public.household_journal(uuid, text, bigint, uuid, integer) from public, anon;
grant execute on function public.household_journal(uuid, text, bigint, uuid, integer) to authenticated;
