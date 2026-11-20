-- Looser station balancing (Loay, 20 Nov 2026: "the booking system is too strict like
-- leaving only 2 slots available when we are only at 20 people reserved"). On 22 Nov the
-- stations had 6, 6, 5 and 6 booked of 40: past half full the window was 2, so only one
-- spot was open on the whole Sunday.
--
-- Now a station may run 4 ahead of the emptiest one for the whole Sunday (it was 4 under
-- half full, 2 past half). The level stays even, so stations still fill in pairs, and
-- every station keeps its cap. api/sessions.js mirrors the rule (stationRoom).
-- DEPLOY ORDER: apply this migration, then deploy the code. Between the two the page
-- shows fewer open stations than the database allows; nothing fails.

create or replace function public.balanced_open_stations(p_cap int, p_n int, p_booked int[], p_taken int[])
returns text[] language plpgsql immutable set search_path to 'public' as $function$
declare v_min int; v_level int; v_out text[];
begin
  -- The station with the fewest people sets the level, among those with room left.
  select min(coalesce(p_booked[i], 0)) filter (where coalesce(p_taken[i], 0) < public.section_cap(p_cap, i - 1, p_n))
    into v_min
    from generate_series(1, p_n) i;
  v_level := 2 * (v_min / 2) + 4;
  select coalesce(array_agg(chr(64 + i) order by i), '{}') into v_out
    from generate_series(1, p_n) i
   where coalesce(p_booked[i], 0) < v_level
     and coalesce(p_taken[i], 0) < public.section_cap(p_cap, i - 1, p_n);
  return v_out;
end; $function$;
revoke execute on function public.balanced_open_stations(int,int,int[],int[]) from public, anon, authenticated;
