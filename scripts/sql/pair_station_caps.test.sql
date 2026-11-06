-- Tests for sql/2026-11-06_pair_station_caps.sql. NEVER COMMITS.
-- Run as ONE statement in the Supabase SQL tool:
--   begin; set local lock_timeout = '3s'; set local statement_timeout = '60s';
--   <sql/2026-11-06_pair_station_caps.sql> <this file> rollback;
-- Throwaway Sundays in 2099 (location 'PSC TEST'), members on @psc.lfg.invalid.
create temp table _t (n serial, name text, ok boolean, detail text) on commit drop;
create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$ insert into _t(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;

do $test$
declare caps int[]; s uuid; c int; mx int; m uuid[]; r jsonb; i int;
begin
  select array_agg(public.section_cap(162, k, 6) order by k) into caps from generate_series(0, 5) g(k);
  perform pg_temp.chk('162 on 6 stations splits 28,28,28,26,26,26', caps = array[28,28,28,26,26,26], caps::text);
  select array_agg(public.section_cap(156, k, 6) order by k) into caps from generate_series(0, 5) g(k);
  perform pg_temp.chk('156 on 6 stations still splits 26 each', caps = array[26,26,26,26,26,26], caps::text);
  select array_agg(public.section_cap(45, k, 4) order by k) into caps from generate_series(0, 3) g(k);
  perform pg_temp.chk('an odd total puts the single after the extra pairs', caps = array[12,12,11,10], caps::text);

  perform pg_temp.chk('162 with A-F at 26 opens A, B, C only',
    public.balanced_open_stations(162, 6, array[26,26,26,26,26,26], array[26,26,26,26,26,26]) = array['A','B','C'],
    public.balanced_open_stations(162, 6, array[26,26,26,26,26,26], array[26,26,26,26,26,26])::text);
  perform pg_temp.chk('162 with every station at its cap opens nothing',
    cardinality(public.balanced_open_stations(162, 6, array[28,28,28,26,26,26], array[28,28,28,26,26,26])) = 0);

  insert into public.sessions(session_date, start_time, location, capacity, max_capacity, stations, status)
  values ('2099-04-05', '12:45', 'PSC TEST', 156, 156, 6, 'open') returning id into s;
  update public.sessions set capacity = 162, max_capacity = 162 where id = s;
  select capacity, max_capacity into c, mx from public.sessions where id = s;
  perform pg_temp.chk('a hand-set 162 ceiling stays 162', c = 162 and mx = 162, c || '/' || mx);
  update public.sessions set capacity = 163, max_capacity = 163 where id = s;
  select capacity into c from public.sessions where id = s;
  perform pg_temp.chk('an odd ceiling still rounds up to a multiple of 12', c = 168, c::text);
  update public.sessions set capacity = 162, max_capacity = 162 where id = s;
  update public.sessions set stations = 4 where id = s;
  select capacity, max_capacity into c, mx from public.sessions where id = s;
  perform pg_temp.chk('a station-count change still rounds up (162 on 4 -> 168)', c = 168 and mx = 168, c || '/' || mx);

  insert into public.sessions(session_date, start_time, location, capacity, max_capacity, stations, status)
  values ('2099-04-12', '12:45', 'PSC TEST', 40, 96, 4, 'open') returning id into s;
  update public.sessions set capacity = 50 where id = s;
  select capacity into c from public.sessions where id = s;
  perform pg_temp.chk('the auto-bump below the ceiling still rounds 50 to 56', c = 56, c::text);
  update public.sessions set capacity = least(88 + 10, 96) where id = s;
  select capacity into c from public.sessions where id = s;
  perform pg_temp.chk('the auto-bump stops at the 96 ceiling', c = 96, c::text);

  -- Booking through the real RPC: 10 on 4 stations is 4,2,2,2. Two rounds fill every
  -- station to 2; then B is at its cap and refuses, while A still takes a third.
  select array_agg(gen_random_uuid()) into m from generate_series(1, 10);
  for i in 1..10 loop
    insert into auth.users(id, email) values (m[i], 'psc-' || m[i] || '@psc.lfg.invalid');
    insert into public.members(id, email, full_name) values (m[i], 'psc-' || m[i] || '@psc.lfg.invalid', 'Psc ' || i);
  end loop;
  insert into public.sessions(session_date, start_time, location, capacity, max_capacity, stations, status, is_free)
  values ('2099-04-19', '12:45', 'PSC TEST', 10, 10, 4, 'open', true) returning id into s;
  select capacity into c from public.sessions where id = s;
  perform pg_temp.chk('a new Sunday set to 10/10 on 4 stations keeps 10', c = 10, c::text);
  for i in 1..8 loop
    r := public.book_free(m[i], s, chr(64 + 1 + (i - 1) % 4));
    if not coalesce((r->>'ok')::boolean, false) then
      perform pg_temp.chk('round booking ' || i || ' goes in', false, r::text);
    end if;
  end loop;
  r := public.book_free(m[9], s, 'B');
  perform pg_temp.chk('station B refuses a third (cap 2)', not coalesce((r->>'ok')::boolean, false), r::text);
  r := public.book_free(m[9], s, 'A');
  perform pg_temp.chk('station A takes a third (cap 4)', coalesce((r->>'ok')::boolean, false), r::text);
end $test$;

select n, name, ok, left(detail, 200) detail from _t order by n;
