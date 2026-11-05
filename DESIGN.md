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
