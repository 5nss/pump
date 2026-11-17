// Local dev server: serves public/ and runs api/*.js like Vercel does.  node scripts/dev.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2]) || 3000;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  if (u.pathname.startsWith('/api/')) {
    const file = path.join(ROOT, 'api', path.basename(u.pathname) + '.js');
    if (!fs.existsSync(file) || path.basename(u.pathname).startsWith('_')) { res.statusCode = 404; return res.end('{"error":"Not found"}'); }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      req.query = u.query;
      try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = undefined; }
      require(file)(req, res);
    });
    return;
  }
  const rel = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
  const file = path.join(ROOT, 'public', rel);
  if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('Pump Analysis on http://localhost:' + PORT));
