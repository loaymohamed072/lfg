-- Tests for sql/2026-11-06_free_sunday_short_holds.sql. NEVER COMMITS.
-- Run as ONE statement in the Supabase SQL tool:
--   begin; set local lock_timeout = '3s'; set local statement_timeout = '60s';
--   <sql/2026-11-06_free_sunday_short_holds.sql> <this file> rollback;
-- Throwaway Sundays in 2099 (location 'SHH TEST'), members on @shh.lfg.invalid.
create temp table _t (n serial, name text, ok boolean, detail text) on commit drop;
create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$ insert into _t(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;

do $test$
declare m uuid[]; free_s uuid; paid_s uuid; r jsonb; e timestamptz; i int;
begin
  select array_agg(gen_random_uuid()) into m from generate_series(1, 3);
  for i in 1..3 loop
    insert into auth.users(id, email) values (m[i], 'shh-' || m[i] || '@shh.lfg.invalid');
    insert into public.members(id, email, full_name) values (m[i], 'shh-' || m[i] || '@shh.lfg.invalid', 'Shh ' || i);
    insert into public.member_packages(member_id, package_id, sessions_total, sessions_remaining, expires_at, status)
    values (m[i], null, 5, 5, now() + interval '30 days', 'active');
  end loop;
  insert into public.sessions(session_date, start_time, location, capacity, max_capacity, stations, status, is_free)
  values ('2099-03-22', '12:45', 'SHH TEST', 32, 32, 4, 'open', true) returning id into free_s;
  insert into public.sessions(session_date, start_time, location, capacity, max_capacity, stations, status, is_free)
  values ('2099-03-29', '12:45', 'SHH TEST', 32, 32, 4, 'open', false) returning id into paid_s;

  r := public.book_free(m[1], free_s, 'A');
  r := public.create_booking_hold(m[1], free_s, 'invite', 2, 0);
  select expires_at into e from public.booking_holds where id = (r->>'hold_id')::uuid;
  perform pg_temp.chk('a free Sunday holds a friend''s spot 6 hours', (r->>'ok')::boolean and e = now() + interval '6 hours', r::text || ' ' || e::text);

  r := public.book_with_credit(m[2], paid_s, 'A');
  r := public.create_booking_hold(m[2], paid_s, 'invite', 2, 89);
  select expires_at into e from public.booking_holds where id = (r->>'hold_id')::uuid;
  perform pg_temp.chk('any other Sunday still holds 24 hours', (r->>'ok')::boolean and e = now() + interval '24 hours', r::text || ' ' || e::text);
end $test$;

select n, name, ok, left(detail, 200) detail from _t order by n;
