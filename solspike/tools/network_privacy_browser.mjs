import { forEachCase } from "../harness/ui-matrix.mjs";
// Synthetic-only UX and isolation checks. No production wallet boot and no live services.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreviewServer, previewPath, staticPaths } from './network_privacy_preview.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(root, process.env.PRIVACY_QA_DIR || 'docs/ux-redesign/visuals/network-privacy');
mkdirSync(out, { recursive: true });
const { chromium, firefox, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engines = { chromium, firefox, webkit };
const engine = process.env.PRIVACY_BROWSER || 'chromium';
assert.ok(engines[engine], 'Supported browser engine');
const { server, origin } = await createPreviewServer();
const requests = [], failures = [], screenshots = [], checks = [];
const check = (pass, label) => { assert.ok(pass, label); checks.push(label); };
let browser;
try {
  browser = await engines[engine].launch({ headless: true,
    ...(process.env.CHROME_EXECUTABLE && engine === 'chromium' ? {
      executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 },
    reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    const request = route.request(), url = new URL(request.url());
    requests.push({ path: url.pathname, type: request.resourceType(), method: request.method() });
    if (url.origin !== origin || !staticPaths.has(url.pathname) || request.method() !== 'GET') {
      failures.push('Unexpected request: ' + url.pathname); return route.abort();
    }
    return route.continue();
  });
  await context.addInitScript(() => {
    const attempts = [];
    Object.defineProperty(window, '__privacyAttempts', { value: attempts });
    const refuse = (name) => function () { attempts.push(name); throw new Error(
      'Preview isolation: ' + name); };
    for (const name of ['fetch', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker',
      'XMLHttpRequest',
      'RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport', 'BroadcastChannel']) {
      Object.defineProperty(window, name, { configurable: true, value: refuse(name) });
    }
    for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) {
      Object.defineProperty(window, name, { configurable: true, get: refuse(name) });
    }
    Object.defineProperty(document, 'cookie', { configurable: true, get: refuse(
      'cookie read'), set: refuse('cookie write') });
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: refuse(
      'sendBeacon') });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get: refuse(
      'serviceWorker') });
    document.addEventListener('securitypolicyviolation', (event) => attempts.push('CSP: ' +
      event.violatedDirective));
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => failures.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') failures.push(m.text()); });
  page.on('websocket', () => failures.push('WebSocket opened'));
  page.on('worker', () => failures.push('Worker started'));
  const click = (name) => page.getByRole('button', { name, exact: true }).click();
  const scenario = (name) => page.getByLabel('Scenario', { exact: true }).selectOption(name);
  const label = () => page.locator('#connection-label').textContent();
  async function screenshot(name) {
    // Playwright's WebKit screenshot shim injects an inline `body {}` style, violating the
    // preview's CSP. Keep WebKit isolation strict; capture the shared design in Chromium.
    if (engine !== 'chromium') return;
    await page.screenshot({ path: resolve(out, name + '.png'), fullPage: true,
      animations: 'disabled' });
    screenshots.push(name + '.png');
  }
  async function isolation() {
    const attempts = await page.evaluate(() => window.__privacyAttempts);
    check(attempts.length === 0,
      'No network constructors, service APIs, storage access or CSP violations: ' +
        JSON.stringify(attempts));
    check(failures.length === 0, 'No unexpected requests or browser errors: ' + JSON.stringify(
      failures));
  }
  await page.goto(origin + previewPath);
  await page.getByRole('heading', { name: 'Your wallet. Your way to connect.' }).waitFor();
  check(await label() === 'Connection not selected',
    'Welcome does not imply a selected or connected transport');
  await screenshot('welcome-1440-dark');
  await click('Get started');
  const privateRadio = page.getByRole('radio', { name: /Private connection/ });
  const standardRadio = page.getByRole('radio', { name: /Standard connection/ });
  check(await privateRadio.isChecked(), 'Private is initially selected');
  await privateRadio.focus(); await page.keyboard.press('ArrowDown');
  check(await standardRadio.isChecked(), 'Native radio group supports arrow-key selection');
  await page.keyboard.press('ArrowUp');
  check(await privateRadio.isChecked(), 'Native radio group can return to Private');
  await screenshot('choice-1440-dark');
  await click('Continue');
  check(await label() === 'Private · Connecting',
    'Private selection waits for transport readiness');
  for (let i = 0; i < 3; i++) await click('Show next milestone');
  check(await page.locator('.milestones .done').count() === 3,
    'Milestones advance only through review controls');
  await screenshot('establishing-1440-dark');
  await click('Show services verified');
  check(await label() === 'Private · Connected',
    'Only final review action shows the illustrative connected state');
  await click('Settings'); await click('Manage connection');
  check(await page.getByRole('dialog').isVisible(), 'Settings opens connection dialog');
  await page.keyboard.press('Escape');
  check(await page.getByRole('button', { name: 'Manage connection', exact: true }).evaluate(
    (n) => n === document.activeElement), 'Escape restores focus to Settings opener');
  await page.locator('#connection-status').click();
  check(await page.getByRole('heading', { name: 'Privacy & Network',
    exact: true }).count() === 2, 'Header opens the same connection panel as Settings');
  await click('Switch to Standard');
  check(await label() === 'Private · Connected',
    'Opening downgrade confirmation leaves Private selected');
  await click('Keep current connection');
  check(await label() === 'Private · Connected', 'Cancelling downgrade retains Private');
  await click('Switch to Standard'); await page.keyboard.press('Escape');
  check(await label() === 'Private · Connected',
    'Escape from downgrade never acknowledges Standard');
  await page.locator('#connection-status').click(); await click('Switch to Standard');
  await click('Use Standard connection');
  check(await label() === 'Standard · Switching', 'Confirmed switch pauses in Switching');
  await click('Show Standard connected');
  check(await label() === 'Standard · Connected',
    'Standard becomes connected only through explicit scenario action');
  await page.locator('#connection-status').click(); await click(
    'Switch to Private'); await click('Use Private connection');
  check(await label() === 'Private · Switching',
    'Switch back to Private has its own readiness phase');
  for (let i = 0; i < 3; i++) await click('Show next milestone');
  await click('Show services verified');
  await forEachCase(['formation', 'signing', 'broadcast'], async (activity) => {
    await scenario('connected'); await page.getByLabel('Wallet safety scenario').selectOption(
      activity);
    await page.locator('#connection-status').click(); await click(
      'Switch to Standard'); await click('Use Standard connection');
    check(await label() === 'Private · Connected', `Switch deferred safely during ${activity}`);
    check(await page.getByRole('button', { name: 'Show safe point',
      exact: true }).isVisible(), `Safe-point control offered for ${activity}`);
    if (activity === 'signing') await screenshot('deferred-signing-1440-dark');
    await click('Show safe point');
    check(await label() === 'Standard · Switching',
      `${activity} safe point starts requested switch`);
    await click('Show Standard connected');
  });
  await scenario('choice'); await standardRadio.check(); await click('Continue');
  check(await label() === 'Standard · Connected', 'Standard first-launch path proceeds directly');
  const statuses = { connecting: 'Private · Connecting', validating: 'Private · Connecting',
    connected: 'Private · Connected',
    standard: 'Standard · Connected', reconnecting: 'Private · Reconnecting',
      interrupted: 'Private · Interrupted',
    switching: 'Private · Switching', offline: 'Private · Offline',
      'standard-offline': 'Standard · Offline',
    unavailable: 'Private · Unavailable', 'return-private': 'Private · Connecting',
      'return-standard': 'Standard · Connected',
    'no-preference': 'Connection not selected' };
  await forEachCase(Object.entries(statuses), async ([name, expected]) => {
    await scenario(name); check(await label() === expected, `Scenario: ${name}`);
    if (name === 'return-private' || name === 'return-standard') check(await page.getByRole(
      'heading', { name: 'Privacy is your choice.' }).count() === 0,
        'Returning preference skips choice');
    if (name === 'no-preference') check(await privateRadio.isVisible(),
      'Unavailable preference asks again');
  });
  await forEachCase(['interrupted', 'offline', 'unavailable'], async (failure) => {
    await scenario(failure); await page.locator('#connection-status').click();
    check(await page.getByRole('button', { name: 'Retry private connection',
      exact: true }).isVisible(), `${failure} offers retry`);
    await click('Switch to Standard'); await click('Keep current connection');
    check((await label()).startsWith('Private'), `${failure} has no automatic downgrade`);
    await click('Retry private connection');
    check(await label() === 'Private · Reconnecting', `${failure} retry retains Private`);
  });
  await scenario('interrupted'); await page.locator('#connection-status').click();
  await screenshot('interrupted-dialog-1440-dark');
  // Native dialog trapping: tabbing through every control stays inside the modal.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    check(await page.evaluate(() => document.querySelector('dialog').contains(
      document.activeElement)), 'Dialog traps keyboard focus');
  }
  await page.keyboard.press('Escape');
  check(await page.locator('#connection-status').evaluate((n) => n ===
    document.activeElement), 'Header focus restored after modal dismissal');
  check(await page.locator('#announcement').getAttribute('aria-live') === 'polite',
    'Connection states have a polite live region');
  await isolation();

  // Contrast checks composite translucent backgrounds against their actual ancestors.
  async function contrast() {
    return page.evaluate(() => {
      const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
      const over = (a, b) => { const alpha = a[3] ?? 1; return a.slice(0, 3).map((n, i) => n *
        alpha + b[i] * (1 - alpha)); };
      const background = (n) => { const chain = []; for (; n; n =
        n.parentElement) chain.unshift(n); let color = [255, 255, 255];
        for (const e of chain) color = over(rgb(getComputedStyle(e).backgroundColor),
          color); return color; };
      const luminance = (color) => color.map((v) => { v /= 255; return v <= .04045 ? v /
        12.92 : ((v + .055) / 1.055) ** 2.4; })
        .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const hasVisibleText = (el) => el.checkVisibility() && !el.closest('.sr-only')
        && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const errors = [];
      for (const el of document.querySelectorAll('body *')) {
        if (!hasVisibleText(el)) continue;
        const style = getComputedStyle(el), bg = background(el), fg = over(rgb(style.color), bg);
        const a = luminance(bg), b = luminance(fg), ratio = (Math.max(a, b) + .05) / (Math.min(
          a, b) + .05);
        const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >=
          18.66 && parseFloat(style.fontWeight) >= 700;
        if (ratio < (large ? 3 : 4.5)) errors.push({ text: el.textContent.trim().slice(0, 50),
          ratio });
      }
      return errors;
    });
  }
  await forEachCase(['dark', 'light'], async (theme) => {
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme',
      exact: true }).click();
    await forEachCase([1440, 390], async (width) => {
      await page.setViewportSize({ width, height: 1000 });
      await forEachCase(['welcome', 'choice', 'connecting', 'connected', 'unavailable'],
        async (scene) => {
        await scenario(scene);
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${scene} has no horizontal overflow at ${width}px ${theme}`);
        const lowContrast = await contrast();
        check(lowContrast.length === 0,
          `${scene} text contrast at ${width}px ${theme}: ${JSON.stringify(lowContrast)}`);
        if (scene === 'choice' || scene === 'connected' && width === 390) await screenshot(
          `${scene}-${width}-${theme}`);
      });
      await scenario('connected'); await click('Settings'); await click('Manage connection');
      check(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth),
        `Dialog reflows at ${width}px ${theme}`);
      if (width === 390) await screenshot(`settings-dialog-${width}-${theme}`);
      await page.keyboard.press('Escape');
      // CSS zoom magnifies the rendered UI.
      // Viewport halving also checks browser-zoom reflow width.
      await forEachCase(['choice', 'connected'], async (scene) => {
        await scenario(scene);
        await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `200% zoom: ${scene} at ${width}px ${theme}`);
        if (scene === 'choice') await screenshot(`choice-${width}-${theme}-zoom200`);
        await page.evaluate(() => { document.documentElement.style.zoom = ''; });
      });
      await isolation();
    });
  });
  await page.setViewportSize({ width: 720, height: 500 }); await scenario('choice');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Half-width viewport reflows for desktop browser zoom');
  const reduced = await page.locator('.fade-in').evaluate((el) => getComputedStyle(
    el).animationName);
  check(reduced === 'none', 'Reduced motion removes entrance animations');
  await scenario('standard'); await click('Settings'); await click('Manage connection');
  await click('Switch to Private'); await click('Use Private connection'); await isolation();
  await page.reload();
  check(await label() === 'Connection not selected',
    'Reload resets tab-only choices without persistence');
  await isolation();
  const report = { browser: engine, checks: checks.length, requests: [...new Set(requests.map(
    (r) => r.path))].sort(),
    screenshots, failures, scope: (
      "Synthetic preview only. No verification of production "
      + "Tor, transport safety or network privacy."
    ), results: checks };
  writeFileSync(resolve(out, `qa-${engine}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log((
    `${checks.length}`
    + " checks passed; "
    + `${screenshots.length}`
    + " screenshots; only allowlisted static assets requested."
  ));
} finally {
  await browser?.close(); await new Promise((done) => server.close(done));
}
