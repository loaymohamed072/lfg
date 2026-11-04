-- Stations past D (Loay, 4 Nov 2026): bookings.section only allowed A-D, so on a Sunday with
-- more than 4 stations every booking on E or F failed with bookings_section_check. On 8 Nov
-- the balancer closed A-D at 4 each and opened only E and F, so nobody could book at all.
-- book_free, book_with_credit, book_paid and book_from_hold already refuse a station the
-- Sunday does not have (stations is 2-12, set by /api/admin/set-stations), so the table
-- only needs to accept the letter.

alter table public.bookings drop constraint if exists bookings_section_check;
alter table public.bookings add constraint bookings_section_check
  check (section ~ '^[A-Z]$');
