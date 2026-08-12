-- Tie a run payment to the specific run it was for. Lets the admin roster + the double-charge
-- guard read the payments table (money source of truth) precisely per run, instead of relying
-- only on the run_rsvps.paid side-effect (which can lag if the webhook rsvp-write fails).
-- Applied to prod 2026-07-06, then backfilled existing paid run payments to '2026-07-08'.
alter table payments add column if not exists run_date date;
