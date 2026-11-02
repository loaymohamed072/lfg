-- 2026-11-02 Train with a friend.
-- Members could not end up on the same station as their friends: the balancing window
-- (2026-09-19) closes a station that runs ahead, so the second friend to book got pushed
-- elsewhere. Three ways in now, all at the normal ticket price:
--   1. A booked member holds 1-7 spots on their own station and shares an invite link.
--      Unclaimed spots stay locked for 24 hours, then reopen to everyone.
--   2. The same link, emailed to an existing member (exact email match, in the API).
--   3. A buyer pays for themselves plus up to 7 friends at checkout, all on one station.
--      Checkout holds the group's spots for 35 minutes (the Stripe session expires at ~30)
--      so they cannot be sold while the card is being typed; fulfilment claims the hold.
-- People booking together skip the balancing window, never the station cap. Solo bookings
-- keep today's balancing.
--
-- Held spots (unexpired, uncancelled, not yet claimed) count as taken everywhere the
-- database measures fullness: session_station_counts (the balancer), the full-session
-- checks in book_with_credit and book_paid, and maybe_bump_capacity. api/sessions.js
-- adds the same count for the booking page.
--
-- Idempotent. Signatures of existing functions are unchanged, so current callers keep
-- working: book_with_credit and book_paid differ only in counting held spots and in
-- clearing with_member_id when they reuse a cancelled row.

-- Friend bookings remember who they came with: the host whose invite they claimed, or
-- the buyer who paid for them. The admin roster shows it as "with <first name>".
alter table public.bookings add column if not exists with_member_id uuid
  references public.members(id) on delete set null;
create index if not exists bookings_with_member_idx on public.bookings (with_member_id)
  where with_member_id is not null;

create table if not exists public.booking_holds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  section text not null check (section ~ '^[A-Z]$'),
  host_member_id uuid not null references public.members(id) on delete cascade,
  token text not null unique,                    -- 64 hex chars, the invite link secret
  spots int not null check (spots between 1 and 8),
  claimed int not null default 0,
  price_aed numeric not null default 0 check (price_aed >= 0),  -- a friend's price, locked
  kind text not null check (kind in ('invite', 'checkout')),
  stripe_session_id text,                        -- checkout holds
  friends jsonb,                                 -- checkout holds: [{member_id, name}]
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint booking_holds_claimed_range check (claimed between 0 and spots)
);
create index if not exists booking_holds_session_live_idx on public.booking_holds (session_id, section)
  where cancelled_at is null;
create index if not exists booking_holds_host_idx on public.booking_holds (host_member_id, created_at desc);
alter table public.booking_holds enable row level security;
revoke all on public.booking_holds from anon, authenticated;
-- No policies on purpose: service role only, like bookings writes.

-- One row per invite-by-email attempt, hit or miss, so the per-link and per-day caps
-- survive cold starts, bound how many addresses a member can look up, and stop the same
-- person being mailed twice for one link. A miss stores only a hash of the address.
create table if not exists public.booking_hold_invites (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references public.booking_holds(id) on delete cascade,
  host_member_id uuid not null references public.members(id) on delete cascade,
  email_sha256 text not null,
  invited_member_id uuid references public.members(id) on delete cascade,   -- null: not on LFG
  created_at timestamptz not null default now(),
  unique (hold_id, email_sha256)
);
create index if not exists booking_hold_invites_host_idx on public.booking_hold_invites (host_member_id, created_at desc);
create index if not exists booking_hold_invites_member_idx on public.booking_hold_invites (invited_member_id)
  where invited_member_id is not null;
alter table public.booking_hold_invites enable row level security;
revoke all on public.booking_hold_invites from anon, authenticated;

-- payments.kind gains 'group' (a buyer paying for themselves plus friends).
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.payments'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%kind%';
  if c is not null then execute format('alter table public.payments drop constraint %I', c); end if;
  alter table public.payments add constraint payments_kind_check
    check (kind in ('single','package','merch','run','padel','sponsor','trip','event','group'));
end $$;

-- ---------------------------------------------------------------- counting

