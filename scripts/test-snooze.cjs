// Unit checks for the snooze date logic, both halves.
// Pure functions lifted verbatim from admin.html + api/admin/lead-touch.js.
// No network, no DB, no API tokens.
const fs = require('fs');
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); ok ? pass++ : fail++; };

// ---- server side: snoozeUntil() ----
const api = fs.readFileSync('api/admin/lead-touch.js', 'utf8');
const MAX_DAYS = 730;
const snoozeUntil = new Function('body', 'MAX_DAYS',
  api.slice(api.indexOf('function snoozeUntil(body) {') + 'function snoozeUntil(body) {'.length,
           api.indexOf('\n}', api.indexOf('function snoozeUntil(body) {'))));
const call = (b) => snoozeUntil(b, MAX_DAYS);

const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

check('a picked date is honoured', call({ snooze_until: day(10) }).slice(0, 10) === day(10),
  call({ snooze_until: day(10) }));
check('resurfaces at 04:00 UTC (8am Dubai)', call({ snooze_until: day(10) }).includes('T04:00:00'));
check('a past date is rejected', call({ snooze_until: day(-1) }) === null);
check('today is rejected (not a snooze)', call({ snooze_until: day(0) }) === null);
check('garbage date falls back to days', typeof call({ snooze_until: 'not-a-date', snooze_days: 5 }) === 'string');
check('no date falls back to 3 days', Math.round((Date.parse(call({})) - Date.now()) / 86400000) === 3);
check('day count still works', Math.round((Date.parse(call({ snooze_days: 14 })) - Date.now()) / 86400000) === 14);
const far = call({ snooze_until: day(5000) });
check('an absurd date is capped, not accepted', Math.round((Date.parse(far) - Date.now()) / 86400000) <= MAX_DAYS,
  `${Math.round((Date.parse(far) - Date.now()) / 86400000)} days`);
check('two years out is allowed', call({ snooze_until: day(700) }) !== null);

// ---- client side: the badge decision ----
const html = fs.readFileSync('admin.html', 'utf8');
const grab = (name) => {
  const start = html.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found`);
  let i = html.indexOf('{', start), depth = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}' && --depth === 0) return html.slice(start, j + 1);
  }
};
const ctx = { esc: (x) => String(x) };
new Function('ctx', `with(ctx){${grab('isoDay')}${grab('prettyDay')}${grab('daysUntil')}${grab('snoozeBadge')}
  ctx.isoDay=isoDay;ctx.prettyDay=prettyDay;ctx.daysUntil=daysUntil;ctx.snoozeBadge=snoozeBadge;}`)(ctx);

const at = (n) => new Date(Date.now() + n * 86400000).toISOString();
check('future snooze shows the return date',
  /back \w/.test(ctx.snoozeBadge({ touch: { status: 'snoozed', snooze_until: at(5) } })),
  ctx.snoozeBadge({ touch: { status: 'snoozed', snooze_until: at(5) } }));
check('elapsed snooze shows Follow up due',
  ctx.snoozeBadge({ touch: { status: 'snoozed', snooze_until: at(-1) } }).includes('Follow up due'));
check('non-snoozed lead gets no badge', ctx.snoozeBadge({ touch: { status: 'contacted' } }) === '');
check('lead with no touch row is safe', ctx.snoozeBadge({}) === '');
check('corrupt date is safe', ctx.snoozeBadge({ touch: { status: 'snoozed', snooze_until: 'xx' } }) === '');
check('daysUntil counts whole days', ctx.daysUntil(day(7)) === 7, `got ${ctx.daysUntil(day(7))}`);

console.log(`\nSNOOZE: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
