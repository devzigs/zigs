import { forEachCase } from "../harness/ui-matrix.mjs";
// Verify the compact popup over the real landing/menu renderers with synthetic wallet state.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMenuPreviewServer } from './network_privacy_menu_preview.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(root, process.env.PRIVACY_POPUP_QA_DIR ||
  'docs/ux-redesign/visuals/network-privacy-popup');
mkdirSync(out, { recursive: true });
const engines = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.PRIVACY_BROWSER || 'chromium';
const { server, origin } = await createMenuPreviewServer();
const KEY = 'zigs-privacy-popup-demo:v1';
const checks = [], errors = [], requests = [];
const check = (ok, label) => { assert.ok(ok, label); checks.push(label); };
let browser;
try {
  browser = await engines[engine].launch({ headless: true,
    ...(engine === 'chromium' && process.env.CHROME_EXECUTABLE ? {
      executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    const request = route.request(), url = new URL(request.url()); requests.push(url.pathname);
    if (url.origin !== origin || request.method() !== 'GET' || /^\/(ws|lwd|zns)(\/|$)/.test(
      url.pathname)
      || url.pathname === '/sol/config.json' || /\.(wasm|json)$/.test(url.pathname)) {
      errors.push('Unexpected wallet/service request: ' + url.pathname); return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('worker', () => errors.push('Worker started')); page.on('websocket',
    () => errors.push('Socket opened'));
  const popup = page.locator('#privacy-demo-popup');
  const status = page.locator('#privacy-demo-status');
  const click = (name) => popup.getByRole('button', { name, exact: true }).click();
  const heading = (name) => popup.getByRole('heading', { name, exact: true }).waitFor();
  const scene = (value) => page.getByRole('combobox', { name: 'Preview app screen',
    exact: true }).selectOption(value);
  async function shot(name) {
    if (engine === 'chromium') await page.screenshot({ path: resolve(out, name + '.png'),
      animations: 'disabled', fullPage: false });
  }
  async function contrast() {
    return popup.evaluate((popup) => {
      const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
      const over = (a, b) => a.slice(0, 3).map((n, i) => n * (a[3] ?? 1) + b[i] * (1 - (
        a[3] ?? 1)));
      const bg = (node) => {
        const chain = []; for (; node; node = node.parentElement) chain.unshift(node);
        return chain.reduce((color, n) => over(rgb(getComputedStyle(n).backgroundColor),
          color), [255, 255, 255]);
      };
      const lum = (color) => color.map((v) => { v /= 255; return v <= .04045 ? v / 12.92 :
        ((v + .055) / 1.055) ** 2.4; })
        .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      return [...popup.querySelectorAll('*')].filter((node) => {
        if (!node.checkVisibility() || ![...node.childNodes].some((n) => n.nodeType === 3 &&
          n.textContent.trim())) return false;
        const s = getComputedStyle(node), background = bg(node), a = lum(background), b = lum(
          over(rgb(s.color), background));
        const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        const large = parseFloat(s.fontSize) >= 24 || parseFloat(s.fontSize) >= 18.66 &&
          parseFloat(s.fontWeight) >= 700;
        return ratio < (large ? 3 : 4.5);
      }).map((n) => n.textContent.trim().slice(0, 60));
    });
  }
  async function offered() { await heading('Make your connection private.'); }
  async function reset() { await page.evaluate((key) => localStorage.removeItem(key),
    KEY); await page.reload(); await offered(); }
  await page.goto(origin); await offered();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  check(await page.locator('.welcome').isVisible(),
    'Existing landing remains visible behind the automatic popup');
  check(await popup.evaluate((n) => n.getBoundingClientRect().width <= 460),
    'Popup is compact rather than a replacement page');
  check(await page.locator('.nd-root').count() === 0,
    'Rejected full-screen synthetic app is absent');
  check(await page.locator('.privacy-demo-topbar').count() === 0,
    'No extra header or bar above the app');
  check(await status.evaluate((n) => !!n.closest('.home-masthead')),
    'Status is part of the original landing header');
  check(await popup.getByText(
    'Preview only. No Tor connection is created; traffic stays direct.', {
      exact: true }).isVisible(), 'Popup always explains simulation and direct traffic');
  await shot('01-arrival-1440-dark');
  await click('Close privacy setup'); await heading('Continue without Tor?');
  check(await popup.getByText(
    /Closing this window means there is no additional privacy routing through Tor/).isVisible(),
      'Close displays requested no-additional-routing warning');
  check(await status.innerText().then((t) => !t.includes('Tor Protected')),
    'Dismissal warning never enables protection');
  await shot('02-dismiss-warning-1440-dark');
  await click('Keep setting up'); await offered();
  await page.keyboard.press('Escape'); await heading('Continue without Tor?');
  await page.keyboard.press('Escape'); check(await popup.isVisible(),
    'Escape cannot bypass dismissal confirmation');
  await click('Keep setting up'); await offered();
  await page.mouse.click(4, 90); await heading('Continue without Tor?');
  check(await popup.isVisible(), 'Backdrop dismissal also requires warning confirmation');
  await click('Continue without Tor'); await popup.waitFor({ state: 'hidden' });
  check(await status.innerText().then((t) => t.includes('Tor routing off')) &&
    (await status.getAttribute('aria-label')).includes('traffic stays direct'),
      'Confirmed dismissal leaves a visible unprotected state');
  await page.waitForFunction(() => document.activeElement?.id === 'privacy-demo-status');
  check(await status.evaluate((n) => n === document.activeElement),
    'Dismissing popup restores focus to global control');
  await page.reload(); await status.waitFor();
  check(!(await popup.isVisible()), 'Saved Standard choice prevents repeat prompting on reload');
  const before = await page.evaluate((key) => ({ wallet: JSON.stringify(
    window.privacyMenuFixture.state.wallet),
    otherStorage: JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([
      k]) => k !== key))) }), KEY);
  await status.click(); await offered();
  const connectionStarted = Date.now();
  await click('Turn on private connection'); await heading('Establishing private connection');
  check(await status.innerText().then((t) => t.includes('Connecting') && !t.includes(
    'Tor Protected')), 'Badge waits for simulated completion');
  await shot('03-connecting-1440-light'); await heading('Your private route is ready.');
  check(Date.now() - connectionStarted >= 11500,
    'Automatic setup takes about twelve seconds rather than rushing through steps');
  check(await status.innerText().then((t) => t.includes('Tor Protected · Preview')) &&
    (await status.getAttribute('title')).includes('traffic stays direct'), (
    "Compact badge keeps Preview visible and direct-traffic "
    + "disclosure in its tooltip"
  ));
  await shot('04-success-1440-light'); await click('Continue to Zigs'); await popup.waitFor({
    state: 'hidden' });
  const after = await page.evaluate((key) => ({ wallet: JSON.stringify(
    window.privacyMenuFixture.state.wallet),
    otherStorage: JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([
      k]) => k !== key))) }), KEY);
  check(JSON.stringify(before) === JSON.stringify(after), (
    "Setup changes only its isolated demo choice, leaving "
    + "wallet state and other storage intact"
  ));
  check(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).choice, KEY) ===
    'enabled', 'Only completed mock setup persists enabled choice');
  await forEachCase(['wallet', 'settings', 'app-settings', 'welcome'], async (value) => {
    await scene(value);
    check(await status.isVisible() && await status.innerText().then((t) => t.includes(
      'Tor Protected · Preview')), 'Global protected-demo status persists on ' + value);
    check(await status.evaluate((n) => {
      const header = n.closest('header');
      return !!header && Math.abs(n.getBoundingClientRect().right -
        header.getBoundingClientRect().right) < 2;
    }), 'Status is aligned right inside the normal header on ' + value);
    if (value === 'wallet') await shot('07-wallet-status-1440-light');
  });
  await scene('settings'); await page.locator(
    '[data-key="network-privacy-settings"]').click(); await heading('Privacy & Network');
  check(await popup.getByText(
    /Actual wallet requests still use the existing direct connection/).isVisible(),
      'Settings reopens the same honest popup controls');
  await click('Close privacy setup'); await popup.waitFor({ state: 'hidden' });
  await status.click(); await click('Use Standard connection'); await heading(
    'Continue without Tor?');
  await click('Keep setting up'); await heading('Privacy & Network');
  check(await status.innerText().then((t) => t.includes('Tor Protected · Preview')),
    'Cancelling disable retains completed demo state');
  await click('Use Standard connection'); await click(
    'Continue without Tor'); await popup.waitFor({ state: 'hidden' });
  check(await status.innerText().then((t) => t.includes('Tor routing off')),
    'Confirmed disable returns global status to Off');
  await status.click(); await click('Turn on private connection'); await click(
    'Close privacy setup'); await heading('Continue without Tor?');
  await click('Keep setting up'); await heading('Establishing private connection');
  check(await popup.getByRole('button', { name: 'Simulate failure' }).count() === 0,
    'Failure-simulation control is removed');
  await click('Continue'); await heading('Blend into the network.');
  check(await popup.locator('.pp-camouflage svg').count() === 1,
    'Camouflage scene precedes the ready message');
  check(await status.innerText().then((t) => !t.includes('Tor Protected')),
    'Header does not complete before the camouflage sequence');
  check(await popup.locator('.pp-zebra-walk').evaluate((n) => getComputedStyle(
    n).animationName === 'none'), 'Reduced motion replaces walking with a still transition');
  await heading('Your private route is ready.');
  await click('Close privacy setup'); await popup.waitFor({ state: 'hidden' });
  check(await status.innerText().then((t) => t.includes('Tor Protected · Preview')),
    'Closing after successful completion keeps the demo status');
  await page.reload(); await status.waitFor();
  check(!(await popup.isVisible()) && await status.innerText().then((t) => t.includes(
    'Tor Protected · Preview')), 'Completed demo choice survives reload without prompting again');
  // Existing wallet dialogs keep priority over this independent global entry.
  await page.evaluate(() => { const dialog = document.createElement('div'); dialog.className =
    'dialog'; dialog.id = 'existing-wallet-dialog'; document.querySelector('#app').append(
      dialog); });
  await page.waitForFunction(() => document.querySelector('#privacy-demo-status').disabled);
  check(await status.isDisabled(),
    'Global entry is disabled while an existing wallet dialog is open');
  await page.evaluate(() => document.querySelector('#existing-wallet-dialog').remove());
  await page.waitForFunction(() => !document.querySelector('#privacy-demo-status').disabled);
  await forEachCase(['dark', 'light'], async (theme) => {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    await forEachCase([1440, 390, 320], async (width) => {
      await page.setViewportSize({ width, height: 900 }); await reset();
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
      check(await popup.evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
        `Popup reflows ${width}px ${theme}`);
      check((await contrast()).length === 0, `Offer text contrast ${width}px ${theme}`);
      check(await status.evaluate((n) => n.getBoundingClientRect().right <= innerWidth + 1),
        `Global status fits ${width}px ${theme}`);
      for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); check(
        await popup.evaluate((n) => n.contains(document.activeElement)),
          'Keyboard focus stays in compact popup'); }
      await shot(`05-offer-${width}-${theme}`);
      await click('Close privacy setup'); await heading('Continue without Tor?'); await shot(
        `06-warning-${width}-${theme}`);
      check((await contrast()).length === 0, `Warning text contrast ${width}px ${theme}`);
      await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
      check(await popup.evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
        `Popup reflows at 200% CSS zoom ${width}px ${theme}`);
      await page.evaluate(() => { document.documentElement.style.zoom = ''; });
      await click('Continue without Tor'); await popup.waitFor({ state: 'hidden' });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `Landing has no horizontal overflow ${width}px ${theme}`);
      await forEachCase(['wallet', 'settings', 'app-settings', 'welcome'], async (value) => {
        await scene(value);
        check(await status.isVisible() && await status.evaluate((n) => !!n.closest('header')),
          `Status stays in the existing ${value} header ${width}px ${theme}`);
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth +
          1), `${value} header reflows ${width}px ${theme}`);
      });
      if (width === 390) await shot(`08-header-390-${theme}`);
    });
  });
  await page.setViewportSize({ width: 720, height: 500 }); await reset();
  check(await popup.evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
    'Half-width desktop viewport reflows for browser zoom');
  check(await popup.evaluate((n) => getComputedStyle(n.querySelector(
    'button')).animationName === 'none'), 'Reduced motion does not animate popup controls');
  check(await page.locator('.pp-sr').getAttribute('aria-live') === 'polite',
    'Connection milestones use a polite live region');
  await page.evaluate((key) => localStorage.setItem(key, '{broken'),
    KEY); await page.reload(); await offered();
  check(await popup.getByText(/could not read your saved connection choice/).isVisible(),
    'Corrupt preference is explained and prompts again');
  // Exercise the full moving scene separately from the reduced-motion checks above.
  const motionContext = await browser.newContext({ viewport: { width: 390, height: 900 },
    reducedMotion: 'no-preference', serviceWorkers: 'block' });
  await motionContext.route('**/*', (route) => new URL(route.request().url()).origin ===
    origin ? route.continue() : route.abort());
  const motionPage = await motionContext.newPage();
  motionPage.on('pageerror', (e) => errors.push(e.message));
  const movingPopup = motionPage.locator('#privacy-demo-popup');
  const moveClick = (name) => movingPopup.getByRole('button', { name, exact: true }).click();
  async function startScene() {
    await moveClick('Turn on private connection'); await moveClick('Continue');
    await movingPopup.getByRole('heading', { name: 'Blend into the network.',
      exact: true }).waitFor();
  }
  await motionPage.goto(origin); await startScene();
  check(await movingPopup.locator('.pp-zebra-walk').evaluate((n) => getComputedStyle(
    n).animationName === 'pp-zebra-vanish'), 'Normal motion walks and camouflages the zebra');
  // Capture animation frames without Playwright finishing the CSS animation for a screenshot.
  if (engine === 'chromium') await motionPage.screenshot({ path: resolve(out,
    '09-zebra-walking-390.png') });
  await movingPopup.locator('.pp-zebra-walk').evaluate((node) => new Promise((resolve) => {
    const tick = () => Number(getComputedStyle(node).opacity) < .15 ? resolve() :
      requestAnimationFrame(tick); tick();
  }));
  check(await movingPopup.getByRole('heading', { name: 'Your private route is ready.',
    exact: true }).count() === 0, 'Zebra becomes invisible before the ready message appears');
  if (engine === 'chromium') await motionPage.screenshot({ path: resolve(out,
    '10-zebra-camouflaged-390.png') });
  await movingPopup.getByRole('heading', { name: 'Your private route is ready.',
    exact: true }).waitFor();
  await moveClick('Continue to Zigs'); await motionPage.locator('#privacy-demo-status').click();
  await moveClick('Replay private setup'); await moveClick('Continue');
  await moveClick('Close privacy setup'); await moveClick('Continue without Tor');
  await motionPage.waitForTimeout(5800);
  check(!(await movingPopup.isVisible()) && (await motionPage.locator(
    '#privacy-demo-status').innerText()).includes('Tor routing off'),
      'Closing mid-animation cancels its pending completion');
  await motionPage.locator(
    '#privacy-demo-status').click(); await startScene(); await moveClick('Skip animation');
  await movingPopup.getByRole('heading', { name: 'Your private route is ready.',
    exact: true }).waitFor();
  check(await movingPopup.getByText(
    'Preview only. No Tor connection is created; traffic stays direct.', {
      exact: true }).isVisible(),
        'Skipping animation preserves the truthful connection disclosure');
  await motionContext.close();
  // Exercise the actual HTML bootstrap as well as the inert real-renderer fixture. Stub only
  // the wallet entry modules so this smoke test cannot initialize a real wallet or engine.
  const bootContext = await browser.newContext();
  await bootContext.route('**/*', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (['/theme.js', '/app.js', '/homepage-motion.js'].includes(path))
      return route.fulfill({ contentType: 'text/javascript',
        body: 'globalThis.__popupBootCount = (globalThis.__popupBootCount || 0) + 1;' });
    return route.continue();
  });
  const bootPage = await bootContext.newPage(); await bootPage.goto(origin + '/?demo=privacy');
  await bootPage.waitForFunction(() => globalThis.__popupBootCount === 3);
  check(await bootPage.locator('.shell').count() === 1 && await bootPage.locator(
    '.nd-root').count() === 0,
      'Actual entry preserves the app shell instead of mounting a replacement demo');
  check(await bootPage.locator('#privacy-demo-popup').isVisible(),
    'Actual HTML entry automatically installs the compact popup');
  await bootContext.close();
  check(errors.length === 0,
    'No wallet service requests, workers, sockets, or browser errors: ' + JSON.stringify(errors));
  writeFileSync(resolve(out, `qa-${engine}.json`), JSON.stringify({ browser: engine,
    checks: checks.length, errors,
    requests: [...new Set(requests)].sort(), results: checks,
    scope: (
      "Compact privacy popup over actual app renderers with "
      + "synthetic wallet state and an inert reactor. No Tor "
      + "routing or wallet services."
    ) }, null, 2) + '\n');
  console.log(`${checks.length} compact privacy-popup checks passed in ${engine}.`);
} finally { await browser?.close(); await new Promise((done) => server.close(done)); }
