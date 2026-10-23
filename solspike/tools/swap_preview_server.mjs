// Loopback-only dev harness. Serves the real application modules without starting a wallet.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const web = resolve(root, 'web');
const before = execFileSync('git', ['show', '27a81b1:web/app-shell.js'], { cwd: root });
const html = readFileSync(resolve(web, 'index.html'), 'utf8')
  .replace(/<link rel="(?:modulepreload|preload)" href="\/pkg[^>]*>/g, '')
  .replace('<script type="module" src="/app.js"></script>',
    '<script type="module" src="/__swap_harness__.mjs"></script>');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
    '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', (
      "default-src 'self'; script-src 'self'; style-src "
      + "'self'; img-src 'self' data:; connect-src 'none'"
    ));
    if (path === '/__swap_preview__') { res.setHeader('Content-Type', 'text/html'); res.end(
      html); return; }
    if (path === '/__swap_before__.js') { res.setHeader('Content-Type',
      'text/javascript'); res.end(before); return; }
    if (path === '/__swap_harness__.mjs') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(readFileSync(resolve(root, 'solspike/harness/swap-preview.mjs'))); return;
    }
    const file = resolve(web, '.' + decodeURIComponent(path));
    if (!file.startsWith(web + '/')) { res.writeHead(403); res.end(); return; }
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(Number(process.env.ZIGS_SWAP_PORT || 8856), '127.0.0.1', () => {
  console.log('Swap preview: http://127.0.0.1:' + server.address().port + '/__swap_preview__');
});
