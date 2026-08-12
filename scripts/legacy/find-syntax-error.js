// Locate the syntax error in admin.html by bracket-counting through the inline script.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

// Find the LAST <script>...</script> block (the IIFE we care about)
// Find the last `<script>` that does NOT have src= (the inline IIFE).
const lines = html.split('\n');
let scriptStartLine = -1;
for (let i = lines.length - 1; i >= 0; i--) {
  if (/^\s*<script>\s*$/.test(lines[i])) { scriptStartLine = i; break; }
}
const scriptStartIdx = lines.slice(0, scriptStartLine + 1).join('\n').length + 1;
const scriptEndIdx = html.indexOf('</script>', scriptStartIdx);
const beforeScriptLineCount = html.slice(0, scriptStartIdx).split('\n').length;
const src = html.slice(scriptStartIdx + '<script>'.length, scriptEndIdx);

let inStr = null, inComment = false;
let line = 1, col = 1;
let stack = []; // open braces/parens with their line
for (let i = 0; i < src.length; i++) {
  const c = src[i], next = src[i + 1];
  if (c === '\n') { line++; col = 1; } else col++;

  if (inComment) {
    if (c === '*' && next === '/') { inComment = false; i++; col++; }
    continue;
  }
  if (inStr) {
    if (c === '\\') { i++; col++; continue; }
    if (c === inStr) inStr = null;
    continue;
  }
  if (c === '/' && next === '*') { inComment = true; i++; col++; continue; }
  if (c === '/' && next === '/') {
    while (i < src.length && src[i] !== '\n') i++;
    line++; col = 1;
    continue;
  }
  if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }

  if (c === '{') stack.push({ kind: '{', line, col, scriptLine: line });
  else if (c === '}') {
    const top = stack.pop();
    if (!top || top.kind !== '{') console.log('UNMATCHED } at script line', line, '(admin line ' + (line + beforeScriptLineCount - 1) + ')');
  }
  else if (c === '(') stack.push({ kind: '(', line, col, scriptLine: line });
  else if (c === ')') {
    const top = stack.pop();
    if (!top || top.kind !== '(') console.log('UNMATCHED ) at script line', line, '(admin line ' + (line + beforeScriptLineCount - 1) + ')');
  }
  else if (c === '[') stack.push({ kind: '[', line, col });
  else if (c === ']') {
    const top = stack.pop();
    if (!top || top.kind !== '[') console.log('UNMATCHED ] at script line', line);
  }
}

console.log('Script tag opens at admin.html line:', beforeScriptLineCount);
console.log('\nUnclosed openings remaining on stack:');
stack.forEach(e => {
  console.log('  ' + e.kind + ' opened at script line ' + e.line + ' col ' + e.col + ' (admin.html line ' + (e.line + beforeScriptLineCount - 1) + ')');
});
