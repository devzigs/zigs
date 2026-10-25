import assert from 'node:assert/strict';
import { MockSwapProvider, SwapPreviewModel, SWAP_DEMO_ASSETS, SWAP_DEMO_STEPS,
  swapAtomic, swapDecimal } from '../swap-preview-model.js';
import { readFileSync } from 'node:fs';
import { NearIntentsSwapProvider } from '../near-intents-swap-provider.js';
import { loadRig, storage } from './sol-rig.mjs';

const [zec, sol, usdcSol] = SWAP_DEMO_ASSETS;
assert.deepEqual(SWAP_DEMO_ASSETS.map((a) => a.symbol), ['ZEC', 'SOL', 'USDC']);
assert.deepEqual(SWAP_DEMO_ASSETS.map((a) => a.icon), ['/assets/zcash.svg', '/assets/solana.svg', '/assets/usdc.svg']);
assert.equal(usdcSol.network, 'Solana');
assert.equal(swapAtomic('1.000000001', zec), null);
assert.equal(swapAtomic('1e3', zec), null);
assert.equal(swapAtomic('-1', zec), null);
assert.equal(swapAtomic(' 1 ', zec), null);
assert.equal(swapAtomic('0.00000001', zec), 1n);
assert.equal(swapDecimal(swapAtomic('123.123456789', sol), sol), '123.123456789');
const phases = [], model = new SwapPreviewModel(undefined, (s) => phases.push(s.phase));
assert.equal(model.value.phase, 'IDLE');
assert.equal(model.review(), false);
await model.update({ amount: '1.25' });
assert.equal(model.value.phase, 'MOCK_QUOTE_READY');
assert(phases.includes('INPUT_VALID') && phases.includes('MOCK_QUOTING'));
assert.equal(swapDecimal(model.value.quote.outputAtomic, sol), '0.625');
assert.equal(swapDecimal(model.value.quote.minimumOutputAtomic, sol), '0.621875');
assert.equal('originDepositAddress' in model.value.quote, false);
assert.equal(model.review(), true);
model.cancelReview(); assert.equal(model.value.phase, 'REVIEW_CANCELLED');
model.resume(); model.review(); model.simulate();
assert.equal(model.value.step, 0); // No timer advances signing or network stages.
model.exitSimulation(); assert.equal(model.value.phase, 'MOCK_QUOTE_READY');
model.review(); model.simulate();
for (const _ of SWAP_DEMO_STEPS) model.advance();
assert.equal(model.value.phase, 'DEMO_COMPLETE');
await model.reverse(); assert.equal(model.value.from, sol.id); assert.equal(model.value.to, zec.id);
model.review(); await model.update({ amount: '2' });
assert.equal(model.value.phase, 'MOCK_QUOTE_READY');
await model.update({ to: sol.id }); assert.equal(model.value.quote, null);
assert.match(model.value.error, /different/);
await model.update({ to: zec.id, amount: '0' }); assert.match(model.value.error, /greater than zero/);
await model.update({ amount: '2', destination: '' }); assert.match(model.value.error, /destination/);
await model.update({ destination: 'example' }); model.stale();
assert.equal(model.value.phase, 'MOCK_QUOTE_STALE'); assert.equal(model.review(), false);
for (const [fixture, expected] of [[{ fail: true }, /unavailable/], [{ unsupported: true }, /no illustrative route/],
  [{ balanceAtomic: '1' }, /Insufficient illustrative balance/], [{ staleBalance: true }, /out of date/]]) {
  const fixtureModel = new SwapPreviewModel(new MockSwapProvider(fixture));
  await fixtureModel.update({ amount: '1' });
  assert.equal(fixtureModel.value.quote, null); assert.match(fixtureModel.value.error, expected);
}
const tiny = new SwapPreviewModel();
await tiny.update({ from: sol.id, to: zec.id, amount: '0.000000001' });
assert.match(tiny.value.error, /too small/);
// A slower old quote may never overwrite a changed input or reopen review.
const waits = [], provider = new MockSwapProvider();
const delayed = new SwapPreviewModel({ previewQuote: (input) => new Promise((resolve) =>
  waits.push(async () => resolve(await provider.previewQuote(input)))) });
