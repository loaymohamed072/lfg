-- 2026-10-09 — Trips: one-off paid events on the site (the Musandam day escape,
-- Sat 14 Nov 2026), on the padel booking pattern: price, date and capacity live
-- server-side, spots are counted from PAID signups, checkout is Stripe embedded.
-- Applied to prod 2026-10-09 (supabase apply_migration trips_and_trip_signups).
create table if not exists trips (
  slug text primary key,
  title text not null,
  subtitle text,
  trip_date date not null,
  pickup_time text,
  pickup_note text,
  location text,
  price_aed numeric not null,
  capacity integer not null default 20,
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists trip_signups (
  id uuid primary key default gen_random_uuid(),
  trip_slug text not null references trips(slug) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  booked_by uuid references members(id),      -- the buyer, when this seat is a friend's
  paid boolean not null default false,
  amount_aed numeric,
  stripe_session_id text,
  stripe_payment_intent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_slug, member_id)
);
create index if not exists trip_signups_trip_paid_idx on trip_signups (trip_slug, paid);
alter table trips enable row level security;
alter table trip_signups enable row level security;
create policy trips_public_read on trips for select using (true);
-- trip_signups: no policies on purpose; service role only (same as padel_signups).
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.payments'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%kind%';
  if c is not null then execute format('alter table public.payments drop constraint %I', c); end if;
  alter table public.payments add constraint payments_kind_check
    check (kind in ('single','package','merch','run','padel','sponsor','trip'));
end $$;
insert into trips (slug, title, subtitle, trip_date, pickup_time, pickup_note, location, price_aed, capacity, enabled)
values ('musandam', 'LFG x Musandam: Fjords Day Escape', 'Arabia''s hidden fjords, in a day', '2026-11-14', '06:00',
        'Dubai pick-up point confirmed on WhatsApp the week before', 'Khasab, Musandam, Oman', 320, 20, true)
on conflict (slug) do nothing;
