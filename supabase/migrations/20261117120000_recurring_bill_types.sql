-- Roadmap Phase 14: types for recurring bills (D10, ADR-010).
--
-- In a file of their own: a new enum value can't be used in the transaction
-- that adds it, and the next migration's functions use these.
--
-- Additive: one type and new enum values.

-- D10: a bill repeats weekly, monthly or yearly, every N of them.
create type public.bill_frequency as enum ('week', 'month', 'year');

-- The journal (roadmap Phase 13) records each change to a bill.
alter type public.activity_event_type add value 'bill_created';
alter type public.activity_event_type add value 'bill_updated';
alter type public.activity_event_type add value 'bill_paused';
alter type public.activity_event_type add value 'bill_resumed';
alter type public.activity_event_type add value 'bill_ended';
alter type public.activity_event_type add value 'bill_skipped';
alter type public.activity_event_type add value 'bill_unskipped';
alter type public.activity_entity_type add value 'recurring_bill';
