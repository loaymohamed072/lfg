-- Applied to prod 2026-10-01 as migration bootcamp_upsell_nudges.
-- One row per pack nudge sent (api/admin/bootcamp-upsell.js), so a member who
-- keeps showing up hears about packs once per streak, not every Monday.
-- Service role only: the cron writes it, nothing reads it from the browser.
create table if not exists public.bootcamp_upsell_nudges (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  streak int not null,
  channels text[] not null default '{}',
  sent_at timestamptz not null default now()
);
create index if not exists bootcamp_upsell_nudges_member_idx
  on public.bootcamp_upsell_nudges (member_id, sent_at desc);
alter table public.bootcamp_upsell_nudges enable row level security;
revoke all on public.bootcamp_upsell_nudges from anon, authenticated;
