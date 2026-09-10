-- Sponsored bootcamp tickets (Ahmed, voice note 10 Sep 2026).
--
-- Reem's PR contacts want to support the bootcamps by buying passes and paying
-- them forward to the community. A member (or anyone who signs up) buys N
-- tickets at the single-session price; the money lands in LFG's Stripe like
-- any other checkout; nothing is booked. The tickets sit in a pool that admins
-- allocate to whoever they choose, by name, and the credit itself is delivered
-- through the existing adjust_credits() RPC so it shows up, expires, and audits
-- exactly like a comped session.
--
-- Not called a donation, on Ahmed's instruction. "Sponsored tickets."
--
-- Two tables, both service-role only (the API is the only reader, same posture
-- as padel_signups): the purchase, and each hand-out drawn against it. Pool
-- remaining = sum(qty) - sum(allocations.qty), computed, never stored.

create table if not exists sponsored_tickets (
  id                    uuid primary key default gen_random_uuid(),
  sponsor_member_id     uuid not null references members(id),
  qty                   integer not null check (qty between 1 and 50),
  amount_aed            numeric(10,2) not null check (amount_aed >= 0),
  note                  text,
  stripe_session_id     text unique,
  stripe_payment_intent text unique,
  purchased_at          timestamptz not null default now()
);

create table if not exists sponsored_ticket_allocations (
  id                   uuid primary key default gen_random_uuid(),
  sponsored_ticket_id  uuid not null references sponsored_tickets(id),
  member_id            uuid not null references members(id),
  qty                  integer not null check (qty > 0),
  actor_admin_id       uuid not null,
  created_at           timestamptz not null default now()
);

create index if not exists sponsored_ticket_allocations_ticket_idx
  on sponsored_ticket_allocations (sponsored_ticket_id);
create index if not exists sponsored_tickets_purchased_idx
  on sponsored_tickets (purchased_at desc);

alter table sponsored_tickets enable row level security;
alter table sponsored_ticket_allocations enable row level security;
-- No policies on purpose: anon and authenticated see nothing; service role bypasses RLS.

-- payments.kind is CHECK-constrained; without this the checkout insert 500s
-- before Stripe is ever called. Found by definition rather than by name so the
-- swap works whatever the constraint was called.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.payments'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%kind%';
  if c is not null then execute format('alter table public.payments drop constraint %I', c); end if;
  alter table public.payments add constraint payments_kind_check
    check (kind in ('single','package','merch','run','padel','sponsor'));
end $$;
