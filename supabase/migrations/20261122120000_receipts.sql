-- Roadmap Phase 19: receipts (D31, decided by the owner 2026-11-14; D15
-- amended the same day: OCR runs on the person's own device, so no household
-- data goes to an OCR or AI service).
--
-- A receipt is an image (JPEG, PNG or WebP; PDFs are turned into an image in
-- the browser first) in the private "receipts" Storage bucket, with one row
-- here. The app checks the file before storing it; the row says who uploaded
-- it, for which household, and what became of it:
--
--   pending   the row exists; the file is being stored
--   uploaded  the file is stored and waiting for review (only its uploader
--             sees it); unused ones are cleared after 24 hours
--   attached  it belongs to an expense; every active member can see it
--   removed   it was taken off its expense (the file is deleted); the row
--             stays as a record of who removed it and when
--
-- Reading text from the image happens in the browser, and what it reads is
-- only a suggestion: the person reviews it in the usual expense form, and
-- create_expense_with_receipt() records that expense (through create_expense,
-- with every money rule) and attaches the receipt in one transaction.
-- Receipts never affect amounts, splits or balances.
--
-- Files: <household id>/<receipt id>.<ext>, fixed by a check, so a path can't
-- be chosen. Storage policies below let a file be stored, read or deleted
-- only when its row allows it. Files are deleted through the Storage API
-- (never with SQL), by the app's server acting as the signed-in person.
--
-- Additive: one type, one table, functions, policies and a bucket. No
-- existing table, function or row changes.
--
-- New error codes:
--   HJ035  no such receipt (also other households' and other people's)
--   HJ036  the receipt can't be used that way now (wrong state)
--   HJ037  too many receipts waiting for review
--   HJ038  the receipt's file isn't stored as described

create type public.receipt_status as enum ('pending', 'uploaded', 'attached', 'removed');

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  storage_path text not null,
  content_type text not null,
  byte_size integer not null,
  width integer not null,
  height integer not null,
  status public.receipt_status not null default 'pending',
  expense_id uuid,
  creation_key uuid,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  attached_at timestamptz,
  attached_by uuid references public.profiles (id) on delete restrict,
  removed_at timestamptz,
  removed_by uuid references public.profiles (id) on delete restrict,

  constraint receipts_storage_path_key unique (storage_path),
  constraint receipts_creation_key unique (uploaded_by, creation_key),
  constraint receipts_expense_fkey foreign key (expense_id, household_id)
    references public.expenses (id, household_id) on delete cascade,
  constraint receipts_content_type_check
    check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  -- 4 MiB: the app shrinks photos below this before uploading.
  constraint receipts_byte_size_check check (byte_size between 1 and 4194304),
  constraint receipts_dimensions_check
    check (width between 1 and 8000 and height between 1 and 8000),
  constraint receipts_storage_path_check check (
    storage_path = household_id::text || '/' || id::text || case content_type
      when 'image/jpeg' then '.jpg'
      when 'image/png' then '.png'
      else '.webp'
    end
  ),
  constraint receipts_status_check check (
    case status
      when 'pending' then expense_id is null and uploaded_at is null
        and attached_at is null and removed_at is null
      when 'uploaded' then expense_id is null and uploaded_at is not null
        and attached_at is null and removed_at is null
      when 'attached' then expense_id is not null and uploaded_at is not null
        and attached_at is not null and attached_by is not null and removed_at is null
      else removed_at is not null and removed_by is not null
    end
  )
);

comment on table public.receipts is
  'Receipt images (D31) in the private receipts bucket: who uploaded them, for which household and expense. Never part of any amount or balance.';

-- One receipt per expense at a time.
create unique index receipts_one_per_expense_idx
  on public.receipts (expense_id) where status = 'attached';
create index receipts_household_status_idx on public.receipts (household_id, status);
create index receipts_uploader_status_idx on public.receipts (uploaded_by, status, created_at);
create index receipts_expense_idx on public.receipts (expense_id) where expense_id is not null;
create index receipts_attached_by_idx on public.receipts (attached_by) where attached_by is not null;
create index receipts_removed_by_idx on public.receipts (removed_by) where removed_by is not null;

alter table public.receipts enable row level security;

-- Attached receipts (and the record of removed ones) for every active member;
-- one waiting for review only for the person who uploaded it.
create policy "Members read their household's receipts"
on public.receipts for select to authenticated
using (
  private.is_household_member(household_id)
  and (
    status in ('attached', 'removed')
    or uploaded_by = (select auth.uid())
  )
);

