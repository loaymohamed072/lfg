-- Station locks (Loay, 20 Nov 2026: "make her only be able to reserve C without her
-- knowing that only C is available"). A member in station_locks books one station only.
-- To them every other station reads as full, on the booking page (api/sessions.js) and
-- in the booking functions below, and the balancing window does not apply to their
-- station: they can take it whenever it has room under its cap.
--
-- The coaches' own tools (admin moves, rosters) do not read this table.
-- Spots a friend saves for them (invite links, group checkouts) stay on the friend's
-- station: book_from_hold and book_group_paid are unchanged.
--
-- Add or change a lock:  insert into public.station_locks(member_id, section) values ('<id>', 'C')
--                          on conflict (member_id) do update set section = excluded.section;
-- Remove one:            delete from public.station_locks where member_id = '<id>';
--
-- book_with_credit, book_free and book_paid change only in one line each: the open
-- stations pass through member_open_stations after the balancer.
-- DEPLOY ORDER: apply this migration, then deploy the code.

create table if not exists public.station_locks (
  member_id uuid primary key references public.members(id) on delete cascade,
  section text not null check (section ~ '^[A-Z]$'),
  created_at timestamptz not null default now()
);
-- No policies: only the service role and the booking functions read it, so a member
-- never sees their own lock.
alter table public.station_locks enable row level security;
revoke all on public.station_locks from anon, authenticated;

-- The stations a member may book. No lock: the balancer's list as it is. A lock: that
-- one station while it has room under its cap (booked plus held), otherwise none.
create or replace function public.member_open_stations(p_member uuid, p_open text[], p_cap int, p_n int, p_taken int[])
returns text[] language plpgsql stable security definer set search_path to 'public' as $function$
declare v_lock text; v_i int;
begin
  select section into v_lock from public.station_locks where member_id = p_member;
  if v_lock is null then return p_open; end if;
  v_i := ascii(v_lock) - 64;
  if v_i between 1 and p_n and coalesce(p_taken[v_i], 0) < public.section_cap(p_cap, v_i - 1, p_n) then
    return array[v_lock];
  end if;
  return '{}'::text[];
end; $function$;
revoke execute on function public.member_open_stations(uuid,text[],int,int,int[]) from public, anon, authenticated;

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

  -- Held spots for friends count as taken. When they hold this booker out, a Sunday below
  -- max_capacity grows for them.
  v_booked := public.session_taken(p_session);
  if v_booked >= v_cap then
    v_cap := public.bump_capacity_for_held(p_session);
    if v_booked >= v_cap then return jsonb_build_object('ok',false,'error','This session is full'); end if;
  end if;

  v_counts := public.session_station_counts(p_session, v_stations);
  v_open := public.balanced_open_stations(v_cap, v_stations, public.session_booked_counts(p_session, v_stations), v_counts);
  v_open := public.member_open_stations(p_member, v_open, v_cap, v_stations, v_counts);
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
      amount_paid_aed=0, status='booked', booked_at=now(), checked_in_at=null, with_member_id=null
     where id=v_existing_id returning id into v_booking_id;
  else
    insert into public.bookings(member_id,session_id,section,payment_type,member_package_id,amount_paid_aed,status)
    values(p_member,p_session,p_section,'credit',v_pkg_id,0,'booked') returning id into v_booking_id;
  end if;

  perform public.maybe_bump_capacity(p_session);

  select coalesce(sum(sessions_remaining),0) into v_total
    from public.member_packages
    where member_id=p_member and status='active' and sessions_remaining>0 and expires_at>now();

  return jsonb_build_object('ok',true,'booking_id',v_booking_id,'section',p_section,'credits_left',v_total);
end; $function$;

create or replace function public.book_free(p_member uuid, p_session uuid, p_section text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_cap int; v_status text; v_free boolean; v_booked int; v_idx int; v_sec_cap int; v_sec_booked int;
        v_stations int; v_booking_id uuid; v_existing_id uuid; v_existing_status text;
        v_total int; v_counts int[]; v_open text[];
begin
  select capacity, status, coalesce(stations,4), is_free into v_cap, v_status, v_stations, v_free
    from public.sessions where id = p_session for update;
  if not found then return jsonb_build_object('ok',false,'error','Session not found'); end if;
  if not coalesce(v_free, false) then
    return jsonb_build_object('ok',false,'error','This Sunday is not free','reason','not_free');
  end if;

  if p_section !~ '^[A-Z]$' then return jsonb_build_object('ok',false,'error','Pick a station'); end if;
  v_idx := ascii(p_section) - ascii('A');
  if v_idx < 0 or v_idx >= v_stations then return jsonb_build_object('ok',false,'error','Pick a station'); end if;

  if v_status <> 'open' then return jsonb_build_object('ok',false,'error','This session is closed'); end if;

  select id, status into v_existing_id, v_existing_status from public.bookings where member_id=p_member and session_id=p_session;
  if v_existing_status in ('booked','attended') then return jsonb_build_object('ok',false,'error','You already booked this session'); end if;

  -- Held spots for friends count as taken. When they hold this booker out, a Sunday below
  -- max_capacity grows for them.
  v_booked := public.session_taken(p_session);
  if v_booked >= v_cap then
    v_cap := public.bump_capacity_for_held(p_session);
    if v_booked >= v_cap then return jsonb_build_object('ok',false,'error','This session is full'); end if;
  end if;

  v_counts := public.session_station_counts(p_session, v_stations);
  v_open := public.balanced_open_stations(v_cap, v_stations, public.session_booked_counts(p_session, v_stations), v_counts);
  v_open := public.member_open_stations(p_member, v_open, v_cap, v_stations, v_counts);
  if not (p_section = any(v_open)) then
    v_sec_cap := public.section_cap(v_cap, v_idx, v_stations);
    v_sec_booked := coalesce(v_counts[v_idx + 1], 0);
    return jsonb_build_object('ok',false,
      'error', case when v_sec_booked >= v_sec_cap
        then 'Station '||p_section||' is full. Pick station '||array_to_string(v_open, ' or ')
        else 'Station '||p_section||' is waiting for the others to fill. Pick station '||array_to_string(v_open, ' or ') end,
      'open_stations', to_jsonb(v_open));
  end if;

  if v_existing_id is not null then
    update public.bookings set section=p_section, payment_type='free', member_package_id=null,
      amount_paid_aed=0, status='booked', booked_at=now(), checked_in_at=null, with_member_id=null
     where id=v_existing_id returning id into v_booking_id;
  else
    insert into public.bookings(member_id,session_id,section,payment_type,amount_paid_aed,status)
    values(p_member,p_session,p_section,'free',0,'booked') returning id into v_booking_id;
  end if;

  perform public.maybe_bump_capacity(p_session);

  select coalesce(sum(sessions_remaining),0) into v_total
    from public.member_packages
    where member_id=p_member and status='active' and sessions_remaining>0 and expires_at>now();

  return jsonb_build_object('ok',true,'booking_id',v_booking_id,'section',p_section,'credits_left',v_total,'free',true);
end; $function$;

create or replace function public.book_paid(p_member uuid, p_session uuid, p_section text, p_amount numeric)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_cap int; v_status text; v_booked int; v_stations int; v_counts int[]; v_open text[];
        v_chosen text; v_booking_id uuid; v_existing_id uuid; v_existing_status text;
        v_unpaid int := 0; v_b int[]; v_h int[];
begin
  select capacity, status, coalesce(stations,4) into v_cap, v_status, v_stations
    from public.sessions where id = p_session for update;
  if not found then return jsonb_build_object('ok',false,'error','Session not found'); end if;
  select id, status into v_existing_id, v_existing_status from public.bookings where member_id=p_member and session_id=p_session;
  if v_existing_status in ('booked','attended') then return jsonb_build_object('ok',true,'dedup',true); end if;
  -- Held spots for friends count as taken. When they hold this payer out, a Sunday below
  -- max_capacity grows for them. At max_capacity, spots held for unpaid group checkouts
  -- still give way: this card is already charged, and is never refunded for someone
  -- else's checkout.
  v_booked := public.session_taken(p_session);
  if v_booked >= v_cap then
    v_cap := public.bump_capacity_for_held(p_session);
    if v_booked >= v_cap then
      select coalesce(sum(spots - claimed), 0)::int into v_unpaid from public.booking_holds
       where session_id = p_session and kind = 'checkout' and cancelled_at is null
         and expires_at > now() and claimed < spots;
      if v_booked - v_unpaid >= v_cap then return jsonb_build_object('ok',false,'error','Session full'); end if;
    end if;
  end if;

  v_b := public.session_booked_counts(p_session, v_stations);
  v_counts := public.session_station_counts(p_session, v_stations);
  v_open := public.member_open_stations(p_member, public.balanced_open_stations(v_cap, v_stations, v_b, v_counts), v_cap, v_stations, v_counts);
  if cardinality(v_open) = 0 and v_unpaid > 0 then
    -- Every station is full only with spots held for unpaid checkouts: count without them.
    v_h := public.session_held_counts(p_session, v_stations, null, 'invite');
    for i in 1..v_stations loop v_counts[i] := v_b[i] + v_h[i]; end loop;
    v_open := public.member_open_stations(p_member, public.balanced_open_stations(v_cap, v_stations, v_b, v_counts), v_cap, v_stations, v_counts);
  end if;
  if p_section = any(v_open) then
    v_chosen := p_section;
  else
    select s into v_chosen from unnest(v_open) s order by v_b[ascii(s) - 64], s limit 1;
  end if;
  if v_chosen is null then return jsonb_build_object('ok',false,'error','All sections full'); end if;

  if v_existing_id is not null then
    update public.bookings set section=v_chosen, payment_type='single', amount_paid_aed=coalesce(p_amount,0),
      status='booked', booked_at=now(), checked_in_at=null, with_member_id=null
     where id=v_existing_id returning id into v_booking_id;
  else
    insert into public.bookings(member_id,session_id,section,payment_type,amount_paid_aed,status)
    values(p_member,p_session,v_chosen,'single',coalesce(p_amount,0),'booked') returning id into v_booking_id;
  end if;
  perform public.maybe_bump_capacity(p_session);
  return jsonb_build_object('ok',true,'booking_id',v_booking_id,'section',v_chosen);
end; $function$;
