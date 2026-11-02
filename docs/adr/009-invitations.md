# ADR-009: Invitations — expiring, revocable, limited-use links with stored hashes

- **Status:** Confirmed (2026-11-02). Decision D5.

## Context
TRD §4 requires invite tokens to be:
- unguessable
- time-limited
- single-use or otherwise safely managed

## Options
- Email invites (needs an email provider)
- Single-use links
- Multi-use links with a cap

## Decision
- **Token:** 32 random bytes. The database stores only the SHA-256 hash. The raw link is shown once.
- **Expiry and use limit:** a link expires after 7 days and can be used at most 10 times. Both are stored as `max_uses` and `use_count`.
- **Revocation:** a link can be revoked by setting `revoked_at`.
- **Joining:** the user must be signed in. `accept_invite` checks expiry, the use limit and revocation in a single transaction, so two people can't redeem the last use at the same time.
- **Invalid links:** an expired or revoked link shows a clear message asking the user to get a new link from a household member.

## Consequences
- No email provider is needed for the first release.
- Email delivery can be added later on top of the same token model.

## Repository evidence
None in code (see [phase-0 audit](../audits/phase-0.md)). Source: TRD §4.
