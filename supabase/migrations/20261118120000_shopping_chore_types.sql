-- Roadmap Phase 15: types for the shopping list and chores.
--
-- In a file of their own: a new enum value can't be used in the transaction
-- that adds it, and the next migration's functions use these.
--
-- Additive: one type and new enum values.

-- D28 (proposed): how urgent a chore is.
create type public.chore_priority as enum ('low', 'medium', 'high');

-- The journal (roadmap Phase 13) records each change.
alter type public.activity_event_type add value 'shopping_item_added';
alter type public.activity_event_type add value 'shopping_item_updated';
alter type public.activity_event_type add value 'shopping_item_purchased';
alter type public.activity_event_type add value 'shopping_item_reopened';
alter type public.activity_event_type add value 'shopping_item_removed';
alter type public.activity_event_type add value 'chore_created';
alter type public.activity_event_type add value 'chore_updated';
alter type public.activity_event_type add value 'chore_completed';
alter type public.activity_event_type add value 'chore_reopened';
alter type public.activity_event_type add value 'chore_removed';
alter type public.activity_entity_type add value 'shopping_item';
alter type public.activity_entity_type add value 'chore';
