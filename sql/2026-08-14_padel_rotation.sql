-- 2026-08-14 — King of the Court: rotating partners.
--
-- Ahmed confirmed the real format on 2026-08-13: partners are NOT fixed for the
-- night. Winners of a court go up one court, losers go down one, and the pair
-- that travelled together is split so they play against each other. Points are
-- individual: win the game and you bank the games you scored, lose and you bank
-- nothing.
--
-- So a "team" is now a PER-ROUND pairing rather than a fixture for the night.
-- padel_matches is untouched: team_a/team_b still hold a team_no, which is now
-- scoped to (event_date, round) instead of (event_date).
--
-- APPLIED to project mqhrjliqjxcxtzorapiy on 2026-08-14.

alter table padel_teams add column if not exists round smallint not null default 1;

alter table padel_teams drop constraint if exists padel_teams_event_date_team_no_key;
alter table padel_teams add constraint padel_teams_event_date_round_team_no_key
  unique (event_date, round, team_no);

create index if not exists padel_teams_date_round_idx on padel_teams(event_date, round);
