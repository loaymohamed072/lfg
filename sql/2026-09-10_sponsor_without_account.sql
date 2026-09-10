-- Sponsored tickets move from the account page to the public homepage.
--
-- Ahmed's ask was that people can buy bootcamp sessions for others. The first
-- cut put the card on /account, which meant only an existing signed-in member
-- could buy. The buyers are Reem's PR contacts, who have no LFG account, so
-- that placement killed the feature it was meant to deliver.
--
-- The buyer must NOT be given an account either: minting auth users from a
-- typed-in email is the exact public path closed on 2026-08-09 after it
-- produced ~220 junk GoTrue signups. So a sponsor is identified by what Stripe
-- already collected at payment, and sponsor_member_id is filled in only when a
-- signed-in member happens to be the buyer.
alter table sponsored_tickets alter column sponsor_member_id drop not null;
alter table sponsored_tickets add column if not exists sponsor_name  text;
alter table sponsored_tickets add column if not exists sponsor_email text;

-- Attribution has to exist in one form or the other, or a hand-out cannot say
-- who paid it forward.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.sponsored_tickets'::regclass
                    and conname  = 'sponsored_tickets_has_sponsor') then
    alter table sponsored_tickets add constraint sponsored_tickets_has_sponsor
      check (sponsor_member_id is not null or sponsor_name is not null or sponsor_email is not null);
  end if;
end $$;