revoke all on table public.receipts from anon, authenticated, public;
grant select on table public.receipts to authenticated;

-- ---------------------------------------------------------------------------
-- The bucket: private, images only, 4 MiB at most (a second line of defence
-- after the app's own checks)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 4194304, array['image/jpeg', 'image/png', 'image/webp']);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The caller is the household's owner and its only active member: the one
-- moment the household can be deleted (D14).
create function private.is_sole_owner(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.household_role(target_household_id) = 'owner'
    and (
      select count(*) from public.household_members m
      where m.household_id = target_household_id and m.left_at is null
    ) = 1;
$$;

-- Whether the signed-in person may store, read or delete the file at
-- `object_name`. Storage policies call it; it looks only at that file's row.
create function private.receipt_file_allowed(object_name text, action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case action
      -- Only the uploader, once, while the row waits for its file.
      when 'insert' then r.status = 'pending'
        and r.uploaded_by = (select auth.uid())
        and private.is_active_member(r.household_id, (select auth.uid()))
      when 'select' then
        (r.status = 'attached'
          and private.is_active_member(r.household_id, (select auth.uid())))
        or (r.status in ('pending', 'uploaded')
          and r.uploaded_by = (select auth.uid())
          and private.is_active_member(r.household_id, (select auth.uid())))
        or (r.status = 'removed' and r.removed_by = (select auth.uid()))
        or private.is_sole_owner(r.household_id)
      when 'delete' then
        -- Your own unused upload, even after leaving the household.
        (r.status in ('pending', 'uploaded') and r.uploaded_by = (select auth.uid()))
        or (r.status = 'removed' and r.removed_by = (select auth.uid()))
        -- The owner, alone, deleting the household.
        or private.is_sole_owner(r.household_id)
      else false
    end
    from public.receipts r
    where r.storage_path = object_name
  ), false);
$$;

-- A receipt the caller uploaded and hasn't used yet, locked.
create function private.lock_own_receipt(target_receipt_id uuid)
returns public.receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  r public.receipts%rowtype;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into r from public.receipts x where x.id = target_receipt_id for update;
  if not found
    or r.uploaded_by <> caller
    or not private.is_active_member(r.household_id, caller)
  then
    raise exception 'No such receipt' using errcode = 'HJ035';
  end if;
  return r;
end;
$$;

-- Whether the stored file is the one that was checked.
create function private.receipt_file_matches(r public.receipts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from storage.objects o
    where o.bucket_id = 'receipts'
      and o.name = r.storage_path
      and (o.metadata ->> 'size')::bigint = r.byte_size
      and o.metadata ->> 'mimetype' = r.content_type
  );
$$;

revoke all on function private.receipt_file_allowed(text, text) from public, anon;
revoke all on function private.is_sole_owner(uuid) from public, anon;
revoke all on function private.lock_own_receipt(uuid) from public, anon, authenticated;
revoke all on function private.receipt_file_matches(public.receipts) from public, anon, authenticated;
-- Storage policies run as the signed-in person.
grant execute on function private.receipt_file_allowed(text, text) to authenticated;
grant execute on function private.is_sole_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage policies: nothing is reachable except through these
-- ---------------------------------------------------------------------------

create policy "Receipts: store the file for your own pending receipt"
on storage.objects for insert to authenticated
with check (bucket_id = 'receipts' and private.receipt_file_allowed(name, 'insert'));

create policy "Receipts: read files you may see"
on storage.objects for select to authenticated
using (bucket_id = 'receipts' and private.receipt_file_allowed(name, 'select'));

create policy "Receipts: delete files you may delete"
on storage.objects for delete to authenticated
using (bucket_id = 'receipts' and private.receipt_file_allowed(name, 'delete'));

-- No update policy: a stored file is never overwritten.

-- ---------------------------------------------------------------------------
-- Uploading
-- ---------------------------------------------------------------------------

-- Starts a receipt for a checked image; the app then stores the file at the
-- returned path and calls mark_receipt_uploaded. A repeated request_key
-- returns the same receipt. At most 10 of your receipts may wait for review
-- in a household at once.
create function public.create_receipt(
  target_household_id uuid,
  content_type text,
  byte_size integer,
  width integer,
  height integer,
  request_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  r public.receipts%rowtype;
  new_id uuid := gen_random_uuid();
begin
  if caller is null or not private.is_active_member(target_household_id, caller) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if request_key is not null then
    select * into r from public.receipts x
    where x.uploaded_by = caller and x.creation_key = request_key;
    if found then
      if r.household_id <> target_household_id then
        raise exception 'No such receipt' using errcode = 'HJ035';
      end if;
      return jsonb_build_object('receipt_id', r.id, 'storage_path', r.storage_path, 'status', r.status);
    end if;
  end if;

  if (
    select count(*) from public.receipts x
    where x.household_id = target_household_id
      and x.uploaded_by = caller
      and x.status in ('pending', 'uploaded')
      and x.created_at > now() - interval '24 hours'
  ) >= 10 then
    raise exception 'Too many receipts are waiting for review' using errcode = 'HJ037';
  end if;

  insert into public.receipts (
    id, household_id, uploaded_by, storage_path, content_type, byte_size,
    width, height, creation_key
  )
  values (
    new_id, target_household_id, caller,
    target_household_id::text || '/' || new_id::text || case content_type
      when 'image/jpeg' then '.jpg'
      when 'image/png' then '.png'
      else '.webp'
    end,
    content_type, byte_size, width, height, request_key
  )
  returning * into r;

  return jsonb_build_object('receipt_id', r.id, 'storage_path', r.storage_path, 'status', r.status);
end;
$$;

-- The file is stored: checked against what was declared (size and type).
create function public.mark_receipt_uploaded(target_receipt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.receipts%rowtype;
begin
  r := private.lock_own_receipt(target_receipt_id);
  if r.status <> 'pending' then
    if r.status = 'uploaded' then return; end if;
    raise exception 'The receipt can''t be used that way now' using errcode = 'HJ036';
  end if;
  if not private.receipt_file_matches(r) then
    raise exception 'The receipt''s file isn''t stored' using errcode = 'HJ038';
  end if;
  update public.receipts x set status = 'uploaded', uploaded_at = now() where x.id = r.id;
end;
$$;

-- Drops your own receipt that isn't on an expense (after the app has deleted
-- its file).
create function public.discard_receipt(target_receipt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.receipts%rowtype;
begin
  r := private.lock_own_receipt(target_receipt_id);
  if r.status not in ('pending', 'uploaded') then
    raise exception 'The receipt can''t be used that way now' using errcode = 'HJ036';
  end if;
  delete from public.receipts x where x.id = r.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Using a receipt
-- ---------------------------------------------------------------------------

-- Records the reviewed expense (create_expense: membership, D6, the split,
-- the journal and notifications as usual) and attaches the receipt, in one
-- transaction: if the expense is refused, the receipt stays as it was. A
-- receipt already attached returns its expense, so a second confirmation
-- records nothing new.
create function public.create_expense_with_receipt(
  target_receipt_id uuid,
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
  r public.receipts%rowtype;
  new_expense_id uuid;
begin
  r := private.lock_own_receipt(target_receipt_id);
  if r.status = 'attached' then
    return r.expense_id;
  end if;
  if r.status <> 'uploaded' then
    raise exception 'The receipt can''t be used that way now' using errcode = 'HJ036';
  end if;

  new_expense_id := public.create_expense(
    r.household_id, title, amount, expense_category, spent_on, payer_id,
    method, shares, request_key
  );
  update public.receipts x
  set status = 'attached', expense_id = new_expense_id, attached_at = now(), attached_by = caller
  where x.id = r.id;
  return new_expense_id;
end;
$$;

-- Attaches your uploaded receipt to an existing expense (D6: its creator,
-- its payer or the owner). A receipt already on it is replaced: marked
-- removed, and its file's path is returned for the app to delete.
create function public.attach_receipt(target_expense_id uuid, target_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  e public.expenses%rowtype;
  r public.receipts%rowtype;
  previous public.receipts%rowtype;
begin
  e := private.lock_expense_for_change(target_expense_id);
  if not private.can_change_expense(e) then
    raise exception 'Only the person who added it, its payer or the owner can change this expense'
      using errcode = '42501';
  end if;
  if e.deleted_at is not null then
    raise exception 'The expense is deleted' using errcode = 'HJ011';
  end if;
  r := private.lock_own_receipt(target_receipt_id);
  if r.household_id <> e.household_id then
    raise exception 'No such receipt' using errcode = 'HJ035';
  end if;
  if r.status = 'attached' and r.expense_id = e.id then
    return jsonb_build_object('removed_path', null);
  end if;
  if r.status <> 'uploaded' then
    raise exception 'The receipt can''t be used that way now' using errcode = 'HJ036';
  end if;

  select * into previous from public.receipts x
  where x.expense_id = e.id and x.status = 'attached'
  for update;
  if found then
    update public.receipts x
    set status = 'removed', removed_at = now(), removed_by = caller
    where x.id = previous.id;
  end if;

  update public.receipts x
  set status = 'attached', expense_id = e.id, attached_at = now(), attached_by = caller
  where x.id = r.id;

  return jsonb_build_object('removed_path', previous.storage_path);
end;
$$;

-- Takes a receipt off its expense (D6). The expense is untouched. Returns the
-- file's path for the app to delete; the row stays as a record.
create function public.remove_receipt(target_receipt_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  r public.receipts%rowtype;
  e public.expenses%rowtype;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into r from public.receipts x where x.id = target_receipt_id;
  if not found
    or r.status <> 'attached'
    or not private.is_active_member(r.household_id, caller)
  then
    raise exception 'No such receipt' using errcode = 'HJ035';
  end if;
  -- The expense first, then the receipt: the same order as attach_receipt.
  e := private.lock_expense_for_change(r.expense_id);
  if not private.can_change_expense(e) then
    raise exception 'Only the person who added it, its payer or the owner can change this expense'
      using errcode = '42501';
  end if;
  select * into r from public.receipts x where x.id = target_receipt_id for update;
  if r.status <> 'attached' or r.expense_id <> e.id then
    raise exception 'No such receipt' using errcode = 'HJ035';
  end if;
  update public.receipts x
  set status = 'removed', removed_at = now(), removed_by = caller
  where x.id = r.id;
  return r.storage_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- Clearing files (there's no scheduler: the app does it when it can)
-- ---------------------------------------------------------------------------

-- Your files to delete: uploads unused for 24 hours, and files of receipts
-- you removed that are still stored (if deleting them failed). At most 50.
create function public.my_receipt_files_to_clear()
returns table (receipt_id uuid, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.storage_path
  from public.receipts r
  where (
      (r.uploaded_by = (select auth.uid())
        and r.status in ('pending', 'uploaded')
        and r.created_at < now() - interval '24 hours')
      or (r.removed_by = (select auth.uid()) and r.status = 'removed')
    )
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'receipts' and o.name = r.storage_path
    )
  order by r.created_at
  limit 50;
$$;

-- Drops your unused receipts older than 24 hours whose files are gone.
-- Returns how many.
create function public.forget_my_stale_receipts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  dropped integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  delete from public.receipts r
  where r.uploaded_by = (select auth.uid())
    and r.status in ('pending', 'uploaded')
    and r.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'receipts' and o.name = r.storage_path
    );
  get diagnostics dropped = row_count;
  return dropped;
end;
$$;

-- Every stored receipt file of a household its owner is about to delete
-- (the owner, alone, as delete_household requires). The app deletes them
-- before deleting the household, whose rows then cascade.
create function public.household_receipt_files(target_household_id uuid)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_sole_owner(target_household_id) then
    raise exception 'Only the owner, as the last member, can delete the household'
      using errcode = '42501';
  end if;
  return query
    select r.storage_path
    from public.receipts r
    where r.household_id = target_household_id
      and exists (
        select 1 from storage.objects o
        where o.bucket_id = 'receipts' and o.name = r.storage_path
      )
    order by r.created_at;
end;
$$;

revoke all on function public.create_receipt(uuid, text, integer, integer, integer, uuid) from public, anon;
revoke all on function public.mark_receipt_uploaded(uuid) from public, anon;
revoke all on function public.discard_receipt(uuid) from public, anon;
revoke all on function public.create_expense_with_receipt(uuid, text, bigint, public.expense_category, date, uuid, public.split_method, jsonb, uuid) from public, anon;
revoke all on function public.attach_receipt(uuid, uuid) from public, anon;
revoke all on function public.remove_receipt(uuid) from public, anon;
revoke all on function public.my_receipt_files_to_clear() from public, anon;
revoke all on function public.forget_my_stale_receipts() from public, anon;
revoke all on function public.household_receipt_files(uuid) from public, anon;

grant execute on function public.create_receipt(uuid, text, integer, integer, integer, uuid) to authenticated;
grant execute on function public.mark_receipt_uploaded(uuid) to authenticated;
grant execute on function public.discard_receipt(uuid) to authenticated;
grant execute on function public.create_expense_with_receipt(uuid, text, bigint, public.expense_category, date, uuid, public.split_method, jsonb, uuid) to authenticated;
grant execute on function public.attach_receipt(uuid, uuid) to authenticated;
grant execute on function public.remove_receipt(uuid) to authenticated;
grant execute on function public.my_receipt_files_to_clear() to authenticated;
grant execute on function public.forget_my_stale_receipts() to authenticated;
grant execute on function public.household_receipt_files(uuid) to authenticated;
