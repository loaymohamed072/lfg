-- Tests for sql/2026-11-02_train_with_friends.sql. NEVER COMMITS.
-- Run as ONE statement in the Supabase SQL tool:
--   begin; set local lock_timeout = '3s'; set local statement_timeout = '60s';
--   <sql/2026-11-02_train_with_friends.sql> <this file> rollback;
-- Throwaway sessions sit in 2099 and the members use @twf.lfg.invalid addresses; the
-- rollback removes every row and every DDL change. Any failed check raises, which aborts the transaction (also a rollback).
create temp table _t (n serial, name text, ok boolean, detail text) on commit drop;
create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$ insert into _t(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;

do $test$
declare
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid;
  h uuid := gen_random_uuid();  f1 uuid := gen_random_uuid(); f2 uuid := gen_random_uuid();
  f3 uuid := gen_random_uuid(); f4 uuid := gen_random_uuid(); f5 uuid := gen_random_uuid();
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); o3 uuid := gen_random_uuid();
  o4 uuid := gen_random_uuid(); o5 uuid := gen_random_uuid();
  b uuid := gen_random_uuid();  b2 uuid := gen_random_uuid(); b3 uuid := gen_random_uuid();
  g1 uuid := gen_random_uuid(); g2 uuid := gen_random_uuid(); g3 uuid := gen_random_uuid();
  r jsonb; hold1 uuid; hold2 uuid; hold3 uuid; ck1 uuid; ck2 uuid; ck3 uuid; ok_n int; i int;
  m uuid; v int; rec record;
