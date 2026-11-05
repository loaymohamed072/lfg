-- WhatsApp number requests (Loay, 5 Nov 2026: "prepare an email asking people to provide
-- whatsapp number ... the link just forwards you to a page where u enter ur number").
-- One row per emailed member: a 64-hex token in the link lets them set members.phone at
-- /whatsapp without signing in. A token only ever writes its own member's number, runs
-- out after 30 days, and is readable by the service role alone (api/whatsapp-number.js).
create table if not exists public.whatsapp_requests (
  token text primary key check (token ~ '^[0-9a-f]{64}$'),
  member_id uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  emailed_at timestamptz,
  saved_at timestamptz
);
create index if not exists whatsapp_requests_member_idx on public.whatsapp_requests (member_id);

alter table public.whatsapp_requests enable row level security;
revoke all on public.whatsapp_requests from anon, authenticated;
