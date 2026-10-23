// Local static server for the isolated network-privacy preview. No wallet services or proxying.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../web');
export const previewPath = '/dev/network-privacy/';
export const staticPaths = new Set([previewPath, `${previewPath}index.html`,
  `${previewPath}preview.js`,
  `${previewPath}preview.css`, '/design-system.css', '/approval-visualization.css', '/logo.png',
  '/fonts/geist-latin.woff2']);
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', png: 'image/png', woff2: 'font/woff2' };

export async function createPreviewServer(port = 0) {
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (request.method !== 'GET' || !staticPaths.has(path)) {
      response.writeHead(404).end('Not a preview asset.'); return;
    }
    const relative = path.endsWith('/') ? `${path}index.html` : path;
    try {
      const body = readFileSync(resolve(webRoot, `.${relative}`));
      response.writeHead(200, { 'Content-Type': types[relative.split('.').pop()],
        'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff' }).end(body);
    } catch { response.writeHead(404).end('Preview asset unavailable.'); }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port,
    '127.0.0.1', done); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { origin } = await createPreviewServer(Number(process.env.PRIVACY_PREVIEW_PORT || 4178));
  console.log(`Network privacy design preview: ${origin}${previewPath}`);
}
