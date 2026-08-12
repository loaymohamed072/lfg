# WhatsApp assistant, how to run it properly

Paste-ready message for Ahmed and Omar. Written to be read on a phone.

---

**Quick guide on the WhatsApp assistant 👇**

It covers you at night and when you're away. It answers the simple stuff in your
voice: their macros, their workout, their check-in, a quick well done. Anything
else, it says nothing and taps you on the shoulder instead.

These clients are paying you. The second one of them feels like they're talking
to a machine, that's the thing they're paying for gone. So five habits:

**1. Nights only. Not all day.**
Default is 10pm to 8am. During the day you're awake, and your own reply beats
anything it writes. Use "I'm away" only when you're actually away. Every extra
hour it covers is another chance for it to sound like software.

**2. When it flags you, move.**
It messages you here the moment it decides not to answer someone. That means a
client is sitting there waiting on a human. Injury, money, someone thinking
about quitting, anything with feeling in it, anything it can't answer honestly.
Those are the messages that decide whether someone renews. Answer them
yourself, fast. Whoever sees it first replies and tells the other.

You'll only get pinged when something actually needs you, so if your phone
buzzes, it's real.

**3. Send voice notes.**
A voice note cannot be faked, and it's the quickest way to remind someone there
is a real person on the other end. One or two a week per client, especially
after a strong session or a rough check-in. Thirty seconds is enough. A client
who only ever gets typed replies is the one who starts wondering.

It also works the other way now: if a client sends you a voice note, it listens
and answers the simple ones. If there's any emotion in their voice, it stops,
writes out what they said, and sends it to you. Those ones you handle.

**4. Read what it said each morning.**
Everything it sent is in your inbox, tagged. Two minutes of scrolling with your
coffee. If it got something slightly off, follow up in your own words. If it
ever says something you'd never say, send it to Loay and we fix it.

**5. Turn it off on any thread you're handling.**
Open the client in the inbox and tap "Assistant off". It stops on that client
until you turn it back on. It already does this by itself whenever it stands
down, so you'll find threads sitting off.

One technical thing: WhatsApp only lets the business number message you if
you've messaged it in the last 24 hours. Easiest fix is to just reply to the
alerts. If you go quiet for a couple of days and the pings stop, send anything
to the LFG number and they start again.

The whole point is that nobody waits until morning. It is not there to do your
coaching for you.

---

## Notes for Loay, not for them

- The alert numbers are Ahmed +971 56 133 0939 and Omar +971 50 211 4037, stored
  in `coaching_settings.wa_alert_numbers` and changeable without a deploy.
- The 24h window line above is a real constraint, not politeness. Until a
  UTILITY alert template is approved on the WABA and a payment method is on the
  account, an alert to someone who has not messaged the business number in 24h
  fails. It is logged, not silent: `whatsapp_events` with `direction = 'alert'`
  and `delivered: false`.
- Voice transcription needs `GROQ_API_KEY` on the Vercel project. Without it,
  voice notes behave the old way: nothing said to the client, a human paged.
