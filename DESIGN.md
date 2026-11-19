# LFG Dubai booking site: interaction contracts

Visual language lives in `design/LFG-DESIGN-PLAYBOOK.md`; the back office in
`BACKOFFICE-DESIGN.md`; padel in `PADEL-DESIGN.md`. This file holds the flow contracts for
the public booking site, starting with the WhatsApp number (5 Nov 2026).

## Flows: WhatsApp number (interaction-ux, 5 Nov 2026)

Why: the coaches reach members about their Sunday on WhatsApp, and bootcamp booking never
asked for a number. On 5 Nov, 50 of the 126 people booked for 8 Nov had none anywhere.
Loay: "whatsapp number is essential".

**Rule.** A member needs a WhatsApp number on file before a bootcamp booking (credit, free
Sunday, single by card, group checkout, invite join) or a pack purchase. Sponsored tickets
and merch do not ask. A number on the member's run-club registration counts and is copied
onto `members.phone` the first time it is looked up. Server: `requireWhatsapp` in
`api/_lib.js`, called by `api/book.js` (both paths) and `api/checkout.js` (single, package).

**Field (one, everywhere).** Label "WhatsApp number"; `type=tel`, `inputmode=tel`,
`autocomplete=tel`, `dir=ltr`, 16px; placeholder `050 123 4567`. Accepts 050 123 4567,
50 123 4567, 971..., +971 (with or without the 0), 00971..., spaces, dashes, brackets; any
other country with + or 00. UAE numbers must be mobiles (05x). Stored as E.164.
`whatsappE164` in `api/_lib.js` is the rule; the widget and `/whatsapp` mirror it.
Validation on blur, then on each keystroke once shown. Error, adjacent to the field:
"That number doesn't look right. Try 050 123 4567, or add the country code, like +44."

**1. Booking step** (`app-assets/lfg-home-booking.js`, `ensureWhatsapp`). Entry: Book, a
pack card, the after-sign-in resume, the invite landing's credit and card buttons. Shown
once, before the station picker, only when `/api/me` says `needs_whatsapp`.
- Eyebrow "Before you book"; title "What's your WhatsApp number?"; line "Your coaches use
  it for Sundays: your station, the start time, and any change on the day."
- Primary "Save my number" (pending "Saving…", disabled while saving); secondary "Cancel"
  closes the popup, nothing saved.
- Success: the action the member started continues (station picker, pack confirm, join).
- Failure: the server's message under the field, number kept, button re-armed.
- Out-of-date page: a booking answered `needs_whatsapp` opens this step, then returns to
  the station picker.

**2. My Account** (`account.html`, `#waModal`). Shows on every visit while no number is on
file, after the name prompt when both are missing. "Save my number" / "Not now".

**3. Emailed link** (`/whatsapp?t=TOKEN`, `whatsapp.html`, `api/whatsapp-number.js`). No
sign-in: a 64-hex token from `whatsapp_requests` (30 days) can only set its own member's
number. Greets by first name; shows the number on file masked (`+971 •• ••• 4567`) when
there is one. Success: "Saved." with the number and "See the next Sunday". A missing,
unknown or expired token: "This link has run out" with "Go to My Account". A failed save
keeps the number and offers a retry.

**4. Email** (`scripts/whatsapp-ask.js`, `buildWhatsappAsk` in `api/_email.js`). Dry run by
default; `--send` or `--to=<email>` only on Loay's word. Subject "Add your WhatsApp number
before Sunday" (booked on the named Sunday) or "Add your WhatsApp number to your LFG
account"; shows the booked Sunday, time, venue and station when there is one; one button
"Add my WhatsApp number".

**Action inventory.** Back: Cancel / Not now on the step and the prompt, browser Back on the
link page. Retry: the save button re-arms after a failure. Change a saved number: the
emailed link (shows the current one); My Account has no edit control yet (open).

## Flows: checkout built into the page (interaction-ux + form-cro, 19 Nov 2026)

