-- Balanced stations: partners train in pairs, so every station must hold the same,
-- even number of people.
--
-- 1. Pair rounds. A station is open only while it sits below the next even level above
--    the emptiest station (min 0 -> level 2, min 2 -> level 4, ...). Stations fill two at
--    a time in rotation, never drift more than 2 apart, and all land on even numbers at
--    the end of each round. A cancellation reopens only the station that lost someone.
-- 2. Capacity is always a multiple of 2 x stations, so every station gets the same even
--    cap. A trigger rounds it for every writer: the auto-bump, the admin setter, the
--    station-count setters and ensure_upcoming_sundays.

-- Open stations for given capacity, station count, and per-station counts (A first).
create or replace function public.balanced_open_stations(p_cap int, p_n int, p_counts int[])
returns text[] language plpgsql immutable set search_path to 'public' as $$
declare v_min int; v_level int; v_c int; v_cap int; v_out text[] := '{}';
begin
  select min(coalesce(p_counts[i], 0)) into v_min from generate_series(1, p_n) i;
  v_level := 2 * (v_min / 2) + 2;
  for i in 1..p_n loop
    v_c := coalesce(p_counts[i], 0);
    v_cap := public.section_cap(p_cap, i - 1, p_n);
    if v_c < least(v_level, v_cap) then v_out := v_out || chr(64 + i); end if;
  end loop;
  -- Uneven legacy caps can close every station at the current level; fall back to any
  -- station with room, emptiest first, so a session with space never refuses a booking.
  if cardinality(v_out) = 0 then
    select coalesce(array_agg(chr(64 + i) order by coalesce(p_counts[i], 0), i), '{}') into v_out
      from generate_series(1, p_n) i
     where coalesce(p_counts[i], 0) < public.section_cap(p_cap, i - 1, p_n);
  end if;
  return v_out;
end; $$;

create or replace function public.session_station_counts(p_session uuid, p_n int)
returns int[] language sql stable set search_path to 'public' as $$
  select array_agg(coalesce(c.cnt, 0)::int order by i)
    from generate_series(0, p_n - 1) i
    left join (select section, count(*) cnt from public.bookings
                where session_id = p_session and status in ('booked','attended') group by section) c
      on c.section = chr(65 + i);
$$;

-- Capacity rounds UP to a multiple of 2 x stations (never strands a booked seat);
-- the auto-bump ceiling rounds DOWN but never below capacity.
create or replace function public.sessions_even_capacity()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_step int := 2 * greatest(coalesce(new.stations, 4), 1);
begin
  if new.capacity is not null then
    new.capacity := ((new.capacity + v_step - 1) / v_step) * v_step;
  end if;
  if new.max_capacity is not null then
    new.max_capacity := greatest((new.max_capacity / v_step) * v_step, coalesce(new.capacity, 0));
  end if;
  return new;
end; $$;

drop trigger if exists sessions_even_capacity on public.sessions;
create trigger sessions_even_capacity before insert or update of capacity, max_capacity, stations
  on public.sessions for each row execute function public.sessions_even_capacity();

