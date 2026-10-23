import { WalletAvatar, metrics } from './avatar.js';
import { describeWalletIdentity, createRevealSession } from './wallet-identity.js';
import { FLOW_FIXTURES } from './flow-fixtures.js';
import { qrSvg } from '../../qr.js';
const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined));
  return node;
}
const session = createRevealSession();
const descriptors = new Map();
const state = { walletId: 'everyday', name: FLOW_FIXTURES.everyday.name, view: 'setup',
  device: 'This browser', solana: true, verified: true, svgOnly: false, asset: 'zec' };
let descriptor = null, components = [], revision = 0, switcherOpen = false;
const publicWallet = () => ({ ...FLOW_FIXTURES[state.walletId], name: state.name,
  zcash: { ...FLOW_FIXTURES[state.walletId].zcash, verified: state.verified },
  solana: { enabled: state.solana }, device: state.device });
const short = (value) => `${value.slice(0, 12)}…${value.slice(-10)}`;
function avatar(p, size, label = '') {
  if (!p) return el('span', { class: `orb-placeholder orb-placeholder-${size}`, role: 'img',
    'aria-label': 'Wallet identity awaiting a verified address' });
  const image = WalletAvatar({ ...p, size, eager: true, svgOnly: state.svgOnly, label });
  image.dataset.identity = p.digest; components.push(image); return image;
}
function traits(p, { rarity = true } = {}) {
  if (!p) return el('div', { class: 'identity-traits' }, state.verified ? 'Visual identity loading…' : 'Your identity appears after address verification.');
  return el('div', { class: 'identity-traits' },
    el('span', {}, `${p.traits.sculpture} · ${p.traits.metal}`),
    rarity && p.traits.rare ? el('span', { class: 'rare-detail', 'data-rarity': 'rare' }, 'Ember inlay · Rare finish') : null);
}
function howMade(p) {
  return el('details', { class: 'how-made' }, el('summary', {}, 'How it’s made'),
    el('p', {}, 'Zigs applies SHA-256 to your public Zcash address and network. The result determines the sculpture, metal, patterns, and reflections, entirely in this browser.'),
    el('p', {}, 'The same address and network produce the same design on every device. Your wallet name and adding Solana don’t change it.'),
    el('p', {}, 'Ember inlay appears in approximately 5% of generated identities—about one in twenty. Two fine orange metallic seams mark this rare finish.'),
    p ? el('div', { class: 'identity-source' }, el('span', {}, 'Derived from Zcash Testnet'),
      el('code', {}, short(p.address))) : null);
}
function navigate(view) {
  state.view = view; switcherOpen = false; draw();
  $('flow-page').querySelector('h2')?.focus({ preventScroll: true });
}
function walletHeader() {
  return el('header', { class: 'wallet-heading', 'data-surface': 'heading' }, avatar(descriptor, 48),
    el('div', {}, el('span', { class: 'section-label' }, 'THIS WALLET'),
      el('h2', { tabindex: '-1' }, state.name)), el('span', { class: 'network-chip' }, 'Testnet'));
}
function updateSwitcher() {
  const toggle = el('button', { class: 'switcher-toggle', type: 'button', id: 'switcher-toggle',
    'aria-expanded': switcherOpen, 'aria-controls': 'switcher-options',
    onclick: (event) => { event.stopPropagation(); switcherOpen = !switcherOpen; draw(); $('switcher-toggle').focus({ preventScroll: true }); } },
    avatar(descriptor, 32), el('span', { class: 'switcher-current-name' }, state.name), el('span', { 'aria-hidden': 'true' }, '⌄'));
  const options = el('div', { id: 'switcher-options', class: 'switcher-options' });
  options.hidden = !switcherOpen;
  for (const id of [state.walletId === 'travel' ? 'everyday' : state.walletId, 'travel']) {
    const p = state.verified ? descriptors.get(id) : null;
    options.append(el('button', { type: 'button', 'data-wallet-id': id,
      'aria-pressed': id === state.walletId, onclick: () => { selectWallet(id); } },
      avatar(p, 32), el('span', {}, id === state.walletId ? state.name : FLOW_FIXTURES[id].name),
      id === state.walletId ? el('span', { 'aria-hidden': 'true' }, '✓') : null));
  }
  $('wallet-switcher').replaceChildren(toggle, options);
}
function readyView() {
  const image = avatar(descriptor, 96, 'Your address-derived wallet orb');
  const sculpture = el('div', { class: 'reveal-sculpture', 'data-reveal': descriptor ? 'pending' : 'waiting' }, image);
  const p = descriptor;
  if (p) image.ready.then(async () => {
    try { await image.decode(); } catch { /* The component retains its deterministic fallback. */ }
    if (!sculpture.isConnected) return;
    const first = session.claim(p.digest);
    sculpture.dataset.reveal = first ? 'first' : 'settled';
    if (first && !matchMedia('(prefers-reduced-motion: reduce)').matches) sculpture.classList.add('identity-reveal');
  });
  return el('div', { class: 'setup-stage', 'data-surface': 'setup' },
    el('div', { class: 'setup-context' }, el('span', {}, 'Zigs · guided wallet setup'),
      el('span', {}, `Zcash Testnet${state.solana ? ' · Solana Devnet' : ''} · Any 2 of 3 devices`)),
    el('ol', { class: 'setup-progress', 'aria-label': 'Setup progress' },
      ...['Plan', 'Connect', 'Verify', 'Prepare'].map((label) => el('li', {}, el('span', { 'aria-hidden': 'true' }, '✓'), label))),
    el('section', { class: 'reveal-card' },
      el('p', { class: 'prepared-state' }, el('span', { 'aria-hidden': 'true' }, '✓'), 'Your wallet is prepared'),
      sculpture, el('h2', { tabindex: '-1' }, 'Meet your wallet.'), el('p', { class: 'reveal-name' }, state.name),
      el('p', { class: 'reveal-copy' }, 'Its public address and network shape this orb. The same address always produces the same design—on every device.'),
      traits(p), el('p', { class: 'rare-find' }, p?.traits.rare ? 'A rare find.' : ''), howMade(p),
      el('button', { type: 'button', class: 'primary-button', id: 'open-overview', onclick: () => navigate('overview') }, 'Open Overview', el('span', { 'aria-hidden': 'true' }, '↗')),
      el('p', { class: 'approval-rule' }, 'Payments still need any 2 of your 3 independent devices.')),
    el('details', { class: 'optional-recovery' }, el('summary', {}, 'Recovery files', el('span', {}, 'Optional')),
      el('p', {}, 'Saving a separate encrypted copy of each device’s share is optional. Recovery still needs two usable independent shares and their passphrases.')));
}
function preparingView() {
  return el('section', { class: 'preparing-card', 'data-surface': 'preparing' },
    avatar(null, 96), el('p', { class: 'eyebrow' }, 'PREPARING YOUR WALLET'),
    el('h2', { tabindex: '-1' }, 'Your identity is taking shape.'),
    el('p', {}, 'The orb appears after the wallet’s address checks are complete.'),
    el('p', { class: 'preview-hint' }, 'Use “Zcash address verified” in the preview controls to simulate completion.'));
}
function overviewView() {
  return el('div', { class: 'overview-stage' }, walletHeader(),
    el('div', { class: 'overview-layout' },
      el('section', { class: 'overview-portfolio' }, el('p', { class: 'section-label' }, 'WALLET OVERVIEW'),
        el('h3', {}, 'Everything, together.'),
        el('p', { class: 'portfolio-description' }, 'Your shared wallet. Recognizable on every device.'),
        el('div', { class: 'asset-row' }, el('span', { class: 'asset-icon' }, 'Z'),
          el('div', {}, el('strong', {}, 'Zcash'), el('span', {}, 'Shielded · Testnet')), el('span', { class: 'asset-status' }, 'Prepared')),
        state.solana ? el('div', { class: 'asset-row' }, el('span', { class: 'asset-icon sol-icon' }, '≋'),
          el('div', {}, el('strong', {}, 'Solana'), el('span', {}, 'Devnet')), el('span', { class: 'asset-status' }, 'Prepared')) : null,
        el('button', { type: 'button', class: 'secondary-button', id: 'overview-receive', onclick: () => navigate('receive') }, 'Receive', el('span', { 'aria-hidden': 'true' }, '↙'))),
      el('section', { class: 'overview-identity', 'data-surface': 'identity-card' }, avatar(descriptor, 64),
        el('p', { class: 'section-label' }, 'YOUR WALLET IDENTITY'), el('h3', {}, state.name), traits(descriptor), howMade(descriptor))),
    el('section', { class: 'devices-card' }, el('div', {}, el('h3', {}, 'Independent devices'), el('p', {}, 'Any 2 of 3 devices approve a payment.')),
      el('div', { class: 'device-marks', 'aria-label': 'Signer devices retain their initials' },
        ...['TB', 'SD', 'RD'].map((initials) => el('span', { class: 'device-initials' }, initials)))));
}
function receiveView() {
  const sol = state.asset === 'sol' && state.solana;
  const asset = sol ? 'Solana' : 'Zcash', network = sol ? 'Devnet' : 'Testnet';
  const qr = el('div', { class: 'sample-qr', role: 'img', 'aria-label': 'Non-payment design sample QR' });
  // Reuse the existing pure QR encoder. Encode a design-preview marker, never a payment URI.
  qr.innerHTML = qrSvg(`zigs-design-preview:receive/${sol ? 'solana-devnet' : 'zcash-testnet'}`);
  return el('div', { class: 'receive-stage' }, walletHeader(),
    el('section', { class: 'receive-card', 'data-surface': 'receive' }, avatar(descriptor, 96),
      el('h3', {}, `Receive ${asset}`), el('p', { class: 'receive-wallet-name' }, state.name),
      el('div', { class: 'receive-network', 'data-receive-network': sol ? 'solana:devnet' : 'zcash:testnet' },
        el('span', {}, asset), el('span', {}, network)),
      el('div', { class: 'receive-assets', role: 'group', 'aria-label': 'Receiving asset' },
        el('button', { type: 'button', 'aria-pressed': !sol, id: 'receive-zec', onclick: () => { state.asset = 'zec'; draw(); } }, 'Zcash'),
        state.solana ? el('button', { type: 'button', 'aria-pressed': sol, id: 'receive-sol', onclick: () => { state.asset = 'sol'; draw(); } }, 'Solana') : null),
      qr, el('p', { class: 'sample-label' }, 'Design sample · not a payment QR'),
      el('p', { class: 'destination-label' }, sol ? 'Shielded protocol destination' : 'Shielded Zcash address'),
      el('code', { class: 'sample-destination' }, sol ? 'A verified shielded protocol destination appears here.' : short(FLOW_FIXTURES[state.walletId].zcash.address)),
      el('p', { class: 'receive-explanation' }, 'The orb identifies your wallet. The receiving asset and network identify the destination.')));
}
function draw() {
  components.forEach((component) => component.dispose()); components = [];
  updateSwitcher();
  $('device-label').textContent = state.device;
  for (const view of ['setup', 'overview', 'receive']) {
    const tab = $(`view-${view}`);
    if (view === state.view) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
    // This demo mirrors verified readiness only. The image and animation never gate navigation.
    tab.disabled = view !== 'setup' && !state.verified;
  }
  const page = !state.verified ? preparingView() : state.view === 'setup' ? readyView()
    : state.view === 'overview' ? overviewView() : receiveView();
  $('flow-page').replaceChildren(page); $('flow-page').setAttribute('aria-busy', 'false');
  $('flow-page').dataset.identity = descriptor?.digest ?? '';
  for (const id of ['everyday', 'ember']) $(`example-${id}`).setAttribute('aria-pressed', String(state.walletId === id));
}
async function updateIdentity() {
  const current = ++revision; descriptor = null; $('flow-error').textContent = ''; draw();
  try {
    const next = await describeWalletIdentity(publicWallet());
    if (current !== revision) return;
    descriptor = next; draw();
  } catch { if (current === revision) $('flow-error').textContent = 'The visual identity is unavailable. You can still open Overview.'; }
}
function selectWallet(id) {
  state.walletId = id; state.name = FLOW_FIXTURES[id].name; switcherOpen = false;
  $('flow-name').value = state.name; updateIdentity();
}
for (const id of ['everyday', 'ember']) $(`example-${id}`).addEventListener('click', () => selectWallet(id));
for (const view of ['setup', 'overview', 'receive']) $(`view-${view}`).addEventListener('click', () => navigate(view));
$('flow-svg').addEventListener('click', () => {
  state.svgOnly = !state.svgOnly; $('flow-svg').setAttribute('aria-pressed', String(state.svgOnly)); draw();
});
$('flow-name').addEventListener('change', () => { state.name = $('flow-name').value.trim() || FLOW_FIXTURES[state.walletId].name; draw(); });
$('flow-device').addEventListener('change', () => { state.device = $('flow-device').value; draw(); });
$('flow-solana').addEventListener('change', () => { state.solana = $('flow-solana').checked; if (!state.solana) state.asset = 'zec'; draw(); });
$('flow-verified').addEventListener('change', () => { state.verified = $('flow-verified').checked; if (!state.verified) state.view = 'setup'; updateIdentity(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && switcherOpen) { switcherOpen = false; draw(); $('switcher-toggle').focus({ preventScroll: true }); }
});
document.addEventListener('click', (event) => {
  if (switcherOpen && !$('wallet-switcher').contains(event.target)) { switcherOpen = false; draw(); }
});
window.orbFlow = { state, metrics, fixtures: FLOW_FIXTURES, session,
  get descriptor() { return descriptor; } };
// Render usable navigation before hashes or image work can complete.
draw();
updateIdentity();
// Preload public descriptors independently; no secondary fixture can delay the current wallet.
Promise.all(Object.entries(FLOW_FIXTURES).map(async ([id, wallet]) => {
  descriptors.set(id, await describeWalletIdentity(wallet));
})).then(() => { if (switcherOpen) draw(); }).catch(() => {});
