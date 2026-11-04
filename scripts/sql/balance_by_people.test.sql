-- Tests for sql/2026-11-04_balance_by_people.sql. NEVER COMMITS.
-- Run as ONE statement in the Supabase SQL tool:
--   begin; set local lock_timeout = '3s'; set local statement_timeout = '60s';
--   <sql/2026-11-04_balance_by_people.sql> <this file> rollback;
-- Throwaway Sundays sit in 2099 (location 'BAL TEST') and the members use
-- @bal.lfg.invalid addresses; the rollback removes every row and the function change.
create temp table _t (n serial, name text, ok boolean, detail text) on commit drop;
create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$ insert into _t(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;

do $test$
declare
  m uuid[]; s1 uuid; s2 uuid; s3 uuid; r jsonb; i int; k int := 0; sec text; n int;
begin
  select array_agg(gen_random_uuid()) into m from generate_series(1, 60);
  for i in 1..60 loop
    insert into auth.users(id, email) values (m[i], 'bal-' || m[i] || '@bal.lfg.invalid');
    insert into public.members(id, email, full_name) values (m[i], 'bal-' || m[i] || '@bal.lfg.invalid', 'Bal ' || i);
    insert into public.member_packages(member_id, package_id, sessions_total, sessions_remaining, expires_at, status)
    values (m[i], null, 5, 5, now() + interval '30 days', 'active');
  end loop;

  -- ------------------------------------------------ 8 Nov, scaled: 6 stations, 8 a station
  -- Booked A5 B4 C5 D2 E4 F2. Friends' invite links hold A1 B2 C1 D4 E1 F4, so the old
  -- balancer read D and F as 6 and opened only E (5), for one booking.
  insert into public.sessions(session_date, start_time, location, capacity, max_capacity, stations, status)
  values ('2099-02-01', '12:45', 'BAL TEST', 48, 48, 6, 'open') returning id into s1;
  foreach sec in array array['A','B','C','D','E','F'] loop
    n := case sec when 'A' then 5 when 'B' then 4 when 'C' then 5 when 'D' then 2 when 'E' then 4 else 2 end;
    for i in 1..n loop
      k := k + 1;
      insert into public.bookings(member_id, session_id, section, payment_type, amount_paid_aed, status)
      values (m[k], s1, sec, 'free', 0, 'booked');
    end loop;
    foreach n in array case sec when 'A' then array[1] when 'B' then array[2] when 'C' then array[1]
                                when 'D' then array[2,2] when 'E' then array[1] else array[2,2] end loop
      insert into public.booking_holds(session_id, section, host_member_id, token, spots, kind, expires_at)
      values (s1, sec, m[k], md5(random()::text) || md5(random()::text), n, 'invite', now() + interval '24 hours');
    end loop;
  end loop;
  perform pg_temp.chk('held spots still count as taken', public.session_station_counts(s1, 6) = array[6,6,6,6,5,6],
    public.session_station_counts(s1, 6)::text);

  r := public.book_with_credit(m[50], s1, 'E');
  perform pg_temp.chk('E waits: it has more people than D and F', (r->>'ok')::boolean = false
    and r->>'error' = 'Station E is waiting for the others to fill. Pick station D or F'
    and r->'open_stations' = '["D","F"]'::jsonb, r::text);
  r := public.book_with_credit(m[50], s1, 'D');
  perform pg_temp.chk('D takes the booking', (r->>'ok')::boolean and r->>'section' = 'D', r::text);
  r := public.book_paid(m[51], s1, 'E', 89);
  perform pg_temp.chk('a paid card for E lands on the station with the fewest people (F)',
    (r->>'ok')::boolean and r->>'section' = 'F', r::text);
  update public.sessions set is_free = true where id = s1;
  r := public.book_free(m[52], s1, 'A');
  perform pg_temp.chk('free booking: A waits too', (r->>'ok')::boolean = false
    and r->>'error' = 'Station A is waiting for the others to fill. Pick station D or F', r::text);
  r := public.book_free(m[52], s1, 'F');
  perform pg_temp.chk('free booking on F', (r->>'ok')::boolean and r->>'section' = 'F', r::text);

  -- ------------------------------------------------ a station whose room is all held
  -- 4 stations, 4 a station: A has nobody booked and 4 spots held for a group checkout.
  insert into public.sessions(session_date, start_time, location, capacity, max_capacity, stations, status)
  values ('2099-02-08', '12:45', 'BAL TEST', 16, 16, 4, 'open') returning id into s2;
  foreach sec in array array['B','C','D'] loop
    for i in 1..2 loop
      k := k + 1;
      insert into public.bookings(member_id, session_id, section, payment_type, amount_paid_aed, status)
      values (m[k], s2, sec, 'free', 0, 'booked');
    end loop;
  end loop;
  insert into public.booking_holds(session_id, section, host_member_id, token, spots, kind, expires_at)
  values (s2, 'A', m[49], md5(random()::text) || md5(random()::text), 4, 'checkout', now() + interval '35 minutes');
  r := public.book_with_credit(m[53], s2, 'B');
  perform pg_temp.chk('a full station never holds the others back', (r->>'ok')::boolean and r->>'section' = 'B', r::text);
  r := public.book_with_credit(m[54], s2, 'A');
  perform pg_temp.chk('held spots still fill the station cap', (r->>'ok')::boolean = false
    and r->>'error' like 'Station A is full.%', r::text);

  -- ------------------------------------------------ an odd station waits like the rest
  -- 4 stations, 8 a station, booked A7 B2 C2 D2: A used to open for one more to finish its
  -- pair while B, C and D had 5 fewer people.
  insert into public.sessions(session_date, start_time, location, capacity, max_capacity, stations, status)
  values ('2099-02-15', '12:45', 'BAL TEST', 32, 32, 4, 'open') returning id into s3;
  foreach sec in array array['A','B','C','D'] loop
    for i in 1..(case when sec = 'A' then 7 else 2 end) loop
      k := k + 1;
      insert into public.bookings(member_id, session_id, section, payment_type, amount_paid_aed, status)
      values (m[k], s3, sec, 'free', 0, 'booked');
    end loop;
  end loop;
  r := public.book_with_credit(m[55], s3, 'A');
  perform pg_temp.chk('A (7) waits for B, C and D (2)', (r->>'ok')::boolean = false
    and r->>'error' = 'Station A is waiting for the others to fill. Pick station B or C or D', r::text);
  r := public.book_with_credit(m[55], s3, 'B');
  perform pg_temp.chk('B takes it', (r->>'ok')::boolean and r->>'section' = 'B', r::text);

  -- ------------------------------------------------ the function itself
  perform pg_temp.chk('the old three-argument balancer is gone',
    to_regprocedure('public.balanced_open_stations(int,int,int[])') is null);
  perform pg_temp.chk('only the database runs the balancer',
    case when to_regprocedure('public.balanced_open_stations(int,int,int[],int[])') is null then false
         else not has_function_privilege('anon', 'public.balanced_open_stations(int,int,int[],int[])', 'execute')
          and not has_function_privilege('authenticated', 'public.balanced_open_stations(int,int,int[],int[])', 'execute') end);

  -- ------------------------------------------------ verdict
  if exists (select 1 from _t where not ok) then
    raise exception 'BALANCE-BY-PEOPLE SQL TESTS FAILED: %',
      (select string_agg(n || ' ' || name || coalesce(' :: ' || detail, ''), ' | ' order by n) from _t where not ok);
  end if;
end $test$;

select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed,
       (select count(*) from public.sessions where location = 'BAL TEST') as throwaway_sessions_in_txn
  from _t;
