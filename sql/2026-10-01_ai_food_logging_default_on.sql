-- Applied to prod 2026-10-01 as migration ai_food_logging_default_on.
-- Photo/voice food logging is open to every client (decided 2026-09-04), but the
-- column default stayed false, so the 6 clients added since 8 Sep never saw the
-- camera (Omar, 2026-09-30). Default on, and backfill.
alter table public.coaching_clients alter column ai_food_logging set default true;
update public.coaching_clients set ai_food_logging = true where ai_food_logging = false;
