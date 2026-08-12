// Extract every <script> block from admin.html and syntax-check it.
// This file has no build step, so a typo ships straight to production.
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('admin.html', 'utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, n = 0, bad = 0;
while ((m = re.exec(html))) {
  n++;
  const code = m[1];
  const line = html.slice(0, m.index).split('\n').length;
  try { new vm.Script(code, { filename: `admin.html:<script#${n}> (line ${line})` }); }
  catch (e) { bad++; console.log(`✗ script #${n} starting line ${line}: ${e.message}`); }
}
console.log(`${n} inline script block(s), ${bad} with syntax errors`);
process.exit(bad === 0 ? 0 : 1);