Why: Loay, "instead of it being embedded can we have the actual stripe checkout IN the
site", and Apple Pay working for everyone. Last 100 paid charges on the site's Stripe
account: Apple Pay 73, Link 19, Google Pay 4, typed card 3. www.lfgdubai.com and
lfgdubai.com are registered payment-method domains, Apple Pay active.

**What.** One component, `app-assets/lfg-pay.js`, used by every place that takes money
(shop, account and bootcamp sponsor, bootcamp booking incl. packs/groups/invites, track,
padel, Musandam, events). Stripe Checkout Sessions in `ui_mode: 'elements'`, so the
session, the webhook and each page's `GET ?session_id=` verify are what the embedded page
used. Server: `checkoutUi()` in `api/_lib.js`.

**Rollout switch.** Off for everyone (`DEFAULT_ON = false`). `?checkout=new` turns it on in
one browser, `?checkout=old` turns it off. Off = Stripe.js `/v3/` and the embedded page as
before; on = Stripe.js `/dahlia/` and this checkout. No single Stripe.js runs both:
`/v3/` refuses the Elements SDK, `/dahlia/` removed `initEmbeddedCheckout` (tested 19 Nov).
Flip `DEFAULT_ON` after a real Apple Pay payment on an iPhone on the live site.

**The step, top to bottom.** Wallet buttons (Apple Pay first, then Google Pay, Link; only
what the device offers; the band stays collapsed until Stripe says) · "or pay by card" ·
email only when the page doesn't know it (anonymous sponsor) · card fields (Link's
"save my information" sign-up removed; Link users get the button) · one button
**Pay AED {amount}** · "Payment runs through Stripe. LFG never sees your card number." ·
Message us on WhatsApp (prefilled per page). Fields 16px, square, Barlow; the button is
the only olive fill.

**States.** Loading: "Loading secure checkout…", 15 s limit, then "Checkout didn't load.
Check your connection and try again." + Try again (back to the page's previous step,
values kept) + WhatsApp. Paying: "Paying…" in the button, disabled, aria-busy. Bank
approval (3-D Secure) opens over the page and returns to it. Declined: "Payment didn't go
through. {Stripe's reason} Nothing was charged. Try again or use another card.", form
kept (card declines and rejected requests only). Field problem: Stripe's line only.
Connection or server error, or a lost answer: "We couldn't confirm whether that payment went
through. Check your email for a receipt before you try again, or message us on WhatsApp."
(no "nothing was charged" when the state is unknown, so nobody pays twice).
**Anonymous buyer (sponsor box, no account).** "Your name" field above the email, 16px,
required on the card path ("Add your name above, so we know who paid."), passed to Stripe
with `updateIndividualName` on a session created with optional `name_collection`, so it lands
in `customer_details.name` where fulfilment reads `sponsor_name` (the embedded page asked for
a cardholder name; the Elements card form does not). Paid: the
page's own server verify, then its own success. Instagram/Facebook in-app browser on an
iPhone with no Apple Pay offered: "Want Apple Pay? Open this page in Safari: tap ••• then
Open in browser." A payment method that leaves the page returns to `return_url` with
`?lfgpay=<route>&session_id=`; the component verifies and shows a banner.

**Shop.** Buy (signed in) swaps the size picker for the checkout in place: "← Change size",
"Secure checkout", "LFG Tee · {size}". Browser Back and "Change size" return to the
picker with the size kept (one history entry). Success shows in place with Done. The old
pop-up stays for the switch-off path; sign-in for a signed-out buyer stays a small pop-up.

**Sticky bars.** Elements marked `data-hide-during-pay` (bootcamp `#bcSticky`, home
`.mobile-sticky-bar` and `.sticky-ctas-desktop`) hide while a checkout is open: on phones
the bootcamp bar sat on top of the Pay button and took the tap.

**Action inventory.** Pay: the button or a wallet button. Back: the page's own back
(Change size / Back / step back) and browser Back. Retry: Try again after a load failure;
the Pay button re-arms after a decline. Help: WhatsApp link. Undo: none (a payment is
refunded by the coaches, as before).