-- Bookings per station, A first (what session_station_counts returned before today).
create or replace function public.session_booked_counts(p_session uuid, p_n int)
returns int[] language sql stable set search_path to 'public' as $$
  select array_agg(coalesce(c.cnt, 0)::int order by i)
    from generate_series(0, p_n - 1) i
    left join (select section, count(*) cnt from public.bookings
                where session_id = p_session and status in ('booked','attended') group by section) c
      on c.section = chr(65 + i);
$$;

-- Live held spots per station. p_except leaves one hold out: the one being claimed,
-- whose spots are about to turn into bookings.
create or replace function public.session_held_counts(p_session uuid, p_n int, p_except uuid default null)
returns int[] language sql stable set search_path to 'public' as $$
  select array_agg(coalesce(h.held, 0)::int order by i)
    from generate_series(0, p_n - 1) i
    left join (select section, sum(spots - claimed) held from public.booking_holds
                where session_id = p_session and cancelled_at is null and expires_at > now()
                  and claimed < spots and id is distinct from p_except
                group by section) h
      on h.section = chr(65 + i);
$$;

-- What the balancer sees: bookings plus held spots, per station.
create or replace function public.session_station_counts(p_session uuid, p_n int)
returns int[] language sql stable set search_path to 'public' as $$
  select array_agg((coalesce(c.cnt, 0) + coalesce(h.held, 0))::int order by i)
    from generate_series(0, p_n - 1) i
    left join (select section, count(*) cnt from public.bookings
                where session_id = p_session and status in ('booked','attended') group by section) c
      on c.section = chr(65 + i)
    left join (select section, sum(spots - claimed) held from public.booking_holds
                where session_id = p_session and cancelled_at is null and expires_at > now()
                  and claimed < spots
                group by section) h
      on h.section = chr(65 + i);
$$;

-- Bookings plus held spots for the whole session.
create or replace function public.session_taken(p_session uuid)
returns int language sql stable set search_path to 'public' as $$
  select (select count(*) from public.bookings
           where session_id = p_session and status in ('booked','attended'))::int
       + (select coalesce(sum(spots - claimed), 0) from public.booking_holds
           where session_id = p_session and cancelled_at is null and expires_at > now()
             and claimed < spots)::int;
$$;

