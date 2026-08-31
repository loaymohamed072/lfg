-- Gate link token: the /gate board is a capability URL (owner's decision,
-- 2026-08-31). Possession of the secret link IS the authorization - no sign-in.
-- The token lives in event_config (the existing single-row config table) and is
-- checked server-side by /api/staff/* against the X-Gate-Key header.
--
-- Rotation is one UPDATE, no redeploy. A forwarded link is rotated for everyone,
-- not revoked per person - that is the accepted tradeoff of a shared link.
--
-- PROJECT: LFG DUBAI (mqhrjliqjxcxtzorapiy), schema public. Unqualified DDL like
-- the 2026-07-04 / 2026-08-31_gate_staff files.

alter table event_config add column if not exists gate_token text;

-- Set (or rotate) the token. Generate a fresh value with:
--   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
update event_config set gate_token = '<GENERATE-FRESH-TOKEN-NEVER-COMMIT-THE-REAL-ONE>' where id = 1;

-- The live link to hand the door team (rotate = re-send a new one):
--   https://www.lfgdubai.com/gate?k=<GENERATE-FRESH-TOKEN-NEVER-COMMIT-THE-REAL-ONE>
--
-- Kill the link entirely (board goes dark until a new token is set):
--   update event_config set gate_token = null where id = 1;