create or replace function public.book_with_credit(p_member uuid, p_session uuid, p_section text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_cap int; v_status text; v_booked int; v_idx int; v_sec_cap int; v_sec_booked int;
        v_stations int; v_pkg_id uuid; v_remaining int; v_booking_id uuid; v_existing_id uuid; v_existing_status text;
        v_total int; v_counts int[]; v_open text[];
begin
  select capacity, status, coalesce(stations,4) into v_cap, v_status, v_stations
    from public.sessions where id = p_session for update;
  if not found then return jsonb_build_object('ok',false,'error','Session not found'); end if;

  if p_section !~ '^[A-Z]$' then return jsonb_build_object('ok',false,'error','Pick a station'); end if;
  v_idx := ascii(p_section) - ascii('A');
  if v_idx < 0 or v_idx >= v_stations then return jsonb_build_object('ok',false,'error','Pick a station'); end if;

  if v_status <> 'open' then return jsonb_build_object('ok',false,'error','This session is closed'); end if;

  select id, status into v_existing_id, v_existing_status from public.bookings where member_id=p_member and session_id=p_session;
  if v_existing_status in ('booked','attended') then return jsonb_build_object('ok',false,'error','You already booked this session'); end if;

  select count(*) into v_booked from public.bookings where session_id=p_session and status in ('booked','attended');
  if v_booked >= v_cap then return jsonb_build_object('ok',false,'error','This session is full'); end if;

  -- Pair rounds: only the stations the balancer opens can take this booking.
  v_counts := public.session_station_counts(p_session, v_stations);
  v_open := public.balanced_open_stations(v_cap, v_stations, v_counts);
  if not (p_section = any(v_open)) then
    v_sec_cap := public.section_cap(v_cap, v_idx, v_stations);
    v_sec_booked := coalesce(v_counts[v_idx + 1], 0);
    return jsonb_build_object('ok',false,
      'error', case when v_sec_booked >= v_sec_cap
        then 'Station '||p_section||' is full. Pick station '||array_to_string(v_open, ' or ')
        else 'Station '||p_section||' is waiting for the others to fill. Pick station '||array_to_string(v_open, ' or ') end,
      'open_stations', to_jsonb(v_open));
  end if;

  select id, sessions_remaining into v_pkg_id, v_remaining from public.member_packages
   where member_id=p_member and status='active' and sessions_remaining>0 and expires_at>now() order by expires_at asc limit 1 for update;
  if v_pkg_id is null then return jsonb_build_object('ok',false,'error','No credits available'); end if;

  update public.member_packages set sessions_remaining=sessions_remaining-1,
    status=case when sessions_remaining-1<=0 then 'depleted' else status end where id=v_pkg_id;

  if v_existing_id is not null then
    update public.bookings set section=p_section, payment_type='credit', member_package_id=v_pkg_id,
      amount_paid_aed=0, status='booked', booked_at=now(), checked_in_at=null where id=v_existing_id returning id into v_booking_id;
  else
    insert into public.bookings(member_id,session_id,section,payment_type,member_package_id,amount_paid_aed,status)
    values(p_member,p_session,p_section,'credit',v_pkg_id,0,'booked') returning id into v_booking_id;
  end if;

  perform public.maybe_bump_capacity(p_session);

  -- Total credits left across ALL active packages (matches /api/me sessions_remaining),
  -- not just the single package we drew from.
  select coalesce(sum(sessions_remaining),0) into v_total
    from public.member_packages
    where member_id=p_member and status='active' and sessions_remaining>0 and expires_at>now();

  return jsonb_build_object('ok',true,'booking_id',v_booking_id,'section',p_section,'credits_left',v_total);
end; $function$;

-- Paid bookings run from the Stripe webhook after the card is charged, so they never
-- refuse over a station: the member's pick if the balancer has it open, otherwise the
-- emptiest open station.
create or replace function public.book_paid(p_member uuid, p_session uuid, p_section text, p_amount numeric)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_cap int; v_status text; v_booked int; v_stations int; v_counts int[]; v_open text[];
        v_chosen text; v_booking_id uuid; v_existing_id uuid; v_existing_status text;
begin
  select capacity, status, coalesce(stations,4) into v_cap, v_status, v_stations
    from public.sessions where id = p_session for update;
  if not found then return jsonb_build_object('ok',false,'error','Session not found'); end if;
  select id, status into v_existing_id, v_existing_status from public.bookings where member_id=p_member and session_id=p_session;
  if v_existing_status in ('booked','attended') then return jsonb_build_object('ok',true,'dedup',true); end if;
  select count(*) into v_booked from public.bookings where session_id=p_session and status in ('booked','attended');
  if v_booked >= v_cap then
    perform public.maybe_bump_capacity(p_session);
    select capacity into v_cap from public.sessions where id = p_session;
    if v_booked >= v_cap then return jsonb_build_object('ok',false,'error','Session full'); end if;
  end if;

  v_counts := public.session_station_counts(p_session, v_stations);
  v_open := public.balanced_open_stations(v_cap, v_stations, v_counts);
  if p_section = any(v_open) then
    v_chosen := p_section;
  else
    select s into v_chosen from unnest(v_open) s order by v_counts[ascii(s) - 64], s limit 1;
  end if;
  if v_chosen is null then return jsonb_build_object('ok',false,'error','All sections full'); end if;

  if v_existing_id is not null then
    update public.bookings set section=v_chosen, payment_type='single', amount_paid_aed=coalesce(p_amount,0),
      status='booked', booked_at=now(), checked_in_at=null where id=v_existing_id returning id into v_booking_id;
  else
    insert into public.bookings(member_id,session_id,section,payment_type,amount_paid_aed,status)
    values(p_member,p_session,v_chosen,'single',coalesce(p_amount,0),'booked') returning id into v_booking_id;
  end if;
  perform public.maybe_bump_capacity(p_session);
  return jsonb_build_object('ok',true,'booking_id',v_booking_id,'section',v_chosen);
end; $function$;

-- Round every upcoming session's capacity now (the trigger fires on this update).
update public.sessions set capacity = capacity, max_capacity = max_capacity
 where session_date >= current_date;

-- Follow-up (same day, applied as balanced_stations_flex): strict pair rounds pushed
-- friends apart, so the rule softened. A station can run up to 4 ahead of the emptiest
-- one (two pairs), and an odd station always takes one more to complete its pair.
create or replace function public.balanced_open_stations(p_cap int, p_n int, p_counts int[])
returns text[] language plpgsql immutable set search_path to 'public' as $$
declare v_min int; v_level int; v_c int; v_cap int; v_allow int; v_out text[] := '{}';
begin
  select min(coalesce(p_counts[i], 0)) into v_min from generate_series(1, p_n) i;
  v_level := 2 * (v_min / 2) + 4;
  for i in 1..p_n loop
    v_c := coalesce(p_counts[i], 0);
    v_cap := public.section_cap(p_cap, i - 1, p_n);
    v_allow := least(v_cap, greatest(v_level, case when v_c % 2 = 1 then v_c + 1 else 0 end));
    if v_c < v_allow then v_out := v_out || chr(64 + i); end if;
  end loop;
  if cardinality(v_out) = 0 then
    select coalesce(array_agg(chr(64 + i) order by coalesce(p_counts[i], 0), i), '{}') into v_out
      from generate_series(1, p_n) i where coalesce(p_counts[i], 0) < public.section_cap(p_cap, i - 1, p_n);
  end if;
  return v_out;
end; $$;
revoke execute on function public.balanced_open_stations(int,int,int[]), public.session_station_counts(uuid,int)
  from public, anon, authenticated;

-- Follow-up 2026-09-20 (applied as balanced_stations_dynamic_window): a fixed 4-wide
-- window showed "4 left" on every tile once the stations levelled, which reads as plenty
-- of room and lets the gap sit at 4 late in the week. The window now moves with the
-- session: 4 while it is under half full (friends can group), 2 once it passes half
-- (stations converge, tiles read "Only 2 left" when it matters). Odd-completion unchanged.
create or replace function public.balanced_open_stations(p_cap int, p_n int, p_counts int[])
returns text[] language plpgsql immutable set search_path to 'public' as $$
declare v_min int; v_booked int; v_win int; v_level int; v_c int; v_cap int; v_allow int; v_out text[] := '{}';
begin
  select min(coalesce(p_counts[i], 0)), sum(coalesce(p_counts[i], 0)) into v_min, v_booked
    from generate_series(1, p_n) i;
  v_win := case when p_cap > 0 and v_booked * 2 >= p_cap then 2 else 4 end;
  v_level := 2 * (v_min / 2) + v_win;
  for i in 1..p_n loop
    v_c := coalesce(p_counts[i], 0);
    v_cap := public.section_cap(p_cap, i - 1, p_n);
    v_allow := least(v_cap, greatest(v_level, case when v_c % 2 = 1 then v_c + 1 else 0 end));
    if v_c < v_allow then v_out := v_out || chr(64 + i); end if;
  end loop;
  if cardinality(v_out) = 0 then
    select coalesce(array_agg(chr(64 + i) order by coalesce(p_counts[i], 0), i), '{}') into v_out
      from generate_series(1, p_n) i where coalesce(p_counts[i], 0) < public.section_cap(p_cap, i - 1, p_n);
  end if;
  return v_out;
end; $$;
revoke execute on function public.balanced_open_stations(int,int,int[]) from public, anon, authenticated;
