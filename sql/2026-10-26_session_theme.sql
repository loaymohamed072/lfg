-- 2026-10-26: weekly bootcamp theme (e.g. HYROX, DEKA), set per Sunday in the admin.
-- Shown on the bootcamp page and in /api/next-bootcamp for the Instagram bot. Applied via MCP migration 'session_theme'.
alter table public.sessions add column if not exists theme text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sessions_theme_len') then
    alter table public.sessions add constraint sessions_theme_len check (theme is null or char_length(theme) <= 40);
  end if;
end $$;
