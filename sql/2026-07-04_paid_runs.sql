-- Paid runs: let a specific run (e.g. the Gems World Academy intervals session)
-- charge an entry fee via Stripe, and mark on the roster who has actually paid.
--
-- Safe + additive: run_paid defaults to false, so the normal free weekly run flow
-- is unchanged until the owner toggles a run to paid in the admin portal.

-- Roster: which RSVPs are paid (for a paid run). Free runs leave these at defaults.
alter table run_rsvps add column if not exists paid boolean not null default false;
alter table run_rsvps add column if not exists amount_aed numeric;
alter table run_rsvps add column if not exists stripe_payment_intent text;

-- Config: the owner marks the next Wednesday run as paid, sets the price + map link.
-- Venue reuses the existing event_config.location field.
alter table event_config add column if not exists run_paid boolean not null default false;
alter table event_config add column if not exists run_price_aed numeric not null default 30;
alter table event_config add column if not exists run_map_url text;

-- Allow 'run' as a payment kind (the payments.kind check previously only permitted
-- single/package/merch). Applied to prod 2026-07-04.
alter table payments drop constraint if exists payments_kind_check;
alter table payments add constraint payments_kind_check
  check (kind = any (array['single'::text, 'package'::text, 'merch'::text, 'run'::text]));
