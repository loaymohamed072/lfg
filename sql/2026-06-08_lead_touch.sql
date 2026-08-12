-- ============================================================
-- Leads CRM: follow-up tracking table (lead_touch)
-- Records the owner's chase actions per lead so the Leads tab can show
-- New / Contacted / Won / Lost / Snoozed and never double-message anyone.
--
-- Service-role only: RLS is ON with no policies, so only /api/admin/* (which
-- uses the service key and bypasses RLS) can read or write it. The browser
-- never touches this table directly.
--
-- lead_key is a stable identity string the API computes:
--   'm:<member_uuid>'  for members
--   'e:<email>'        for guest run signups with an email but no account
--   'w:<digits>'       for guest signups with only a WhatsApp number
--
-- APPLY TO BOTH PROJECTS:
--   OLD  ykpnnqkoqgmwuwdrfmbe  -> schema lfg_dev  (run section A)
--   NEW  mqhrjliqjxcxtzorapiy  -> schema public   (run section B)
-- ============================================================

-- ---------- SECTION A: OLD project (schema lfg_dev) ----------
create table if not exists lfg_dev.lead_touch (
  lead_key    text primary key,
  member_id   uuid,
  status      text not null default 'new'
              check (status in ('new','contacted','won','lost','snoozed')),
  note        text,
  snooze_until timestamptz,
  updated_by  text,
  updated_at  timestamptz not null default now()
);
alter table lfg_dev.lead_touch enable row level security;
create index if not exists lead_touch_status_idx   on lfg_dev.lead_touch (status);
create index if not exists lead_touch_member_idx    on lfg_dev.lead_touch (member_id);

-- ---------- SECTION B: NEW project (schema public) ----------
-- create table if not exists public.lead_touch (
--   lead_key    text primary key,
--   member_id   uuid,
--   status      text not null default 'new'
--               check (status in ('new','contacted','won','lost','snoozed')),
--   note        text,
--   snooze_until timestamptz,
--   updated_by  text,
--   updated_at  timestamptz not null default now()
-- );
-- alter table public.lead_touch enable row level security;
-- create index if not exists lead_touch_status_idx on public.lead_touch (status);
-- create index if not exists lead_touch_member_idx on public.lead_touch (member_id);
