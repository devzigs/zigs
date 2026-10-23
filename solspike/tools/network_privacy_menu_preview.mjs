// Actual UI renderers with a synthetic wallet, inert reactor and no production boot.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../web');
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png',
  svg: 'image/svg+xml', woff2: 'font/woff2' };
const fixtureScript = (
  "\nimport { state, ui } from '/app-state.js';\nimport { "
  + "draw } from '/app-loop.js';\nimport { "
  + "closeNetworkPrivacy } from '/app-network-privacy.js';\ni"
  + "mport { installPrivacyPopup } from "
  + "'/network-privacy-popup.js';\nconst g = { id: "
  + "'e1'.repeat(10), name: 'Sample wallet', n: 3, t: 2, "
  + "version: 2, network: 'testnet' };\nconst toolbar = "
  + "document.createElement('aside');\ntoolbar.id = "
  + "'privacy-menu-fixture';\nconst label = "
  + "document.createElement('label');\nlabel.textContent = "
  + "'Synthetic menu preview · No accounts or funds loaded. "
  + "';\nconst select = document.createElement('select');\nsel"
  + "ect.setAttribute('aria-label', 'Preview app "
  + "screen');\nfor (const [value, title] of "
  + "[['welcome','Welcome'],['wallet','Wallet "
  + "header'],['settings','Wallet Settings'],['app-settings'"
  + ",'App Settings']]) {\n  const option = "
  + "document.createElement('option'); option.value = "
  + "value; option.textContent = title; "
  + "select.append(option);\n}\nlabel.append(select); "
  + "toolbar.append(label); document.body.prepend(toolbar);\n"
  + "function scene(value) {\n  closeNetworkPrivacy();\n  "
  + "const wallet = value === 'wallet' || value === "
  + "'settings';\n  Object.assign(state, { g: wallet ? g : "
  + "null, gid: wallet ? g.id : null, groups: wallet ? [g] "
  + ": [],\n    wallet: wallet ? { birthday: 4500000, "
  + "address: 'utest1synthetic', group_verifying_key: "
  + "'abcd'.repeat(16), ufvk: 'uviewtest1synthetic' } : "
  + "null,\n    seats: {}, sessions: [], sid: null, log: [] "
  + "});\n  ui.tab = value === 'wallet' ? 'activity' : "
  + "value.includes('settings') ? 'settings' : 'overview';\n "
  + " select.value = value;\n  draw();\n}\nselect.addEventListe"
  + "ner('change', () => scene(select.value));\nglobalThis.pr"
  + "ivacyMenuFixture = { state, ui, draw, scene "
  + "};\nscene('welcome');\ninstallPrivacyPopup();\n"
);
const fixtureCss = (
  "#privacy-menu-fixture{padding:12px "
  + "20px;background:var(--sunk);border-bottom:1px solid "
  + "var(--line);color:var(--muted);font:12px/1.5 "
  + "var(--sans)}#privacy-menu-fixture "
  + "select{font:inherit;color:var(--text);background:var(--"
  + "panel);border:1px solid var(--control-line);padding:8px"
  + ";border-radius:8px;margin:4px 8px;max-width:100%}"
);

function previewBody(path, body, privacyDemo) {
  if (path === '/' && !privacyDemo) return body.toString()
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<link[^>]+rel="(?:modulepreload|preload)"[^>]*>/g, '')
    .replace('</head>', '<link rel="stylesheet" href="/privacy-menu-fixture.css"></head>')
    + '<script type="module" src="/privacy-menu-fixture.js"></script>';
  if (path === '/app-loop.js') return body.toString()
    .replace('export function react() {', 'export function react() { return;');
  if (path === '/app-groups.js') return body.toString().replace('dbReady = false',
    'dbReady = true');
  return body;
}

function previewAsset(path, privacyDemo) {
  const fixtures = { '/privacy-menu-fixture.js': { body: fixtureScript, type: types.js },
    '/privacy-menu-fixture.css': { body: fixtureCss, type: types.css } };
  if (fixtures[path]) return fixtures[path];
  const relative = path === '/' ? '/index.html' : path.endsWith('/') ? path + 'index.html' : path;
  const file = resolve(root, '.' + relative), type = types[relative.split('.').pop()];
  if (!file.startsWith(root + '/') || !existsSync(file) || !type) return null;
  return { body: previewBody(path, readFileSync(file), privacyDemo), type };
}

export async function createMenuPreviewServer(port = 0) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost'), path = url.pathname;
    if (request.method !== 'GET' || /^\/(ws|lwd|zns)(\/|$)/.test(path)
      || path === '/sol/config.json') {
      response.writeHead(404).end('Wallet services are unavailable in this UI fixture.'); return;
    }
    const asset = previewAsset(path, url.searchParams.get('demo') === 'privacy');
    if (!asset) { response.writeHead(404).end('Not a UI preview asset.'); return; }
    response.writeHead(200, { 'Content-Type': asset.type,
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).end(asset.body);
  });
  await new Promise((done, reject) => {
    server.once('error', reject); server.listen(port, '127.0.0.1', done);
  });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { origin } = await createMenuPreviewServer(Number(process.env.PRIVACY_MENU_PORT || 4190));
  console.log(`Privacy menu integration preview: ${origin}/`);
}
