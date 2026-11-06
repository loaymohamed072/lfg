-- Free Sunday invite holds last 6 hours (Loay, 6 Nov 2026: "make the friends holding for
-- only 6 hours for this special free one as a lot of people want to join and we dont want
-- to waste space"). create_booking_hold sets an invite hold's expiry to 6 hours on a Sunday
-- with sessions.is_free, 24 hours on every other Sunday; checkout holds stay 35 minutes.
-- Changed lines only: v_is_free, the session read, the expiry.
--
-- Holds that already exist keep their 24 hours (Loay, same day: "dont remove any current hold
-- just for the new people"). The first apply also cut the live 8 Nov holds to 6 hours; that
-- update was reverted within minutes (expires_at = created_at + 24 hours on the five holds,
-- nobody booked in between) and is no longer part of this file.
-- Not covered: an admin making a Sunday free later leaves that Sunday's existing holds at 24h.

create or replace function public.create_booking_hold(
  p_host uuid, p_session uuid, p_kind text, p_spots int, p_price numeric,
  p_section text default null, p_friends jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_cap int; v_status text; v_stations int; v_is_free boolean; v_section text; v_bk_status text; v_idx int;
        v_booked int[]; v_held int[]; v_room int; v_free int; v_mine int; v_recent int; v_ended timestamptz;
        v_old_id uuid; v_old_left int; v_old_stripe text; v_checkout_held int;
        v_expires timestamptz; v_token text; v_id uuid;
begin
  if p_kind is null or p_kind not in ('invite','checkout') then
    return jsonb_build_object('ok',false,'error','Unknown hold type');
  end if;
  perform pg_advisory_xact_lock(hashtext('lfg_booking_holds:' || p_host::text));
  select capacity, status, coalesce(stations,4), coalesce(is_free, false) into v_cap, v_status, v_stations, v_is_free
    from public.sessions where id = p_session for update;
  if not found then return jsonb_build_object('ok',false,'error','Session not found'); end if;
  if v_status <> 'open' then return jsonb_build_object('ok',false,'error','This session is closed'); end if;

  select section, status into v_section, v_bk_status from public.bookings
   where member_id = p_host and session_id = p_session;

  if p_kind = 'invite' then
    if v_bk_status is distinct from 'booked' then
      return jsonb_build_object('ok',false,'error','Book your own spot first, then hold spots for friends');
    end if;
    if p_spots is null or p_spots < 1 or p_spots > 7 then
      return jsonb_build_object('ok',false,'error','Hold between 1 and 7 spots');
    end if;
    select coalesce(sum(spots), 0) into v_mine from public.booking_holds
     where host_member_id = p_host and session_id = p_session and kind = 'invite'
       and cancelled_at is null and expires_at > now();
    if v_mine + p_spots > 7 then
      return jsonb_build_object('ok',false,'room',greatest(0, 7 - v_mine),
        'error', case when v_mine >= 7 then 'You already hold 7 spots for friends on this Sunday'
                      else 'You can hold ' || (7 - v_mine) || ' more spot' || case when 7 - v_mine = 1 then '' else 's' end || ' on this Sunday' end);
    end if;
    select count(*) into v_recent from public.booking_holds
     where host_member_id = p_host and kind = 'invite' and created_at > now() - interval '24 hours';
    if v_recent >= 10 then
      return jsonb_build_object('ok',false,'error','You made a lot of invite links today. Share one you already have.');
    end if;
    select max(coalesce(cancelled_at, expires_at)) into v_ended from public.booking_holds
     where host_member_id = p_host and session_id = p_session and kind = 'invite' and claimed < spots
       and ((cancelled_at is null and expires_at <= now() and expires_at > now() - interval '3 hours')
         or (cancelled_at > now() - interval '3 hours' and cancelled_at - created_at >= interval '12 hours'));
    if v_ended is not null then
      return jsonb_build_object('ok',false,'error',
        'Your last hold on this Sunday just ended, so those spots are open to everyone for now. You can hold spots again from '
        || to_char((v_ended + interval '3 hours') at time zone 'Asia/Dubai', 'FMHH12:MI AM') || '.');
    end if;
    -- A free Sunday fills fast, so a friend's spot is held 6 hours there, 24 elsewhere.
    v_expires := now() + case when v_is_free then interval '6 hours' else interval '24 hours' end;
  else
    if v_bk_status in ('booked','attended') then
      return jsonb_build_object('ok',false,'error','You''re already booked for this session');
    end if;
    if p_spots is null or p_spots < 2 or p_spots > 8 then
      return jsonb_build_object('ok',false,'error','A group is you plus 1 to 7 friends');
    end if;
    v_section := p_section;
    -- The buyer's own live unpaid hold on this Sunday gets replaced: leave it out of every count.
    select id, spots - claimed, stripe_session_id into v_old_id, v_old_left, v_old_stripe
      from public.booking_holds
     where host_member_id = p_host and session_id = p_session and kind = 'checkout' and cancelled_at is null
       and fulfilled_at is null and expires_at > now() and claimed < spots
     order by created_at desc limit 1;
    -- Abandoned card forms are what the cap stops: checkouts that held spots and were never
    -- paid, live or run out. A replaced hold and one released when Stripe failed (both
    -- cancelled) do not count, nor does a paid one, so reopening the form never locks a
    -- buyer out.
    select count(*) into v_recent from public.booking_holds
     where host_member_id = p_host and kind = 'checkout' and cancelled_at is null and fulfilled_at is null
       and created_at > now() - interval '24 hours' and id is distinct from v_old_id;
    if v_recent >= 3 then
      return jsonb_build_object('ok',false,'error','You started 3 group checkouts today without paying. Book your own spot now, or try the group again tomorrow.');
    end if;
    select coalesce(sum(spots - claimed), 0) into v_checkout_held from public.booking_holds
     where session_id = p_session and kind = 'checkout' and cancelled_at is null and expires_at > now()
       and claimed < spots and id is distinct from v_old_id;
    if v_checkout_held + p_spots > 16 then
      return jsonb_build_object('ok',false,'error','A few groups are paying for this Sunday right now. Try again in a few minutes.');
    end if;
    v_expires := now() + interval '35 minutes';
  end if;

  if v_section is null or v_section !~ '^[A-Z]$' then return jsonb_build_object('ok',false,'error','Pick a station'); end if;
  v_idx := ascii(v_section) - 65;
  if v_idx >= v_stations then return jsonb_build_object('ok',false,'error','Pick a station'); end if;

  v_booked := public.session_booked_counts(p_session, v_stations);
  v_held := public.session_held_counts(p_session, v_stations, v_old_id);
  v_room := public.section_cap(v_cap, v_idx, v_stations) - v_booked[v_idx + 1] - v_held[v_idx + 1];
  v_free := v_cap - (public.session_taken(p_session) - coalesce(v_old_left, 0));
  if v_room < p_spots or v_free < p_spots then
    v_room := greatest(0, least(v_room, v_free));
    return jsonb_build_object('ok',false,'section',v_section,'room',v_room,
      'error', case when v_room = 0 then 'Station ' || v_section || ' is full'
                    when p_kind = 'invite' then 'Station ' || v_section || ' has room for ' || v_room || ' more'
                    else 'Station ' || v_section || ' has room for ' || v_room || ' of you' end);
  end if;

  -- Every check passed: only now does the buyer's earlier live hold go. One that ran out
  -- unpaid stays as it is, so it keeps counting toward the daily cap.
  if v_old_id is not null then
    update public.booking_holds set cancelled_at = now() where id = v_old_id;
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.booking_holds(session_id, section, host_member_id, token, spots, price_aed, kind, friends, expires_at)
  values (p_session, v_section, p_host, v_token, p_spots, greatest(coalesce(p_price, 0), 0), p_kind,
          case when p_kind = 'checkout' then p_friends end, v_expires)
  returning id into v_id;

  if p_kind = 'invite' then perform public.maybe_bump_capacity(p_session); end if;
  return jsonb_build_object('ok',true,'hold_id',v_id,'token',v_token,'section',v_section,'spots',p_spots,
    'expires_at',v_expires,'price_aed',greatest(coalesce(p_price, 0), 0),
    'replaced_stripe_session', case when p_kind = 'checkout' then v_old_stripe end);
end; $function$;
