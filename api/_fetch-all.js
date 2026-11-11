// Every row of a query, a page at a time. A plain Supabase select stops at 1,000
// rows and says nothing when it does: members passed 1,000 and the run scan board
// showed "—" for everyone past the cap (11 Nov 2026), while bookings (1,128) were
// already being cut short in the leads feed and the Today dashboard. Same loop as
// fetchAllRows in _lib.js, in its own file so _run-pay and _padel-rating can use it
// without requiring _lib. The query needs a unique order (id) or pages can repeat
// or skip rows.
async function fetchAllRows(makeQuery, pageSize = 1000) {
  const out = [];
  for (let from = 0; from < 200000; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) return { data: out, error };
    const rows = data || [];
    for (const r of rows) out.push(r);
    if (rows.length < pageSize) break;
  }
  return { data: out, error: null };
}

module.exports = { fetchAllRows };
