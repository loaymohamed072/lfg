// Keeps recurring Event JSON-LD current.
//
// Google's Event rich result needs a real startDate and ignores eventSchedule, so
// a weekly session marked up with a schedule alone fails validation. This reads
// each block's own eventSchedule and writes the next occurrence that has not
// ended yet as startDate / endDate.
//
// No network on purpose: robots.txt disallows /api/, so anything a page fetches
// from there never reaches a crawler. The padel page still overrides these
// values from live config for real visitors (lfg-padel-page.js goLive).
//
// Dubai is UTC+4 all year, no daylight saving, so the offset is fixed.
(function () {
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var OFFSET_MS = 4 * 3600000;

  // "PT1H", "PT1H30M", "PT90M" -> milliseconds. Anything else -> 0.
  function durationMs(iso) {
    var m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(iso || '');
    return m ? ((+m[1] || 0) * 60 + (+m[2] || 0)) * 60000 : 0;
  }

  // UTC ms -> "2026-09-27T12:45:00+04:00"
  function stamp(ms) {
    return new Date(ms + OFFSET_MS).toISOString().slice(0, 16) + ':00+04:00';
  }

  function nextOccurrence(nowMs, schedule) {
    var day = DAYS.indexOf(String(schedule.byDay || '').split('/').pop());
    var t = /^(\d{1,2}):(\d{2})$/.exec(schedule.startTime || '');
    if (day < 0 || !t) return null;
    var len = durationMs(schedule.duration);
    // Shifted by the offset, so getUTC* reads the Dubai wall clock.
    var dubai = new Date(nowMs + OFFSET_MS);
    var start = Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth(),
      dubai.getUTCDate() + (day - dubai.getUTCDay() + 7) % 7, +t[1], +t[2]) - OFFSET_MS;
    if (start + len <= nowMs) start += 7 * 86400000;
    var out = { startDate: stamp(start) };
    if (len) out.endDate = stamp(start + len);
    return out;
  }

  if (typeof document === 'undefined') { module.exports = { nextOccurrence: nextOccurrence }; return; }

  var blocks = document.querySelectorAll('script[type="application/ld+json"]');
  for (var i = 0; i < blocks.length; i++) {
    try {
      var data = JSON.parse(blocks[i].textContent);
      if (!data.eventSchedule) continue;
      var next = nextOccurrence(Date.now(), data.eventSchedule);
      if (!next) continue;
      data.startDate = next.startDate;
      if (next.endDate) data.endDate = next.endDate;
      blocks[i].textContent = JSON.stringify(data, null, 2);
    } catch (e) { /* block stays as shipped */ }
  }
})();
