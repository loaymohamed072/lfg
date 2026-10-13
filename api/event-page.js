// GET /events/<slug> (rewritten here) - serves event.html with the event already in it:
// title, share tags, JSON-LD, the cover <img> and its preload, and the data the page
// script reads instead of fetching. Two reasons: WhatsApp and Instagram previews never run
// JavaScript, and the cover is the page's largest paint, so it must start downloading with
// the HTML, not after an API round trip.
const fs = require('fs');
const path = require('path');
const { admin, safeError } = require('./_lib');
const { cleanSlug, publicEvent } = require('./event-status');

const TEMPLATE = path.join(__dirname, '..', 'event.html');
let cached = null;
function template() {
  if (!cached) cached = fs.readFileSync(TEMPLATE, 'utf8');
  return cached;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function dubai(iso, opts) {
  try { return new Date(iso).toLocaleString('en-GB', Object.assign({ timeZone: 'Asia/Dubai' }, opts)); } catch (e) { return iso; }
}

module.exports = async (req, res) => {
  const slug = cleanSlug(req.query && req.query.slug);
  let html = template();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Fresh enough for a places-left count, fast enough for a shared link that gets tapped
  // a hundred times in a minute. The sign-up APIs enforce capacity regardless.
  // Never cached: the admin flips price, places and the live switch and expects the page
  // to follow at once, and a stale page would offer a free sign-up on a paid event.
  res.setHeader('Cache-Control', 'private, no-store');
  if (!slug) return res.status(200).send(html);
  try {
    const ev = await publicEvent(admin(), slug);
    if (!ev || !ev.enabled) {
      // The page's own script shows the "not open" state from this payload.
      html = html.replace('<script type="application/ld+json" id="evSchema">{}</script>',
        '<script type="application/ld+json" id="evSchema">{}</script>\n<script>window.__evData = ' + JSON.stringify({ enabled: false, slug }) + ';</script>');
      return res.status(ev ? 200 : 404).send(html);
    }
    const when = dubai(ev.starts_at, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
    const title = ev.title + ' · LFG Dubai';
    const desc = ev.tagline || (when + (ev.location ? ' · ' + ev.location : '') + '. Sign up on this page.');
    const canonical = 'https://www.lfgdubai.com/events/' + ev.slug;
    const image = ev.cover_url || 'https://www.lfgdubai.com/og-image.jpg';
    const schema = {
      '@context': 'https://schema.org', '@type': 'Event', name: ev.title, description: ev.tagline || ev.description || '',
      startDate: ev.starts_at, endDate: ev.ends_at || undefined, eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: ev.location ? { '@type': 'Place', name: ev.location } : undefined, image,
      organizer: { '@type': 'Organization', name: 'LFG Dubai', url: 'https://www.lfgdubai.com' },
      offers: { '@type': 'Offer', price: String(ev.price_aed || 0), priceCurrency: 'AED', availability: ev.sold_out ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock', url: canonical }
    };
    const mobileCover = ev.cover_small_url || ev.cover_url;
    const preload = ev.cover_url
      ? '<link rel="preload" as="image" href="' + esc(mobileCover) + '"' + (ev.cover_small_url ? ' imagesrcset="' + esc(ev.cover_small_url) + ' 800w, ' + esc(ev.cover_url) + ' 1600w" imagesizes="100vw"' : '') + ' fetchpriority="high">\n'
      : '';
    html = html
      .replace('<title>Event · LFG Dubai</title>', '<title>' + esc(title) + '</title>')
      .replace('<meta name="description" content="An LFG Dubai event. Sign up on this page.">', '<meta name="description" content="' + esc(desc) + '">\n<link rel="canonical" href="' + canonical + '">')
      .replace('<meta property="og:title" content="Event · LFG Dubai">', '<meta property="og:title" content="' + esc(title) + '">\n<meta property="og:url" content="' + canonical + '">')
      .replace('<meta property="og:description" content="Sign up on this page.">', '<meta property="og:description" content="' + esc(desc) + '">')
      .replace('<meta property="og:image" content="https://www.lfgdubai.com/og-image.jpg">', '<meta property="og:image" content="' + esc(image) + '">')
      .replace('<script type="application/ld+json" id="evSchema">{}</script>',
        preload + '<script type="application/ld+json" id="evSchema">' + JSON.stringify(schema).replace(/</g, '\\u003c') + '</script>\n<script>window.__evData = ' + JSON.stringify(ev).replace(/</g, '\\u003c') + ';</script>');
    if (ev.cover_url) {
      html = html
        .replace('<div class="ev-hero-media" id="evHeroMedia" hidden>', '<div class="ev-hero-media" id="evHeroMedia">')
        .replace('<img id="evCover" src="" alt="" sizes="100vw" fetchpriority="high" decoding="async">',
          '<img id="evCover" src="' + esc(ev.cover_url) + '"' + (ev.cover_small_url ? ' srcset="' + esc(ev.cover_small_url) + ' 800w, ' + esc(ev.cover_url) + ' 1600w"' : '') + ' alt="' + esc(ev.title) + '" sizes="100vw" fetchpriority="high" decoding="async">');
    }
    html = html
      .replace('<h1 class="ev-h1" id="evTitle"></h1>', '<h1 class="ev-h1" id="evTitle">' + esc(ev.title) + '</h1>')
      .replace('<p class="ev-kicker" id="evKicker"></p>', '<p class="ev-kicker" id="evKicker">LFG · ' + esc(dubai(ev.starts_at, { weekday: 'long', day: 'numeric', month: 'long' })) + '</p>')
      .replace('<p class="ev-deck" id="evDeck"></p>', '<p class="ev-deck" id="evDeck"' + (ev.tagline ? '' : ' style="display:none"') + '>' + esc(ev.tagline || '') + '</p>');
    return res.status(200).send(html);
  } catch (e) {
    return safeError(res, 'event-page', e, 'Could not load the event.');
  }
};
