-- Free Sunday (Loay, 2 Nov 2026): the admin can make one Sunday free. Everyone books it at
-- AED 0 with no card, credit holders keep their credits, and a cancelled free spot gives
-- nothing back. cancel_booking returned a credit for every booking without a pack, so
-- without its free branch a free Sunday would have handed out AED 99 credits.

alter table public.sessions add column if not exists is_free boolean not null default false;

alter table public.bookings drop constraint if exists bookings_payment_type_check;
alter table public.bookings add constraint bookings_payment_type_check
  check (payment_type = any (array['credit'::text, 'single'::text, 'free'::text]));

-- book_with_credit's rules (open session, a real station, one booking per member, capacity
-- with held spots counted, balanced stations) without taking a credit, and only on a Sunday
-- the admin made free.
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

revoke all on function public.book_free(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.book_free(uuid, uuid, text) to service_role;

-- book_from_hold: a friend joining a host's held spot on a free Sunday ('free') follows the
-- credit path's rules (open session, live hold) and takes no credit. Everything else as before.
create or replace function public.book_from_hold(p_member uuid, p_hold uuid, p_payment text, p_amount numeric default 0)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_session uuid; v_cap int; v_status text; v_stations int; v_free boolean; v_hold record; v_live boolean;
        v_idx int; v_booked int[]; v_held int[]; v_existing_id uuid; v_existing_status text;
        v_pkg_id uuid; v_booking_id uuid; v_total int;
begin
  if p_payment is null or p_payment not in ('credit','single','free') then
    return jsonb_build_object('ok',false,'error','Unknown payment');
  end if;
  select session_id into v_session from public.booking_holds where id = p_hold and kind = 'invite';
  if not found then return jsonb_build_object('ok',false,'error','This invite link is not valid','reason','invalid'); end if;
  -- Same lock order as every booking function: the session row first, then the hold.
  select capacity, status, coalesce(stations,4), is_free into v_cap, v_status, v_stations, v_free
    from public.sessions where id = v_session for update;
  select * into v_hold from public.booking_holds where id = p_hold for update;
  v_live := v_hold.cancelled_at is null and v_hold.expires_at > now() and v_hold.claimed < v_hold.spots;

  if p_member = v_hold.host_member_id then
    return jsonb_build_object('ok',false,'error','This is your own invite link','reason','host');
  end if;
  if p_payment = 'free' and not coalesce(v_free, false) then
    return jsonb_build_object('ok',false,'error','This Sunday is not free','reason','not_free');
  end if;
  if p_payment in ('credit','free') then
    if v_status <> 'open' then return jsonb_build_object('ok',false,'error','This session is closed','reason','closed'); end if;
    if not v_live then
      return jsonb_build_object('ok',false,
        'reason', case when v_hold.cancelled_at is not null then 'cancelled'
                       when v_hold.expires_at <= now() then 'expired' else 'full' end,
        'error', case when v_hold.cancelled_at is not null then 'This invite was cancelled'
                      when v_hold.expires_at <= now() then 'This invite has expired'
                      else 'The saved spots on this invite are all taken' end);
    end if;
  elsif v_status = 'cancelled' then
    return jsonb_build_object('ok',false,'error','This session was called off','reason','closed');
  end if;

  select id, status into v_existing_id, v_existing_status from public.bookings
   where member_id = p_member and session_id = v_session;
  if v_existing_status in ('booked','attended') then
    if p_payment = 'single' then return jsonb_build_object('ok',true,'dedup',true); end if;
    return jsonb_build_object('ok',false,'error','You already booked this session','reason','booked');
  end if;

  v_idx := ascii(v_hold.section) - 65;
  v_booked := public.session_booked_counts(v_session, v_stations);
  v_held := public.session_held_counts(v_session, v_stations, case when v_live then p_hold end);
  if v_idx >= v_stations
     or v_booked[v_idx + 1] + v_held[v_idx + 1] + 1 > public.section_cap(v_cap, v_idx, v_stations)
     or public.session_taken(v_session) - (case when v_live then v_hold.spots - v_hold.claimed else 0 end) + 1 > v_cap then
    return jsonb_build_object('ok',false,'error','Station ' || v_hold.section || ' is full','reason','station_full');
  end if;

  if p_payment = 'credit' then
    select id into v_pkg_id from public.member_packages
     where member_id = p_member and status = 'active' and sessions_remaining > 0 and expires_at > now()
     order by expires_at asc limit 1 for update;
    if v_pkg_id is null then return jsonb_build_object('ok',false,'error','No credits available','reason','no_credits'); end if;
    update public.member_packages set sessions_remaining = sessions_remaining - 1,
      status = case when sessions_remaining - 1 <= 0 then 'depleted' else status end where id = v_pkg_id;
  end if;

  if v_existing_id is not null then
    update public.bookings set section = v_hold.section, payment_type = p_payment, member_package_id = v_pkg_id,
      amount_paid_aed = case when p_payment in ('credit','free') then 0 else coalesce(p_amount, 0) end,
      status = 'booked', booked_at = now(), checked_in_at = null, with_member_id = v_hold.host_member_id
     where id = v_existing_id returning id into v_booking_id;
  else
    insert into public.bookings(member_id, session_id, section, payment_type, member_package_id, amount_paid_aed, status, with_member_id)
    values (p_member, v_session, v_hold.section, p_payment, v_pkg_id,
            case when p_payment in ('credit','free') then 0 else coalesce(p_amount, 0) end, 'booked', v_hold.host_member_id)
    returning id into v_booking_id;
  end if;
  if v_live then update public.booking_holds set claimed = claimed + 1 where id = p_hold; end if;
  perform public.maybe_bump_capacity(v_session);

  if p_payment in ('credit','free') then
    select coalesce(sum(sessions_remaining), 0) into v_total from public.member_packages
     where member_id = p_member and status = 'active' and sessions_remaining > 0 and expires_at > now();
  end if;
  return jsonb_build_object('ok',true,'booking_id',v_booking_id,'section',v_hold.section,'session_id',v_session,
    'host_member_id',v_hold.host_member_id,'via',case when v_live then 'hold' else 'station' end,
    'credits_left',v_total);
end; $function$;

-- cancel_booking: a free spot cost nothing, so cancelling it gives nothing back.
create or replace function public.cancel_booking(p_user_id uuid, p_booking_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_booking record;
  v_cutoff_dubai timestamptz;
  v_credit_returned boolean := false;
  v_refund_pack_id uuid;
BEGIN
  SELECT b.*, s.session_date AS s_date
    INTO v_booking FROM public.bookings b
    JOIN public.sessions s ON s.id = b.session_id WHERE b.id = p_booking_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Booking not found'); END IF;
  IF v_booking.member_id <> p_user_id THEN RETURN jsonb_build_object('ok', false, 'error', 'Not your booking'); END IF;
  IF v_booking.status <> 'booked' THEN RETURN jsonb_build_object('ok', false, 'error', 'Booking is not active'); END IF;

  v_cutoff_dubai := (v_booking.s_date::text || ' 08:00:00')::timestamp AT TIME ZONE 'Asia/Dubai';
  IF now() >= v_cutoff_dubai THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cancellation window has closed. Cutoff is 8:00 AM Dubai time on session day.');
  END IF;

  UPDATE public.bookings SET status='cancelled' WHERE id = p_booking_id;

  IF v_booking.payment_type = 'free' THEN
    RETURN jsonb_build_object('ok', true, 'credit_returned', false, 'refund_pack_id', null,
      'cancelled_session_date', v_booking.s_date, 'section', v_booking.section, 'free', true);
  END IF;

  IF v_booking.member_package_id IS NOT NULL THEN
    UPDATE public.member_packages SET sessions_remaining = sessions_remaining + 1
     WHERE id = v_booking.member_package_id AND status = 'active';
    v_credit_returned := FOUND;
  END IF;

  IF NOT v_credit_returned THEN
    INSERT INTO public.member_packages(member_id, package_id, sessions_total, sessions_remaining, purchased_at, expires_at, status)
    VALUES (p_user_id, NULL, 1, 1, now(), now() + interval '60 days', 'active')
    RETURNING id INTO v_refund_pack_id;
    v_credit_returned := TRUE;
  END IF;

  RETURN jsonb_build_object('ok', true, 'credit_returned', v_credit_returned,
    'refund_pack_id', v_refund_pack_id,
    'cancelled_session_date', v_booking.s_date, 'section', v_booking.section);
END;
$function$;
