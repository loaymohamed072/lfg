// Local dev server: serves the static LFG site AND the /api/*.js serverless
// functions together, mimicking Vercel's req/res. Run with:
//   node --env-file=.env scripts/dev-server.js
// This is a LOCAL DEV TOOL ONLY. On Vercel the same /api functions run natively.
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4',
  '.mov': 'video/quicktime', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain',
  '.webmanifest': 'application/manifest+json'
};

function send(res, code, body, type) {
  res.statusCode = code;
  if (type) res.setHeader('content-type', type);
  res.end(body);
}

// Add the Vercel-style helpers our functions rely on.
function wrapRes(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  res.send = (s) => { res.end(s); };
  return res;
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (!data) return resolve(undefined);
      // Stripe webhooks need the raw body; expose both.
      req.rawBody = data;
      try { resolve(JSON.parse(data)); } catch { resolve(data); }
    });
    req.on('error', () => resolve(undefined));
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  // Dev-only: reset in-memory rate-limit buckets so the QA harness starts clean.
  // Does nothing on Vercel because this route doesn't exist there.
  if (pathname === '/__debug/reset-rate-limits' && req.method === 'POST') {
    if (global.__lfgPromoBucket) global.__lfgPromoBucket.clear();
    if (global.__lfgRunRegisterBucket) global.__lfgRunRegisterBucket.clear();
    return send(res, 200, JSON.stringify({ ok: true }), 'application/json');
  }

  // ---- API routes -> /api/<name>.js ----
  if (pathname.startsWith('/api/')) {
    const name = pathname.slice('/api/'.length).replace(/\/+$/, '');
    const file = path.join(ROOT, 'api', name + '.js');
    if (!name || !fs.existsSync(file)) {
      return send(res, 404, JSON.stringify({ error: 'Not found' }), 'application/json');
    }
    try {
      // Hot reload: clear every cached module under /api (handler + shared _lib).
      const apiDir = path.join(ROOT, 'api');
      Object.keys(require.cache).forEach((k) => { if (k.startsWith(apiDir)) delete require.cache[k]; });
      const handler = require(file);
      req.query = parsed.query;
      req.body = await parseBody(req);
      wrapRes(res);
      return handler(req, res);
    } catch (e) {
      console.error('[api error]', name, e);
      return send(res, 500, JSON.stringify({ error: String((e && e.message) || e) }), 'application/json');
    }
  }

  // ---- Static files + Vercel-style cleanUrls ----
  let filePath = pathname === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const htmlPath = path.join(ROOT, pathname.replace(/\/+$/, '') + '.html');
    if (fs.existsSync(htmlPath)) filePath = htmlPath;
    else return send(res, 404, 'Not found', 'text/plain');
  }
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('content-type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store'); // dev: always serve fresh assets
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => console.log('LFG dev server (static + /api) → http://localhost:' + PORT));