begin
  -- Members (auth row first: members.id references auth.users).
  foreach m in array array[h,f1,f2,f3,f4,f5,o1,o2,o3,o4,o5,b,b2,b3,g1,g2,g3] loop
    insert into auth.users(id, email) values (m, 'twf-' || m || '@twf.lfg.invalid');
    insert into public.members(id, email, full_name) values (m, 'twf-' || m || '@twf.lfg.invalid', 'Test ' || left(m::text, 4));
  end loop;
  -- Credits: everyone but f2, f4 and the group buyers.
  foreach m in array array[h,f1,f3,f5,o1,o2,o3,o4,o5] loop
    insert into public.member_packages(member_id, package_id, sessions_total, sessions_remaining, expires_at, status)
    values (m, null, 5, 5, now() + interval '30 days', 'active');
  end loop;

  insert into public.sessions(session_date, start_time, location, capacity, max_capacity, stations, status)
  values ('2099-01-04', '12:45', 'TWF TEST', 32, 32, 4, 'open') returning id into s1;
  perform pg_temp.chk('session capacity rounds to 32', (select capacity from sessions where id = s1) = 32);

  -- ------------------------------------------------ invite holds
  r := public.create_booking_hold(h, s1, 'invite', 3, 89);
  perform pg_temp.chk('invite needs the host booked', (r->>'ok')::boolean = false and r->>'error' like 'Book your own spot first%', r::text);

  r := public.book_with_credit(h, s1, 'A');
  perform pg_temp.chk('host books A with a credit', (r->>'ok')::boolean and r->>'section' = 'A', r::text);

  r := public.create_booking_hold(h, s1, 'invite', 3, 89);
  hold1 := (r->>'hold_id')::uuid;
  perform pg_temp.chk('invite hold of 3 on the host station', (r->>'ok')::boolean and r->>'section' = 'A'
    and (r->>'token') ~ '^[0-9a-f]{64}$' and (r->>'price_aed')::numeric = 89, r::text);
  perform pg_temp.chk('invite hold lasts 24 hours', (select expires_at from booking_holds where id = hold1) = now() + interval '24 hours');

  perform pg_temp.chk('booked counts', public.session_booked_counts(s1, 4) = array[1,0,0,0], public.session_booked_counts(s1, 4)::text);
  perform pg_temp.chk('held counts', public.session_held_counts(s1, 4) = array[3,0,0,0], public.session_held_counts(s1, 4)::text);
  perform pg_temp.chk('balancer counts include held', public.session_station_counts(s1, 4) = array[4,0,0,0], public.session_station_counts(s1, 4)::text);
  perform pg_temp.chk('session_taken includes held', public.session_taken(s1) = 4);
  perform pg_temp.chk('held counts can leave one hold out', public.session_held_counts(s1, 4, hold1) = array[0,0,0,0]);

  r := public.create_booking_hold(h, s1, 'invite', 5, 89);
  perform pg_temp.chk('max 7 live spots per host', (r->>'ok')::boolean = false and (r->>'room')::int = 4
    and r->>'error' = 'You can hold 4 more spots on this Sunday', r::text);
  r := public.create_booking_hold(h, s1, 'invite', 0, 89);
  perform pg_temp.chk('spots below 1 refused', (r->>'ok')::boolean = false and r->>'error' = 'Hold between 1 and 7 spots', r::text);
  r := public.create_booking_hold(h, s1, 'invite', 8, 89);
  perform pg_temp.chk('spots above 7 refused', (r->>'ok')::boolean = false and r->>'error' = 'Hold between 1 and 7 spots', r::text);

  r := public.create_booking_hold(h, s1, 'invite', 4, 89);
  hold2 := (r->>'hold_id')::uuid;
  perform pg_temp.chk('second hold of 4 fills station A', (r->>'ok')::boolean and public.session_station_counts(s1, 4) = array[8,0,0,0], r::text);

  r := public.book_with_credit(o1, s1, 'A');
  perform pg_temp.chk('solo booker cannot take held spots', (r->>'ok')::boolean = false and r->>'error' like 'Station A is full%', r::text);
  r := public.book_paid(o1, s1, 'A', 99);
  perform pg_temp.chk('book_paid moves a solo payer off the held station', (r->>'ok')::boolean and r->>'section' <> 'A', r::text);
  update public.bookings set status = 'cancelled' where member_id = o1 and session_id = s1;

  -- ------------------------------------------------ claiming an invite
  r := public.book_from_hold(f1, hold1, 'credit');
  perform pg_temp.chk('friend claims with own credit', (r->>'ok')::boolean and r->>'section' = 'A' and r->>'via' = 'hold'
    and (r->>'credits_left')::int = 4 and (r->>'host_member_id')::uuid = h, r::text);
  select * into rec from public.bookings where member_id = f1 and session_id = s1;
  perform pg_temp.chk('claimed booking: credit, with the host', rec.payment_type = 'credit' and rec.with_member_id = h
    and rec.member_package_id is not null and rec.amount_paid_aed = 0 and rec.status = 'booked');
  perform pg_temp.chk('claim increments claimed', (select claimed from booking_holds where id = hold1) = 1);
  perform pg_temp.chk('a claim converts a held spot into a booking', public.session_station_counts(s1, 4) = array[8,0,0,0]
    and public.session_booked_counts(s1, 4) = array[2,0,0,0], public.session_station_counts(s1, 4)::text);

  r := public.book_from_hold(f1, hold1, 'credit');
  perform pg_temp.chk('one booking per member per session', (r->>'ok')::boolean = false and r->>'reason' = 'booked', r::text);
  r := public.book_from_hold(f2, hold1, 'credit');
  perform pg_temp.chk('no credits, nothing claimed', (r->>'ok')::boolean = false and r->>'reason' = 'no_credits'
    and (select claimed from booking_holds where id = hold1) = 1, r::text);
  r := public.book_from_hold(f2, hold1, 'single', 89);
  perform pg_temp.chk('friend claims by card', (r->>'ok')::boolean and r->>'section' = 'A' and r->>'credits_left' is null, r::text);
  select * into rec from public.bookings where member_id = f2 and session_id = s1;
  perform pg_temp.chk('card claim: single, AED 89, no pack', rec.payment_type = 'single' and rec.amount_paid_aed = 89
    and rec.member_package_id is null and rec.with_member_id = h);
  r := public.book_from_hold(f2, hold1, 'single', 89);
  perform pg_temp.chk('a repeat card claim dedups', (r->>'ok')::boolean and (r->>'dedup')::boolean, r::text);
  r := public.book_from_hold(f3, hold1, 'credit');
  perform pg_temp.chk('third claim uses the last spot', (r->>'ok')::boolean and (select claimed from booking_holds where id = hold1) = 3, r::text);
  r := public.book_from_hold(f4, hold1, 'credit');
  perform pg_temp.chk('a fully claimed hold refuses', (r->>'ok')::boolean = false and r->>'reason' = 'full', r::text);
  r := public.book_from_hold(f4, hold1, 'single', 89);
  perform pg_temp.chk('paid friend on a used-up hold with no station room is refused', (r->>'ok')::boolean = false
    and r->>'reason' = 'station_full', r::text);
  r := public.book_from_hold(h, hold2, 'credit');
  perform pg_temp.chk('host cannot claim their own hold', (r->>'ok')::boolean = false and r->>'reason' = 'host', r::text);
  r := public.book_from_hold(f4, gen_random_uuid(), 'credit');
  perform pg_temp.chk('unknown hold', (r->>'ok')::boolean = false and r->>'reason' = 'invalid', r::text);

  -- Expiry: the 24-hour clock ran out on hold2. Its spots reopen.
  update public.booking_holds set expires_at = now() - interval '1 second' where id = hold2;
  perform pg_temp.chk('expired hold stops counting', public.session_station_counts(s1, 4) = array[4,0,0,0]
    and public.session_taken(s1) = 4, public.session_station_counts(s1, 4)::text);
  r := public.book_from_hold(f5, hold2, 'credit');
  perform pg_temp.chk('expired hold refuses a credit claim', (r->>'ok')::boolean = false and r->>'reason' = 'expired', r::text);
  r := public.book_from_hold(f4, hold2, 'single', 89);
  perform pg_temp.chk('paid friend whose hold lapsed still gets the station', (r->>'ok')::boolean and r->>'via' = 'station'
    and r->>'section' = 'A' and (select claimed from booking_holds where id = hold2) = 0, r::text);

  -- Cancelled hold.
  r := public.create_booking_hold(h, s1, 'invite', 2, 89);
  hold3 := (r->>'hold_id')::uuid;
  perform pg_temp.chk('new hold after expiry', (r->>'ok')::boolean, r::text);
  update public.booking_holds set cancelled_at = now() where id = hold3;
  r := public.book_from_hold(f5, hold3, 'credit');
  perform pg_temp.chk('cancelled hold refuses', (r->>'ok')::boolean = false and r->>'reason' = 'cancelled', r::text);

  -- Daily cap: 10 invite holds per host per 24 hours (3 made so far).
  ok_n := 0;
  for i in 1..10 loop
    r := public.create_booking_hold(h, s1, 'invite', 1, 89);
    exit when not (r->>'ok')::boolean;
    ok_n := ok_n + 1;
    update public.booking_holds set cancelled_at = now() where id = (r->>'hold_id')::uuid;
  end loop;
  perform pg_temp.chk('10 invite holds a day', ok_n = 7 and r->>'error' like 'You made a lot of invite links today%', ok_n || ' ' || r::text);

  -- ------------------------------------------------ paid groups
  r := public.create_booking_hold(b, s1, 'checkout', 3, 89, 'C',
         jsonb_build_array(jsonb_build_object('member_id', g1, 'name', 'G One'), jsonb_build_object('member_id', g2, 'name', 'G Two')));
  ck1 := (r->>'hold_id')::uuid;
  perform pg_temp.chk('checkout hold for a group of 3', (r->>'ok')::boolean and r->>'section' = 'C'
    and (select expires_at from booking_holds where id = ck1) = now() + interval '35 minutes'
    and (select jsonb_array_length(friends) from booking_holds where id = ck1) = 2, r::text);
  r := public.create_booking_hold(b, s1, 'checkout', 3, 89, 'C', null);
  ck2 := (r->>'hold_id')::uuid;
  perform pg_temp.chk('a retried checkout replaces the earlier hold', (r->>'ok')::boolean
    and (select cancelled_at from booking_holds where id = ck1) is not null
    and public.session_held_counts(s1, 4) = array[0,0,3,0], public.session_held_counts(s1, 4)::text);
  r := public.create_booking_hold(b, s1, 'checkout', 1, 89, 'C', null);
  perform pg_temp.chk('a group needs at least one friend', (r->>'ok')::boolean = false, r::text);
  r := public.create_booking_hold(h, s1, 'checkout', 2, 89, 'B', null);
  perform pg_temp.chk('a booked member cannot open a group checkout', (r->>'ok')::boolean = false
    and r->>'error' = 'You''re already booked for this session', r::text);

  r := public.book_group_paid(b, s1, 'C', array[g1, g2], 99, 89, ck2);
  perform pg_temp.chk('group of 3 lands on C', (r->>'ok')::boolean and r->>'section' = 'C' and (r->>'moved')::boolean = false
    and jsonb_array_length(r->'booked') = 3 and jsonb_array_length(r->'already') = 0, r::text);
  select * into rec from public.bookings where member_id = g1 and session_id = s1;
  perform pg_temp.chk('friend booking: single, AED 89, with the buyer', rec.section = 'C' and rec.payment_type = 'single'
    and rec.amount_paid_aed = 89 and rec.with_member_id = b);
  select * into rec from public.bookings where member_id = b and session_id = s1;
  perform pg_temp.chk('buyer booking: AED 99, with nobody', rec.section = 'C' and rec.amount_paid_aed = 99 and rec.with_member_id is null);
  perform pg_temp.chk('fulfilment closes the checkout hold', (select claimed from booking_holds where id = ck2) = 3
    and public.session_held_counts(s1, 4) = array[0,0,0,0]
    and public.session_station_counts(s1, 4) = array[5,0,3,0], public.session_station_counts(s1, 4)::text);

  r := public.book_group_paid(b2, s1, 'D', array[g1, g3, g3, b2], 99, 89, null);
  perform pg_temp.chk('already-booked friend is skipped and reported, duplicates ignored', (r->>'ok')::boolean
    and r->>'section' = 'D' and jsonb_array_length(r->'booked') = 2
    and r->'already' = to_jsonb(array[g1]), r::text);

  -- ------------------------------------------------ cancelled rows are reused cleanly
  update public.bookings set status = 'cancelled' where member_id = f1 and session_id = s1;
  r := public.book_with_credit(f1, s1, 'B');
  perform pg_temp.chk('book_with_credit reuse clears with_member_id', (r->>'ok')::boolean
    and (select with_member_id from bookings where member_id = f1 and session_id = s1) is null, r::text);
  update public.bookings set status = 'cancelled' where member_id = f4 and session_id = s1;
  r := public.book_paid(f4, s1, 'B', 99);
  perform pg_temp.chk('book_paid reuse clears with_member_id', (r->>'ok')::boolean
    and (select with_member_id from bookings where member_id = f4 and session_id = s1) is null, r::text);

  -- ------------------------------------------------ groups skip balancing, never the cap
  insert into public.sessions(session_date, start_time, location, capacity, max_capacity, stations, status)
  values ('2099-01-11', '12:45', 'TWF TEST', 32, 32, 4, 'open') returning id into s2;
  foreach m in array array[o1, o2, o3, o4] loop
    r := public.book_with_credit(m, s2, 'A');
    perform pg_temp.chk('solo fills A to 4', (r->>'ok')::boolean, r::text);
  end loop;
  r := public.book_with_credit(o5, s2, 'A');
  perform pg_temp.chk('balancing closes A to the next solo booker', (r->>'ok')::boolean = false
    and r->>'error' like 'Station A is waiting for the others%', r::text);
  r := public.create_booking_hold(b, s2, 'checkout', 3, 89, 'A', null);
  ck3 := (r->>'hold_id')::uuid;
  perform pg_temp.chk('a group can take A anyway', (r->>'ok')::boolean and r->>'section' = 'A', r::text);
  r := public.create_booking_hold(b2, s2, 'checkout', 5, 89, 'A', null);
  perform pg_temp.chk('but never past the station cap', (r->>'ok')::boolean = false and (r->>'room')::int = 1
    and r->>'error' = 'Station A has room for 1 of you', r::text);
  r := public.book_group_paid(b, s2, 'A', array[g1, g2], 99, 89, ck3);
  perform pg_temp.chk('the group lands on A past the window', (r->>'ok')::boolean and r->>'section' = 'A'
    and public.session_booked_counts(s2, 4) = array[7,0,0,0], r::text);
  r := public.create_booking_hold(o1, s2, 'invite', 2, 89);
  perform pg_temp.chk('an invite hold is capped by station room too', (r->>'ok')::boolean = false
    and (r->>'room')::int = 1 and r->>'error' = 'Station A has room for 1 more', r::text);
  r := public.create_booking_hold(o1, s2, 'invite', 1, 89);
  perform pg_temp.chk('an invite hold can take the last spot', (r->>'ok')::boolean, r::text);

  -- ------------------------------------------------ no room: all or nothing, or move together
  insert into public.sessions(session_date, start_time, location, capacity, max_capacity, stations, status)
  values ('2099-01-18', '12:45', 'TWF TEST', 8, 8, 4, 'open') returning id into s3;
  r := public.book_group_paid(b3, s3, 'A', array[g1, g2], 99, 89, null);
  perform pg_temp.chk('a group too big for any station books nobody', (r->>'ok')::boolean = false and r->>'reason' = 'full'
    and (select count(*) from bookings where session_id = s3) = 0, r::text);
  r := public.book_with_credit(o1, s3, 'A');
  r := public.book_group_paid(b3, s3, 'A', array[g1], 99, 89, null);
  perform pg_temp.chk('a full pick moves the whole group to one station', (r->>'ok')::boolean and r->>'section' = 'B'
    and (r->>'moved')::boolean
    and (select count(distinct section) from bookings where session_id = s3 and member_id in (b3, g1)) = 1, r::text);
  update public.sessions set status = 'cancelled' where id = s3;
  r := public.book_group_paid(b2, s3, 'C', array[g3], 99, 89, null);
  perform pg_temp.chk('a called-off Sunday books nobody', (r->>'ok')::boolean = false and r->>'reason' = 'closed', r::text);

  -- ------------------------------------------------ existing callers see held spots
  insert into public.sessions(session_date, start_time, location, capacity, max_capacity, stations, status)
  values ('2099-01-25', '12:45', 'TWF TEST', 8, 8, 4, 'open') returning id into s4;
  r := public.book_with_credit(o1, s4, 'A');  r := public.create_booking_hold(o1, s4, 'invite', 1, 89);
  r := public.book_with_credit(o2, s4, 'B');  r := public.create_booking_hold(o2, s4, 'invite', 1, 89);
  r := public.book_with_credit(o3, s4, 'C');  r := public.create_booking_hold(o3, s4, 'invite', 1, 89);
  r := public.book_with_credit(o4, s4, 'D');  r := public.create_booking_hold(o4, s4, 'invite', 1, 89);
  hold3 := (r->>'hold_id')::uuid;
  perform pg_temp.chk('4 bookings + 4 held fill a cap-8 Sunday', public.session_taken(s4) = 8
    and public.session_booked_counts(s4, 4) = array[1,1,1,1], public.session_station_counts(s4, 4)::text);
  r := public.book_with_credit(o5, s4, 'A');
  perform pg_temp.chk('book_with_credit: held spots make the session full', (r->>'ok')::boolean = false
    and r->>'error' = 'This session is full', r::text);
  r := public.book_paid(f2, s4, 'A', 99);
  perform pg_temp.chk('book_paid: held spots make the session full', (r->>'ok')::boolean = false
    and r->>'error' = 'Session full', r::text);
  update public.booking_holds set expires_at = now() - interval '1 second' where id = hold3;
  r := public.book_paid(f2, s4, 'A', 99);
  perform pg_temp.chk('book_paid lands on the station whose hold lapsed', (r->>'ok')::boolean and r->>'section' = 'D', r::text);

  -- ------------------------------------------------ holds drive capacity bumps
  insert into public.sessions(session_date, start_time, location, capacity, max_capacity, stations, status, bump_threshold, bump_increment)
  values ('2099-02-01', '12:45', 'TWF TEST', 16, 24, 4, 'open', 13, 10) returning id into s5;
  r := public.book_with_credit(o5, s5, 'A');
  perform pg_temp.chk('one booking does not bump', (select capacity from sessions where id = s5) = 16, r::text);
  r := public.create_booking_hold(o5, s5, 'invite', 3, 89);
  perform pg_temp.chk('a hold counts toward the bump', (r->>'ok')::boolean and (select capacity from sessions where id = s5) = 24, r::text);

  -- ------------------------------------------------ invite attempts and privileges
  insert into public.booking_hold_invites(hold_id, host_member_id, email_sha256, invited_member_id) values (hold1, h, 'sha-hit', f5);
  insert into public.booking_hold_invites(hold_id, host_member_id, email_sha256, invited_member_id) values (hold1, h, 'sha-miss', null);
  begin
    insert into public.booking_hold_invites(hold_id, host_member_id, email_sha256) values (hold1, h, 'sha-miss');
    perform pg_temp.chk('one attempt row per address per link', false);
  exception when unique_violation then
    perform pg_temp.chk('one attempt row per address per link', true);
  end;
  perform pg_temp.chk('anon and authenticated cannot read holds', not has_table_privilege('anon', 'public.booking_holds', 'select')
    and not has_table_privilege('authenticated', 'public.booking_holds', 'select')
    and not has_table_privilege('anon', 'public.booking_hold_invites', 'select'));
  perform pg_temp.chk('RLS on both new tables', (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.booking_holds'::regclass, 'public.booking_hold_invites'::regclass)));
  perform pg_temp.chk('only service_role runs the new functions',
    not has_function_privilege('anon', 'public.create_booking_hold(uuid,uuid,text,int,numeric,text,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.book_from_hold(uuid,uuid,text,numeric)', 'execute')
    and not has_function_privilege('authenticated', 'public.book_group_paid(uuid,uuid,text,uuid[],numeric,numeric,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.book_paid(uuid,uuid,text,numeric)', 'execute')
    and has_function_privilege('service_role', 'public.book_group_paid(uuid,uuid,text,uuid[],numeric,numeric,uuid)', 'execute'));
  perform pg_temp.chk('payments accept kind group', exists (select 1 from pg_constraint
    where conname = 'payments_kind_check' and pg_get_constraintdef(oid) like '%group%'));

  -- ------------------------------------------------ verdict
  if exists (select 1 from _t where not ok) then
    raise exception 'TRAIN-WITH-FRIENDS SQL TESTS FAILED: %',
      (select string_agg(n || ' ' || name || coalesce(' :: ' || detail, ''), ' | ' order by n) from _t where not ok);
  end if;
end $test$;

select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed,
       (select count(*) from public.sessions where location = 'TWF TEST') as throwaway_sessions_in_txn
  from _t;
