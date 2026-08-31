-- Gate staff: let a door volunteer ("ticket master") watch the live check-in board
-- at /gate without handing them the whole admin console (members, leads, revenue,
-- promo codes, push, Stripe reconciliation).
--
-- Safe + additive: is_gate_staff defaults to false, so nobody gains access until the
-- owner flips the flag on a specific member. An admin is always treated as gate staff
-- too (see isGateStaff in api/_lib.js), so no existing admin needs this set.
--
-- PROJECT: LFG DUBAI (mqhrjliqjxcxtzorapiy), schema public. That project has no
-- lfg_dev schema, so the DDL is unqualified like the 2026-07-04 / 2026-07-06 files.

-- Who is allowed to work the door.
alter table members add column if not exists is_gate_staff boolean not null default false;

-- Who marked this person in from the gate. NULL = the runner scanned the QR poster
-- themselves (the normal path). Set only by /api/staff/mark-arrived, so a manual
-- arrival is always attributable to the staff member who made it.
alter table run_attendance add column if not exists marked_by uuid references members(id) on delete set null;

-- Grant the door to a volunteer (run per person, replace the email):
--   update members set is_gate_staff = true where lower(email) = 'volunteer@example.com';
-- Revoke:
--   update members set is_gate_staff = false where lower(email) = 'volunteer@example.com';