const first = delayed.update({ amount: '1' });
const second = delayed.update({ amount: '2' });
await waits[1](); await second; await waits[0](); await first;
assert.equal(delayed.value.quote.inputAtomic, '200000000');
for (const method of ['supportedAssets', 'previewQuote', 'prepareExecution', 'track'])
  await assert.rejects(new NearIntentsSwapProvider()[method](), /NotImplemented/);

// ── The demos say what they are: the Tor demo, the funding checkout and the swap pages ──
// A small fake page: enough of the DOM to draw the real modules and to press their buttons.
await loadRig();
const realDocument = globalThis.document;
const text = (n) => (n === null || n === undefined ? '' : n.text ?? n.kids.map(text).join(''));
const walk = (n, ok) => (n.kids
  ? [...(ok(n) ? [n] : []), ...n.kids.flatMap((k) => walk(k, ok))] : []);
const matcher = (sel) => {
  const shape = /^([a-z0-9]*)(?:#([\w-]+))?(?:\.([\w-]+))?$/;
  const [, tag = '', hash = '', cls = ''] = shape.exec(sel) ?? [];
  if (!tag && !hash && !cls) return () => false;
  return (n) => (!tag || n.tag === tag) && (!hash || n.id === hash)
    && (!cls || n.className.split(' ').includes(cls));
};
class FakeNode extends globalThis.Node {
  constructor(tag) {
    super();
    Object.assign(this, { tag, attrs: {}, kids: [], on: {}, className: '', id: '', value: '',
      style: { setProperty() {}, cssText: '' }, dataset: {}, hidden: false, disabled: false,
      open: false });
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'id') this.id = String(v);
    if (k === 'class') this.className = String(v);
  }
  getAttribute(k) { return k === 'class' ? this.className : this.attrs[k] ?? null; }
  addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
  append(...nodes) { this.kids.push(...nodes); }
  replaceChildren(...nodes) { this.kids = nodes; }
  remove() {}
  focus() {}
  contains(n) { return n === this || walk(this, (k) => k === n).length > 0; }
  getBoundingClientRect() { return { left: 0, right: 10, top: 0, bottom: 10 }; }
  get lastChild() { return this.kids.at(-1); }
  get children() { return this.kids; }
  get textContent() { return text(this); }
  set textContent(v) { this.kids = [{ text: String(v) }]; }
  showModal() { this.open = true; }
  close() { this.open = false; (this.on.close ?? []).forEach((fn) => fn({})); }
  querySelectorAll(sel) {
    const tests = sel.split(',').map((one) => matcher(one.trim()));
    return walk(this, (n) => n !== this && tests.some((test) => test(n)));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}
const body = new FakeNode('body');
const fakeDocument = { body, activeElement: null, createElement: (tag) => new FakeNode(tag),
  createElementNS: (_, tag) => new FakeNode(tag), createTextNode: (t) => ({ text: String(t) }),
  querySelector: (sel) => body.querySelector(sel), getElementById: () => null };
const fire = (node, type, event = {}) => (node.on[type] ?? [])
  .forEach((fn) => fn({ currentTarget: node, target: node, preventDefault() {},
    stopPropagation() {}, ...event }));
const named = (root, label) => walk(root,
  (n) => n.tag === 'button' && text(n).startsWith(label))[0];
const press = (root, label) => {
  const b = named(root, label);
  assert.ok(b, 'a button "' + label + '" is on the page');
  fire(b, 'click');
};
const delay = () => new Promise((resolve) => setImmediate(resolve));
const realTimers = [globalThis.setTimeout, globalThis.clearTimeout];
Object.assign(globalThis, { document: fakeDocument, HTMLElement: FakeNode,
  MutationObserver: class { observe() {} },
  matchMedia: () => ({ matches: false }) });
try {
  // The Tor demo: a pill and a popup. Nothing here says that traffic is protected.
  globalThis.setTimeout = () => 1;
  globalThis.clearTimeout = () => {};
  const popup = await import('../network-privacy-popup.js');
  const app = new FakeNode('div');
  app.id = 'app';
  const head = new FakeNode('header');
  app.append(head);
  const page = { querySelector: (sel) => (sel === '#app' ? app : null) };
  assert.equal(popup.hasPrivacyPopup(), false,
    'no popup is installed before the entry installs it');
  popup.installPrivacyPopup();
  popup.presentPrivacyStatus(page);
  const pill = walk(head, (n) => n.className === 'pp-status')[0];
  assert.ok(pill, 'the Tor pill is drawn in the page header');
  const dialog = body.querySelector('dialog');
  assert.equal(text(pill), popup.PILL_TEXT, 'the Tor pill says the demo');
  assert.doesNotMatch(text(pill) + pill.getAttribute('aria-label'), /protect|private route/i,
    'the Tor pill never says protected');
  assert.match(pill.getAttribute('aria-label'), /Demo only: your connection is unchanged/,
    'the Tor pill says that the connection is unchanged');
  assert.equal(dialog.open, false, 'the Tor demo does not open by itself');
  const screens = [];
  const look = () => { screens.push(text(dialog)); return text(dialog); };
  const open = () => fire(pill, 'click');
  open();
  assert.equal(dialog.open, true, 'the pill opens the Tor demo');
  assert.match(look(), /Try the Tor demo/, 'the popup opens on the demo offer');
  press(dialog, 'Start the demo'); look();
  press(dialog, 'Continue'); look();
  press(dialog, 'Skip animation');
  assert.match(look(), /Demo finished/, 'the demo ends with a finished demo');
  for (const screen of screens) {
    assert.doesNotMatch(screen, /protected|route is ready|private route is|Standard connection/i,
      'no popup screen says protected or ready: ' + screen.slice(0, 60));
    assert.match(screen, /Demo only: your connection is unchanged/,
      'every popup screen says the connection is unchanged');
  }
  const closers = { 'the X button': () => fire(walk(dialog,
    node => node.attrs?.['aria-label'] === 'Close the Tor demo')[0], 'click'),
    'the Close button': () => press(dialog, 'Close'),
    Escape: () => fire(dialog, 'keydown', { key: 'Escape' }),
    'the backdrop': () => fire(dialog, 'click', { clientX: -5, clientY: -5 }) };
  for (const stage of ['offer', 'connecting', 'camouflage', 'success']) {
    for (const [name, close] of Object.entries(closers)) {
      if (name === 'the Close button' && stage !== 'offer') continue;
      open();
      if (stage !== 'offer') press(dialog, 'Start the demo');
      if (stage === 'camouflage' || stage === 'success') press(dialog, 'Continue');
      if (stage === 'success') press(dialog, 'Skip animation');
      close();
      assert.equal(dialog.open, false, name + ' closes the popup in one step at ' + stage);
    }
  }
  open();
  assert.match(text(dialog), /Try the Tor demo/,
    'the popup opens on the offer again after a close');
  fire(dialog, 'close');
  dialog.open = false;
  assert.equal(popup.hasPrivacyPopup(), true, 'the entry can see that the popup is installed');
  assert.deepEqual([...storage.keys()].filter((key) => /privacy/i.test(key)), [],
    'the Tor demo stores no choice');
} finally {
  [globalThis.setTimeout, globalThis.clearTimeout] = realTimers;
}
try {
  // The funding checkout: a demo with no payment, never a step of the wallet setup.
  const funding = await import('../funding-preview.js');
  const exits = [];
  const preview = funding.createFundingPreview({
    el: (tag, attrs = {}, ...kids) => {
      const n = new FakeNode(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else if (k === 'class') n.className = v;
        else n.setAttribute(k, v === true ? '' : v);
      }
      for (const k of kids.flat()) {
        if (k != null && k !== false) n.append(k instanceof Node ? k : { text: String(k) });
      }
      return n;
    },
    icon: () => null, walletName: 'Savings', onExit: () => exits.push('exit'),
    onComplete: () => exits.push('done') });
  const view = preview.element;
  const stages = [text(view)];
  assert.match(text(view), /Demo, no payment/, 'the funding stage says Demo, no payment');
  assert.match(text(view), /Funding checkout demo/, 'the funding stage is titled as a demo');
  assert.match(text(view), /Zigs asks for no setup payment/,
    'the funding stage says no payment is asked');
  assert.doesNotMatch(text(view), /Fund your wallet|Connect browser wallet|One setup payment/,
    'the funding stage does not read as a payment request');
  assert.equal(view.querySelector('.guided-progress'), null,
    'the funding demo is not drawn as a setup step');
  assert.equal(view.attrs['data-funding-preview'], '', 'the funding demo keeps its marker');
  press(view, 'Try wallet approval'); stages.push(text(view));
  press(view, 'Cancel');
  press(view, 'Show demo QR code'); stages.push(text(view));
  press(view, 'Back');
  press(view, 'Try wallet approval'); press(view, 'Simulate approval'); stages.push(text(view));
  for (const stage of stages) {
    assert.match(stage, /Demo, no payment/, 'every funding stage says Demo, no payment');
  }
  assert.match(funding.fundingDemoQrPayload(), /^ZIGS FUNDING DEMO - NOT A PAYMENT\n/,
    'the funding QR says that it is not a payment');
  assert.match(funding.FUNDING_DEMO_QR_PAYLOAD, /No recipient address\. Do not send funds\./,
    'the funding QR holds no recipient');
  press(view, 'Pause');
  assert.deepEqual(exits, ['exit'],
    'a paused funding demo leaves at once and asks nothing of the wallet');
} finally {
  globalThis.document = realDocument;
}
// The Overview banner of the funding demo, and the Settings entries of the Tor demo, are drawn by
// the page itself, so they run in the fake page too.
globalThis.document = fakeDocument;
try {
  const gid = 'a'.repeat(20);
  const { state } = await import('../app-state.js');
  const fundingPage = await import('../app-funding-preview.js');
  state.gid = gid;
  assert.equal(fundingPage.fundingOverviewCard(gid, 'Savings'), null, 'no banner before the demo');
  fundingPage.openFundingPreview(gid);
  fundingPage.fundingSetupView(gid, 'Savings');
  const banner = text(fundingPage.fundingOverviewCard(gid, 'Savings'));
  assert.match(banner, /Demo, no payment/, 'the Overview banner says Demo, no payment');
  assert.doesNotMatch(banner, /Finish funding|Continue funding/,
    'the Overview banner does not ask for a funding step');
  const settings = await import('../app-network-privacy.js');
  const group = settings.networkPrivacySettings();
  assert.match(text(group), /Tor is not available in this version/,
    'Settings says that Tor is not available');
  assert.match(text(group), /Demo only: your connection is unchanged/,
    'Settings labels the Tor demo');
  assert.equal(settings.hasNetworkPrivacy(), false, 'no panel is open before the button');
  press(group, 'Privacy & Network');
  assert.equal(settings.hasNetworkPrivacy(), true, 'Settings opens the Privacy & Network panel');
  const panel = text(settings.networkPrivacyPanel());
  assert.match(panel, /Integrated Tor is not available in this version/,
    'the panel says that Tor is not available');
  assert.doesNotMatch(panel, /\/\?demo=privacy|design preview/i,
    'the panel has no dead preview link');
  press(settings.networkPrivacyPanel(), 'Open the Tor demo');
  assert.equal(settings.hasNetworkPrivacy(), false, 'the Tor demo button closes the panel');
  assert.equal(body.querySelector('dialog').open, true, 'the Tor demo button opens the demo');
  press(group, 'Open the Tor demo');
  assert.equal(body.querySelector('dialog').open, true, 'Settings opens the Tor demo');
} finally {
  globalThis.document = realDocument;
}
globalThis.document = fakeDocument;
try {
  // The swap pages: demos with no funds and no real quote.
  const { createSwapPreview, DEMO_TAG, ZEC_PRIVACY } = await import('../app-swap-preview.js');
  const swap = createSwapPreview({ name: 'Savings', threshold: 'Any 2 of 3 devices' });
  const root = swap.element;
  assert.match(text(root), new RegExp(DEMO_TAG), 'the swap page carries the demo tag');
  assert.match(DEMO_TAG, /^Demo/, 'the demo tag starts with Demo');
  assert.match(text(root), /No funds move and no real quote is requested/,
    'the swap page says that no funds move and no real quote is requested');
  assert.doesNotMatch(text(root), /Private Swaps?|Powered by/,
    'the swap page does not claim a private swap or a provider');
  assert.match(text(root), /Planned provider: NEAR Intents/, 'the provider is only planned');
  assert.deepEqual(walk(root, (n) => /privacy options/i.test(n.attrs['aria-label'] ?? '')), [],
    'the swap tabs are not named as privacy options');
  assert.match(ZEC_PRIVACY, /1Click handles ZEC only at transparent addresses/,
    'the ZEC line names the 1Click limit');
  assert.ok(text(root).includes(ZEC_PRIVACY), 'a swap with ZEC shows the 1Click limit');
  await swap.model.update({ amount: '1' });
  assert.match(text(root), /Demo quote, not a real price/, 'the quote is a demo quote');
  press(root, 'Review demo swap');
  const modal = walk(body, (n) => n.tag === 'dialog').at(-1);
  assert.match(text(modal), /Demo · no funds/, 'the review dialog carries the demo tag');
  assert.match(text(modal), /no real quote is used/,
    'the review dialog says that no real quote is used');
  press(modal, 'Simulate swap flow');
  for (let i = 0; i < 5; i++) press(modal, 'Next demo step');
  assert.match(text(modal), /Demo complete\. No funds moved and no real quote was used\./,
    'the swap result says demo, no funds and no real quote');
  const flow = root.querySelector('.pq-flow');
  press(root, 'Continue');
  assert.match(text(flow), /DEMO · NO FUNDS MOVE/, 'the post-quantum flow is labelled as a demo');
  await delay();
  for (const label of ['Review demo swap', 'Continue to demo approvals',
    'Simulate this device approval', 'Simulate second device approval',
    'Continue to simulated execution', 'Simulate deposit confirmation',
    'Simulate route execution', 'Simulate delivery']) press(flow, label);
  assert.match(text(flow), /Demo result\. No funds moved and no real quote was used\./,
    'the post-quantum result says demo, no funds and no real quote');
  assert.match(text(root.querySelector('#swap-panel-quantum')),
    /1Click handles ZEC only at transparent addresses/,
    'the post-quantum page names the 1Click limit');
} finally {
  globalThis.document = realDocument;
}
// The page shell: the saved theme applies before the first paint, and the demo entry cannot stop
// the wallet from loading.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const theme = html.indexOf('<script src="/theme.js"></script>');
assert.ok(theme > 0 && theme < html.indexOf('<link rel="stylesheet"'),
  'the theme script is a classic script in the head, before the styles');
assert.equal(html.split('theme.js').length, 2, 'index.html loads the theme script once');
const entry = readFileSync(new URL('../network-privacy-demo-entry.js', import.meta.url), 'utf8');
assert.match(entry, /try \{\s*installPrivacyPopup\(\);\s*\} catch/,
  'a Tor demo that fails to start is caught');
assert.ok(entry.indexOf('catch') < entry.indexOf('import("./app.js")'),
  'the wallet loads after the Tor demo is installed or has failed');
assert.doesNotMatch(entry, /theme\.js/, 'the entry does not load the theme after the first paint');
// The README names the brand marks as identifiers owned by others, and claims no licence for them.
const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
assert.doesNotMatch(readme, /used under their brand terms/,
  'the README claims no licence for the brand marks');
assert.match(readme, /marks identify the assets\. The trademarks belong to their owners/,
  'the README says that the marks identify the assets and belong to their owners');
console.log('swap-preview: amounts, races, demo transitions, demo labels and lock pass');
process.exit(0);
