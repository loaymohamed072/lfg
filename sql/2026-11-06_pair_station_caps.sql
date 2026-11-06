-- 162 on Sunday 8 Nov (Loay, 6 Nov 2026: "we need to increase the bootcamp number i keep trying
-- 162 but its not allowing me"; 168 is "too much"). The admin box rounded 162 down to 156,
-- the nearest multiple of 2 x 6 stations, and the trigger rounds any other write up to 168.
--
-- 1. section_cap splits a capacity in whole pairs: every station gets the same number of
--    pairs and the leftover pairs go one each to the first stations. 162 on 6 stations is
--    81 pairs: 28,28,28,26,26,26. A capacity that is a multiple of 2 x stations splits evenly,
--    exactly as before, so every Sunday booked under the pairs rule keeps its numbers.
--    Mirrors _friends.sectionCap and _lib.sectionCapN.
-- 2. sessions_even_capacity keeps an even capacity that equals max_capacity when the station
--    count did not change: the owner capping a Sunday by hand (the admin setter writes both).
--    Everything else rounds up to a multiple of 2 x stations, as before: the auto-bump below a
--    ceiling, ensure_upcoming_sundays, and station-count changes.
-- The two-argument section_cap(total, idx) is a 4-station leftover nothing books through;
-- it stays as it is.

create or replace function public.section_cap(p_total integer, p_idx integer, p_n integer)
returns integer language sql immutable set search_path to 'public' as $function$
  select 2 * ((p_total / 2) / nullif(p_n, 0))
       + case when p_idx < (p_total / 2) % nullif(p_n, 0) then 2 else 0 end
       + case when p_total % 2 = 1 and p_idx = (p_total / 2) % nullif(p_n, 0) then 1 else 0 end;
$function$;

create or replace function public.sessions_even_capacity()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_step int := 2 * greatest(coalesce(new.stations, 4), 1);
begin
  -- A hand-set ceiling stays as written; section_cap splits it in pairs.
  if new.capacity is not null and new.capacity = new.max_capacity and new.capacity % 2 = 0
     and (tg_op = 'INSERT' or new.stations is not distinct from old.stations) then
    return new;
  end if;
  if new.capacity is not null then
    new.capacity := ((new.capacity + v_step - 1) / v_step) * v_step;
  end if;
  if new.max_capacity is not null then
    new.max_capacity := greatest((new.max_capacity / v_step) * v_step, coalesce(new.capacity, 0));
  end if;
  return new;
end; $function$;
