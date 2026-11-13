# ADR-011: In-app notifications only for the first release

- **Status:** Confirmed (2026-11-02). Decision D12.

## Context

- PRD §11 and TRD §12 leave the notification channels and provider undecided.

## Options

- In-app only
- Email (Resend or Supabase)
- Push notifications

## Decision

- Notifications are in-app only.
- Each notification row links to an `activity_events` row.
- Each user can switch notifications on or off per household and per notification type.

## Consequences

- No third-party provider is needed.
- No personal data leaves the system.
- Adding email or push later needs a new ADR, covering the provider and privacy review.

## Repository evidence

Implemented 2026-11-13 (roadmap Phase 17): `notifications` (one row per recipient and
`activity_events` row) and `notification_preferences` (per person, household and type) in
[20261120120000_notifications.sql](../../supabase/migrations/20261120120000_notifications.sql);
who is notified is D30. In the app only: no email, push or real-time channel exists. See
[notifications.md](../notifications.md). Sources: PRD §11, TRD §12.
