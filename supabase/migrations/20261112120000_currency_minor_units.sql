-- Phase 9 (split engine hardening): a household's currency must have an ISO
-- 4217 minor unit (D2). Amounts are stored as integer minor units, so a code
-- without one (precious metals, SDR, bond-market units, test codes) can't hold
-- money. The app never offers these (src/domain/money/currency.ts,
-- NO_MINOR_UNIT, kept in sync by src/domain/money/currency.test.ts); this
-- check stops a direct API call from setting one.
--
-- Additive: a new check constraint. No existing household uses these codes.

alter table public.households
  add constraint households_currency_has_minor_unit
  check (currency_code not in (
    'XAG', 'XAU', 'XBA', 'XBB', 'XBC', 'XBD', 'XDR',
    'XPD', 'XPT', 'XSU', 'XTS', 'XUA', 'XXX'
  ));
