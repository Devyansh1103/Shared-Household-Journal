-- Roadmap Phase 16: types for budgets.
--
-- In a file of their own: a new enum value can't be used in the transaction
-- that adds it, and the next migration's functions use these.
--
-- Additive: one type and new enum values.

-- D29: the periods a budget can cover (weekly, monthly, quarterly; approved
-- by the owner on 2026-11-13).
create type public.budget_period as enum ('week', 'month', 'quarter');

-- The journal (roadmap Phase 13) records each change.
alter type public.activity_event_type add value 'budget_created';
alter type public.activity_event_type add value 'budget_updated';
alter type public.activity_event_type add value 'budget_archived';
alter type public.activity_entity_type add value 'budget';