-- A Sunday filling with friends' holds grows like one filling with bookings.
create or replace function public.maybe_bump_capacity(p_session uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_cap int; v_max int; v_inc int; v_thr int; v_booked int;
begin
  select capacity, max_capacity, bump_increment, bump_threshold into v_cap, v_max, v_inc, v_thr
  from public.sessions where id = p_session for update;
  v_booked := public.session_taken(p_session);
  if (v_cap - v_booked) <= v_thr and v_cap < v_max then
    update public.sessions set capacity = least(v_cap + v_inc, v_max) where id = p_session;
  end if;
end; $function$;

-- ---------------------------------------------------------------- existing booking paths

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

  -- Held spots for friends count as taken.
  v_booked := public.session_taken(p_session);
  if v_booked >= v_cap then return jsonb_build_object('ok',false,'error','This session is full'); end if;

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
  -- Held spots for friends count as taken.
  v_booked := public.session_taken(p_session);
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
      status='booked', booked_at=now(), checked_in_at=null, with_member_id=null
     where id=v_existing_id returning id into v_booking_id;
  else
    insert into public.bookings(member_id,session_id,section,payment_type,amount_paid_aed,status)
    values(p_member,p_session,v_chosen,'single',coalesce(p_amount,0),'booked') returning id into v_booking_id;
  end if;
  perform public.maybe_bump_capacity(p_session);
  return jsonb_build_object('ok',true,'booking_id',v_booking_id,'section',v_chosen);
end; $function$;

-- ---------------------------------------------------------------- holds

-- Hold spots on one station.
--   invite:   p_host must hold a 'booked' booking; the hold sits on the host's station.
--             1-7 spots, at most 7 live per host per Sunday, 24 hours.
--   checkout: p_host is the buyer (not yet booked), p_section their pick, p_spots the
--             whole group (2-8), 35 minutes. Replaces the buyer's earlier unpaid hold.
-- Together skips the balancing window, never the station cap.
create or replace function public.create_booking_hold(
  p_host uuid, p_session uuid, p_kind text, p_spots int, p_price numeric,
  p_section text default null, p_friends jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_cap int; v_status text; v_stations int; v_section text; v_bk_status text; v_idx int;
        v_booked int[]; v_held int[]; v_room int; v_free int; v_mine int; v_recent int;
        v_expires timestamptz; v_token text; v_id uuid;
begin
  if p_kind is null or p_kind not in ('invite','checkout') then
    return jsonb_build_object('ok',false,'error','Unknown hold type');
  end if;
  select capacity, status, coalesce(stations,4) into v_cap, v_status, v_stations
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
    v_expires := now() + interval '24 hours';
  else
    if v_bk_status in ('booked','attended') then
      return jsonb_build_object('ok',false,'error','You''re already booked for this session');
    end if;
    if p_spots is null or p_spots < 2 or p_spots > 8 then
      return jsonb_build_object('ok',false,'error','A group is you plus 1 to 7 friends');
    end if;
    v_section := p_section;
    -- A retried checkout replaces the buyer's earlier unpaid hold instead of stacking a second one.
    update public.booking_holds set cancelled_at = now()
     where host_member_id = p_host and session_id = p_session and kind = 'checkout'
       and cancelled_at is null and claimed = 0;
    select count(*) into v_recent from public.booking_holds
     where host_member_id = p_host and kind = 'checkout' and created_at > now() - interval '1 hour';
    if v_recent >= 6 then
      return jsonb_build_object('ok',false,'error','Too many checkouts in a row. Wait a few minutes and try again.');
    end if;
    v_expires := now() + interval '35 minutes';
  end if;

  if v_section is null or v_section !~ '^[A-Z]$' then return jsonb_build_object('ok',false,'error','Pick a station'); end if;
  v_idx := ascii(v_section) - 65;
  if v_idx >= v_stations then return jsonb_build_object('ok',false,'error','Pick a station'); end if;

  v_booked := public.session_booked_counts(p_session, v_stations);
  v_held := public.session_held_counts(p_session, v_stations, null);
  v_room := public.section_cap(v_cap, v_idx, v_stations) - v_booked[v_idx + 1] - v_held[v_idx + 1];
  v_free := v_cap - public.session_taken(p_session);
  if v_room < p_spots or v_free < p_spots then
    v_room := greatest(0, least(v_room, v_free));
    return jsonb_build_object('ok',false,'section',v_section,'room',v_room,
      'error', case when v_room = 0 then 'Station ' || v_section || ' is full'
                    when p_kind = 'invite' then 'Station ' || v_section || ' has room for ' || v_room || ' more'
                    else 'Station ' || v_section || ' has room for ' || v_room || ' of you' end);
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.booking_holds(session_id, section, host_member_id, token, spots, price_aed, kind, friends, expires_at)
  values (p_session, v_section, p_host, v_token, p_spots, greatest(coalesce(p_price, 0), 0), p_kind,
          case when p_kind = 'checkout' then p_friends end, v_expires)
  returning id into v_id;

  perform public.maybe_bump_capacity(p_session);
  return jsonb_build_object('ok',true,'hold_id',v_id,'token',v_token,'section',v_section,'spots',p_spots,
                            'expires_at',v_expires,'price_aed',greatest(coalesce(p_price, 0), 0));
end; $function$;

-- A friend books from an invite hold, with their OWN credit or after paying by card.
-- The friend joins the host's station: no balancing window, never past the station cap.
-- A live hold already counts this spot, so it is left out of the held total here.
-- Card payments are already captured, so a hold that lapsed during payment still gets the
-- station when it has room; otherwise the caller falls back to book_paid.
create or replace function public.book_from_hold(p_member uuid, p_hold uuid, p_payment text, p_amount numeric default 0)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_session uuid; v_cap int; v_status text; v_stations int; v_hold record; v_live boolean;
        v_idx int; v_booked int[]; v_held int[]; v_existing_id uuid; v_existing_status text;
        v_pkg_id uuid; v_booking_id uuid; v_total int;
begin
  if p_payment is null or p_payment not in ('credit','single') then
    return jsonb_build_object('ok',false,'error','Unknown payment');
  end if;
  select session_id into v_session from public.booking_holds where id = p_hold and kind = 'invite';
  if not found then return jsonb_build_object('ok',false,'error','This invite link is not valid','reason','invalid'); end if;
  -- Same lock order as every booking function: the session row first, then the hold.
  select capacity, status, coalesce(stations,4) into v_cap, v_status, v_stations
    from public.sessions where id = v_session for update;
  select * into v_hold from public.booking_holds where id = p_hold for update;
  v_live := v_hold.cancelled_at is null and v_hold.expires_at > now() and v_hold.claimed < v_hold.spots;

  if p_member = v_hold.host_member_id then
    return jsonb_build_object('ok',false,'error','This is your own invite link','reason','host');
  end if;
  if p_payment = 'credit' then
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
      amount_paid_aed = case when p_payment = 'credit' then 0 else coalesce(p_amount, 0) end,
      status = 'booked', booked_at = now(), checked_in_at = null, with_member_id = v_hold.host_member_id
     where id = v_existing_id returning id into v_booking_id;
  else
    insert into public.bookings(member_id, session_id, section, payment_type, member_package_id, amount_paid_aed, status, with_member_id)
    values (p_member, v_session, v_hold.section, p_payment, v_pkg_id,
            case when p_payment = 'credit' then 0 else coalesce(p_amount, 0) end, 'booked', v_hold.host_member_id)
    returning id into v_booking_id;
  end if;
  if v_live then update public.booking_holds set claimed = claimed + 1 where id = p_hold; end if;
  perform public.maybe_bump_capacity(v_session);

  if p_payment = 'credit' then
    select coalesce(sum(sessions_remaining), 0) into v_total from public.member_packages
     where member_id = p_member and status = 'active' and sessions_remaining > 0 and expires_at > now();
  end if;
  return jsonb_build_object('ok',true,'booking_id',v_booking_id,'section',v_hold.section,'session_id',v_session,
    'host_member_id',v_hold.host_member_id,'via',case when v_live then 'hold' else 'station' end,
    'credits_left',v_total);
end; $function$;

-- A paid group (buyer + friends) lands on one station in one transaction. The held
-- station first, then any station the whole group fits on, emptiest first, with one
-- capacity-bump retry like book_paid. All or nothing: when no station fits, nobody is
-- booked and the caller refunds. Anyone already booked is skipped and reported, so the
-- caller can refund that ticket.
create or replace function public.book_group_paid(p_buyer uuid, p_session uuid, p_section text, p_friends uuid[],
  p_buyer_amount numeric, p_friend_amount numeric, p_hold uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_cap int; v_status text; v_stations int; v_hold record; v_live boolean := false; v_live_left int := 0;
        v_members uuid[]; v_new uuid[] := '{}'; v_already uuid[] := '{}'; v_m uuid; v_st text;
        v_need int; v_booked int[]; v_held int[]; v_chosen text; v_idx int; v_try int;
        v_existing_id uuid; v_booking_id uuid; v_out jsonb := '[]'::jsonb;
begin
  select capacity, status, coalesce(stations,4) into v_cap, v_status, v_stations
    from public.sessions where id = p_session for update;
  if not found then return jsonb_build_object('ok',false,'error','Session not found','reason','closed'); end if;
  if p_hold is not null then
    select * into v_hold from public.booking_holds where id = p_hold for update;
    v_live := found and v_hold.session_id = p_session and v_hold.kind = 'checkout' and v_hold.host_member_id = p_buyer
              and v_hold.cancelled_at is null and v_hold.expires_at > now() and v_hold.claimed < v_hold.spots;
    if v_live then v_live_left := v_hold.spots - v_hold.claimed; end if;
  end if;
  if v_status = 'cancelled' then
    if v_live then update public.booking_holds set cancelled_at = now() where id = p_hold; end if;
    return jsonb_build_object('ok',false,'error','This session was called off','reason','closed');
  end if;

  v_members := array[p_buyer];
  foreach v_m in array coalesce(p_friends, '{}'::uuid[]) loop
    if v_m is not null and not (v_m = any(v_members)) then v_members := v_members || v_m; end if;
  end loop;
  foreach v_m in array v_members loop
    select status into v_st from public.bookings where member_id = v_m and session_id = p_session;
    if v_st in ('booked','attended') then v_already := v_already || v_m; else v_new := v_new || v_m; end if;
  end loop;
  v_need := coalesce(cardinality(v_new), 0);
  if v_need = 0 then
    if v_live then update public.booking_holds set expires_at = least(expires_at, now()) where id = p_hold; end if;
    return jsonb_build_object('ok',true,'section',null,'moved',false,'booked','[]'::jsonb,'already',to_jsonb(v_already));
  end if;

  for v_try in 1..2 loop
    v_booked := public.session_booked_counts(p_session, v_stations);
    v_held := public.session_held_counts(p_session, v_stations, case when v_live then p_hold end);
    v_chosen := null;
    if public.session_taken(p_session) - v_live_left + v_need <= v_cap then
      if p_section ~ '^[A-Z]$' then
        v_idx := ascii(p_section) - 65;
        if v_idx < v_stations
           and v_booked[v_idx + 1] + v_held[v_idx + 1] + v_need <= public.section_cap(v_cap, v_idx, v_stations) then
          v_chosen := p_section;
        end if;
      end if;
      if v_chosen is null then
        select chr(65 + i) into v_chosen from generate_series(0, v_stations - 1) i
         where v_booked[i + 1] + v_held[i + 1] + v_need <= public.section_cap(v_cap, i, v_stations)
         order by v_booked[i + 1] + v_held[i + 1], i limit 1;
      end if;
    end if;
    exit when v_chosen is not null or v_try = 2;
    perform public.maybe_bump_capacity(p_session);
    select capacity into v_cap from public.sessions where id = p_session;
  end loop;

  if v_chosen is null then
    if v_live then update public.booking_holds set cancelled_at = now() where id = p_hold; end if;
    return jsonb_build_object('ok',false,'error','No station has room for the group','reason','full','need',v_need);
  end if;

  foreach v_m in array v_new loop
    v_existing_id := null;
    select id into v_existing_id from public.bookings where member_id = v_m and session_id = p_session;
    if v_existing_id is not null then
      update public.bookings set section = v_chosen, payment_type = 'single', member_package_id = null,
        amount_paid_aed = case when v_m = p_buyer then coalesce(p_buyer_amount, 0) else coalesce(p_friend_amount, 0) end,
        status = 'booked', booked_at = now(), checked_in_at = null,
        with_member_id = case when v_m = p_buyer then null else p_buyer end
       where id = v_existing_id returning id into v_booking_id;
    else
      insert into public.bookings(member_id, session_id, section, payment_type, amount_paid_aed, status, with_member_id)
      values (v_m, p_session, v_chosen, 'single',
              case when v_m = p_buyer then coalesce(p_buyer_amount, 0) else coalesce(p_friend_amount, 0) end, 'booked',
              case when v_m = p_buyer then null else p_buyer end)
      returning id into v_booking_id;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('member_id', v_m, 'booking_id', v_booking_id));
  end loop;

  if v_live then
    update public.booking_holds set claimed = least(spots, claimed + v_need), expires_at = least(expires_at, now())
     where id = p_hold;
  end if;
  perform public.maybe_bump_capacity(p_session);
  return jsonb_build_object('ok',true,'section',v_chosen,'moved',v_chosen is distinct from p_section,
                            'booked',v_out,'already',to_jsonb(v_already));
end; $function$;

-- Service role only, like every booking function (SECURITY.md).
revoke execute on function
  public.session_booked_counts(uuid,int), public.session_held_counts(uuid,int,uuid),
  public.session_station_counts(uuid,int), public.session_taken(uuid), public.maybe_bump_capacity(uuid),
  public.book_with_credit(uuid,uuid,text), public.book_paid(uuid,uuid,text,numeric),
  public.create_booking_hold(uuid,uuid,text,int,numeric,text,jsonb),
  public.book_from_hold(uuid,uuid,text,numeric),
  public.book_group_paid(uuid,uuid,text,uuid[],numeric,numeric,uuid)
  from public, anon, authenticated;
grant execute on function
  public.session_booked_counts(uuid,int), public.session_held_counts(uuid,int,uuid),
  public.session_station_counts(uuid,int), public.session_taken(uuid), public.maybe_bump_capacity(uuid),
  public.book_with_credit(uuid,uuid,text), public.book_paid(uuid,uuid,text,numeric),
  public.create_booking_hold(uuid,uuid,text,int,numeric,text,jsonb),
  public.book_from_hold(uuid,uuid,text,numeric),
  public.book_group_paid(uuid,uuid,text,uuid[],numeric,numeric,uuid)
  to service_role;

notify pgrst, 'reload schema';
