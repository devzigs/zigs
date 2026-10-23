// Fresh local browser context and synthetic data only. Start swap_preview_server.mjs first.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, 'docs/ux-redesign/visuals/swap-preview');
mkdirSync(resolve(output, 'before'), { recursive: true });
mkdirSync(resolve(output, 'after'), { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
  colorScheme: 'dark', reducedMotion: 'reduce' });
const page = await context.newPage(), checks = [], screenshots = [], faults = [], forbidden = [];
page.on('pageerror', (error) => faults.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') faults.push(message.text()); });
const origin = 'http://127.0.0.1:' + (process.env.ZIGS_SWAP_PORT || 8856);
await context.route('**/*', (route) => {
  const req = route.request(), url = new URL(req.url());
  if (url.origin !== origin || req.method() !== 'GET' || /\/v0\/(quote|status|tokens)/.test(
    url.pathname)) {
    forbidden.push(url.pathname); return route.abort();
  }
  return route.continue();
});
function check(ok, label) { checks.push({ label, pass: !!ok }); assert(ok, label); }
async function open(scenario = '') {
  await page.goto(origin + '/__swap_preview__?scenario=' + scenario);
  await page.waitForFunction(() => window.swapHarnessReady);
  await page.evaluate(() => { document.documentElement.dataset.theme =
    'dark'; return document.fonts.ready; });
}
async function capture(name, phase = 'after') {
  const inDialog = await page.locator('dialog[open]').count() > 0;
  await page.screenshot({ path: resolve(output, phase, name + '.png'), fullPage: !inDialog,
    animations: 'disabled' });
  screenshots.push(phase + '/' + name + '.png');
}
async function layout(label) {
  const f = await page.evaluate(() => ({ width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    dialogs: [...document.querySelectorAll('.swap-modal')].every((n) => n.scrollWidth <=
      n.clientWidth + 1),
    targets: [...document.querySelectorAll(
      '.swap-page button:not(:disabled),.swap-modal button,.swap-settings summary')]
      .filter((n) => n.getClientRects().length && n.checkVisibility()).every((n) => {
        const r = n.getBoundingClientRect(); return r.height >= 47 && r.width >= 47;
      }) }));
  check(f.scroll <= f.width && f.dialogs, label + ': no horizontal overflow');
  check(f.targets, label + ': touch targets at least 48px');
}
const amount = () => page.getByRole('textbox', { name: 'Amount you pay', exact: true });
const reviewButton = () => page.getByRole('button', { name: 'Preview swap', exact: false });
async function quote() {
  await amount().fill('1.25');
  await page.waitForFunction(() => document.querySelector('#panel-swap').dataset.swapPhase ===
    'MOCK_QUOTE_READY');
}
async function closeDialog() { await page.keyboard.press('Escape'); check(await page.locator(
  'dialog').count() === 0, 'Escape closes native dialog'); }

async function composition() {
  await open('before'); await capture('swap-1440', 'before');
  await page.setViewportSize({ width: 390, height: 844 }); await capture('swap-390', 'before');
  for (const [width, height] of [[1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 800]]) {
    await page.setViewportSize({ width, height });
    await open(); check(await reviewButton().isDisabled(), 'Idle preview disabled at ' + width);
    await layout('idle ' + width); await onePage('idle ' + width); await capture('idle-' + width);
    await quote(); await amount().blur(); await layout('quote ' + width); await onePage(
      'quote ' + width); await capture('quote-' + width);
  }
}
async function onePage(label) {
  check(await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight),
    label + ': no page scrolling');
  check(await page.locator('.swap-token').evaluateAll((images) => images.every((img) =>
    img.tagName === 'IMG' && img.complete && img.naturalWidth > 0
      && ['/assets/zcash.svg', '/assets/solana.svg', '/assets/usdc.svg'].includes(
        img.getAttribute('src'))
      && (!img.getClientRects().length || img.getBoundingClientRect().height >= 32))), label +
        ': official SVG marks at least 32px');
  check((await page.locator('#panel-swap').innerText()).includes(
    'Ironwood routing is unverified'), label + ': uses Ironwood terminology');
}
async function interactions() {
  await page.setViewportSize({ width: 1440, height: 1000 }); await open(); await quote();
  const storageBefore = await page.evaluate(() => JSON.stringify(localStorage));
  await page.getByRole('button', { name: 'Reverse swap direction', exact: true }).click();
  check(await page.locator('.swap-network').first().innerText() === 'Solana · preview',
    'Direction reverses token and network together');
  await capture('reversed-1440');
  await page.getByRole('button', { name: 'Choose asset to receive', exact: true }).click();
  check(await page.locator('.swap-asset-choice').count() === 3,
    'Picker contains exactly ZEC, SOL and USDC');
  await page.getByRole('searchbox').fill('USDC');
  check(await page.locator('.swap-asset-choice').count() === 1, 'Only USDC on Solana is offered');
  await layout('asset picker'); await capture('picker-search-1440');
  await page.getByRole('searchbox').fill('not-an-asset');
  check(await page.locator('.swap-picker-empty').isVisible(),
    'Search has a useful no-results state');
  await closeDialog();
  check(await page.getByRole('button', { name: 'Choose asset to receive',
    exact: true }).evaluate((n) => n === document.activeElement),
      'Picker restores focus to opener');
  await page.locator('.swap-settings summary').click();
  await page.getByRole('button', { name: '1%', exact: true }).click();
  check(await page.getByRole('button', { name: '1%', exact: true }).getAttribute(
    'aria-pressed') === 'true', 'Slippage preset updates selected state');
  await capture('slippage-1440'); await page.locator('.swap-settings summary').click();
  await reviewButton().click();
  check(await page.getByRole('dialog').isVisible(), 'Review opens as a native modal');
  check((await page.getByRole('dialog').innerText()).includes(
    'No transaction will be signed or sent.'), 'Review states no execution');
  await layout('review'); await capture('review-1440');
  await page.getByRole('button', { name: 'Simulate swap flow', exact: false }).click();
  await capture('progress-1440');
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Next demo step',
    exact: false }).click();
  check(await page.getByText('Demo complete. No assets were moved.', {
    exact: true }).isVisible(), 'Demo terminal state makes no on-chain claim');
  await capture('complete-1440');
  await page.getByRole('button', { name: 'Back to preview', exact: true }).click();
  check(await page.evaluate(() => JSON.stringify(localStorage)) === storageBefore,
    'Preview interactions do not persist state');
  await invalidationAndKeyboard();
}
async function invalidationAndKeyboard() {
  await reviewButton().focus(); await page.keyboard.press('Enter');
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    check(await page.evaluate(() => !!document.activeElement.closest('.swap-modal')),
      'Modal traps keyboard focus ' + i);
  }
  await closeDialog();
  check(await reviewButton().evaluate((n) => n === document.activeElement),
    'Review restores focus');
  await reviewButton().click();
  await page.evaluate(() => window.swapFixture.model.update({ amount: '2' }));
  check(await page.locator('dialog').count() === 0,
    'Input changes invalidate and close an open review');
  await amount().fill('1.1234567890');
  check(await amount().getAttribute('aria-invalid') === 'true',
    'Excess precision has a separate invalid state');
  await capture('invalid-1440');
  await quote(); await page.evaluate(() => window.swapFixture.model.stale());
  check(await reviewButton().isDisabled(), 'Stale quote cannot open review');
  await page.getByRole('button', { name: 'Retry preview', exact: true }).click();
  check(await reviewButton().isEnabled(), 'Cleared preview can be refreshed');
  await reviewButton().click();
  await page.getByRole('button', { name: 'Simulate swap flow', exact: false }).click();
  await closeDialog();
  check(await reviewButton().isEnabled(), 'Cancelling a simulation allows another review');
  await page.getByRole('button', { name: 'Choose asset to receive', exact: true }).click();
  await page.getByRole('button', { name: 'SOL on Solana, illustrative', exact: true }).click();
  check(await reviewButton().isDisabled(), 'Identical asset and network cannot be previewed');
  await page.getByRole('combobox', { name: 'Preview destination' }).selectOption('');
  check(await reviewButton().isDisabled(), 'Missing destination cannot be previewed');
}
async function fixtureStates() {
  for (const [scenario, copy] of [['error', 'unavailable'], ['unsupported',
    'no illustrative route'],
    ['balance', 'Insufficient illustrative balance'], ['stale-balance', 'out of date']]) {
    await open(scenario); await amount().fill('1.25');
    check((await page.locator('#swap-error').innerText()).includes(copy), scenario +
      ' fixture copy');
    check(await reviewButton().isDisabled(), scenario + ' prevents review'); await capture(
      scenario + '-1440');
  }
  await open('error'); await amount().fill('1.25');
  await page.evaluate(() => { window.swapFixture.model.provider.fixture.fail = false; });
  await page.getByRole('button', { name: 'Retry preview', exact: true }).click();
  check(await reviewButton().isEnabled(), 'Provider error can be retried');
  await open(); await quote();
  await page.evaluate(() => document.documentElement.dataset.theme = 'light');
  await capture('quote-light-1440'); await layout('light theme');
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await page.setViewportSize({ width: 390, height: 844 }); await reviewButton().click();
  await layout('review mobile'); await capture('review-390');
  await page.getByRole('dialog').evaluate((n) => n.scrollTop = n.scrollHeight);
  await capture('review-actions-390');
  await closeDialog();
  await page.getByRole('button', { name: 'Choose asset to pay', exact: true }).click();
  await layout('picker mobile'); await capture('picker-390'); await closeDialog();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await reviewButton().click();
  check(await page.getByRole('dialog').evaluate((n) => getComputedStyle(n).animationName) ===
    'none', 'Reduced motion suppresses dialog animation');
  await closeDialog();
  await page.getByRole('button', { name: 'Swap details', exact: false }).click();
  check((await page.getByRole('dialog').innerText()).includes('Minimum received'),
    'Compact view retains full quote details in dialog');
  check((await page.getByRole('dialog').innerText()).includes(
    'Ironwood routing is unverified'), 'Details use Ironwood terminology');
  await layout('compact details'); await capture('details-390'); await closeDialog();
  await page.emulateMedia({ forcedColors: 'active' }); await capture(
    'forced-colors-390'); await layout('forced colors');
}
try {
  await composition(); await interactions(); await fixtureStates();
  check(forbidden.length === 0,
    'No external requests, quote endpoints, status requests or transfers');
  check(faults.length === 0, 'No console or runtime errors');
} finally {
  const report = { checks, screenshots, forbidden, faults };
  writeFileSync(resolve(root, 'docs/ux-redesign/swap-preview-validation.json'), JSON.stringify(
    report, null, 2) + '\n');
  await browser.close();
  console.log('swap-preview browser: ' + checks.filter((c) => c.pass).length + '/' +
    checks.length + ' checks passed; ' + screenshots.length + ' screenshots');
}
