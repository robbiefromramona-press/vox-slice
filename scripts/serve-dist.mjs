// Tiny static server for dist/ that applies public/_headers exactly like the
// host does (Cloudflare / Netlify format), so headers and CSP can be tested
// locally against the production build:  npm run build && node scripts/serve-dist.mjs [port]
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname, resolve } from 'node:path';
const root = resolve(process.argv[3] || 'dist');
const port = Number(process.argv[2] || 5190);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.js.map': 'application/json' };
const rules = [];
let cur = null;
for (const raw of readFileSync(join(root, '_headers'), 'utf8').split(/\r?\n/)) {
  if (!raw.trim() || raw.trim().startsWith('#')) continue;
  if (!/^\s/.test(raw)) { cur = { pat: raw.trim(), h: [] }; rules.push(cur); continue; }
  const i = raw.indexOf(':'); cur.h.push([raw.slice(0, i).trim(), raw.slice(i + 1).trim()]);
}
const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
const match = (pat, p) => new RegExp('^' + esc(pat) + '$').test(p);
createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = join(root, p);
  if (p.endsWith('/')) f = join(root, p, 'index.html');
  else if (!existsSync(f) && existsSync(f + '.html')) f += '.html';
  if (!f.startsWith(root) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); return res.end('not found'); }
  const h = { 'Content-Type': types[extname(f)] || 'application/octet-stream' };
  for (const r of rules) if (match(r.pat, p)) for (const [k, v] of r.h) h[k] = v;
  res.writeHead(200, h); createReadStream(f).pipe(res);
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
