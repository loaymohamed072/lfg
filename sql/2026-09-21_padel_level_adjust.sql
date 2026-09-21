-- A level set by hand is an offset on top of the results, so re-rating keeps it.
-- Applied to prod 2026-09-21 as padel_level_adjust.
alter table public.padel_profiles add column if not exists level_adjust numeric not null default 0;

-- Restore the hand-set levels the first real re-rating (21 Sep) overwrote.
-- Offset = Ahmed's level minus the results level before that night.
update public.padel_profiles set level_adjust = 1.0, level = 3.0, updated_at = now()
 where member_id = '9eddd2dd-6ced-4d6d-b332-025caed0b6c3';  -- Khalfan Nazir: set 2 -> 3 by hand
update public.padel_profiles set level_adjust = -0.5, level = 5.5, updated_at = now()
 where member_id = 'ef5fe548-59ea-42aa-a052-68f56aac5743';  -- Peter Kay: set 5 -> 5.5 by hand, results say 6
