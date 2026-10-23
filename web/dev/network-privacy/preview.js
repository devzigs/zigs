// Isolated, synthetic design fixture. No wallet imports, service calls or persistent storage.
const $ = (id) => document.getElementById(id);
const state = { screen: 'welcome', mode: null, draft: 'private', status: 'idle', milestone: 0,
  activity: 'idle', deferred: null, returning: false, tab: 'overview' };
const labels = { connecting: 'Connecting', connected: 'Connected', reconnecting: 'Reconnecting',
  interrupted: 'Interrupted', switching: 'Switching', offline: 'Offline', unavailable: 'Unavailable' };
const milestones = ['Initialize embedded Tor', 'Validate saved network state', 'Establish a Tor circuit', 'Check wallet services'];
const activities = { formation: 'wallet formation', signing: 'FROST signing', broadcast: 'transaction broadcast' };
const modeName = (mode) => mode === 'private' ? 'Private' : 'Standard';
const statusText = () => state.mode ? `${modeName(state.mode)} · ${labels[state.status]}` : 'Connection not selected';
const dialog = $('connection-dialog');
let dialogOpener = null;

function node(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === false) continue;
    if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else element.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== false && child !== undefined)
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return element;
}
const text = (content, cls = '') => node('p', { class: cls }, content);
const button = (label, action, cls = 'secondary', attrs = {}) => node('button', { type: 'button', class: cls, onclick: action, ...attrs }, label);
const eyebrow = (content) => node('span', { class: 'eyebrow' }, content);
function icon(kind) {
  const paths = {
    shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/>',
    device: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  };
  const wrap = node('span');
  // Fixed artwork only; no interpolated input or remote SVG references.
  wrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
  return wrap.firstElementChild;
}
function routeArt() {
  return node('div', {}, node('div', { class: 'route-art', 'aria-hidden': 'true' },
    node('div', { class: 'route-node' }, icon('device')), node('div', { class: 'route-wire' }),
    node('div', { class: 'route-node middle' }, icon('shield')), node('div', { class: 'route-wire' }),
    node('div', { class: 'route-node' }, icon('globe'))),
  node('div', { class: 'route-captions', 'aria-hidden': 'true' }, 'Your browser', 'Tor network', 'Wallet services'));
}
function boundaries() {
  return node('details', { class: 'privacy-details' }, node('summary', {}, 'What Private protects — and its limits'),
    text('Network privacy helps conceal your direct IP from supported destination services. Transaction privacy describes what a blockchain reveals. They protect different information.'),
    text('The website host sees your IP when the page loads. A browser gateway also sees your IP and connection metadata. Tor circuits are intended to keep wallet traffic encrypted through that gateway.'),
    text('Tor does not prevent browser fingerprinting, identification through accounts, public blockchain activity, compromised devices, or every form of timing correlation. It does not provide Tor Browser-equivalent protection.'),
    text('This is a design preview. No transport is initialized, no services are checked, and no protection is provided here.'));
}
function intro(kicker, title, description) {
  return node('header', { class: 'intro' }, eyebrow(kicker), node('h1', { tabindex: '-1' }, title), text(description));
}
function steps(active) {
  return node('div', { class: 'step-line', 'aria-label': `Connection setup · Step ${active} of 3` },
    ...[1, 2, 3].map((step) => node('span', { class: step <= active ? 'current' : '', 'aria-hidden': 'true' })),
    `${String(active).padStart(2, '0')} / 03`);
}
function choiceCards(name = 'connection') {
  return node('fieldset', { class: 'choice-set' }, node('legend', {}, 'Choose your connection'),
    ...['private', 'standard'].map((mode) => node('label', { class: 'choice-card' },
      node('input', { type: 'radio', name, value: mode, checked: state.draft === mode,
        onchange: () => { state.draft = mode; } }),
      node('span', {}, node('span', { class: 'choice-title' }, `${modeName(mode)} connection`,
        mode === 'private' ? node('span', { class: 'recommended' }, 'Recommended') : null),
      node('span', { class: 'choice-description' }, mode === 'private'
        ? 'Route wallet traffic through Tor to hide your IP from wallet services.'
        : 'Connect directly for faster wallet synchronization.'),
      node('span', { class: 'choice-detail' }, mode === 'private'
        ? 'Stronger network privacy. May be slower.' : 'Wallet services may see your IP address.')),
      node('span', { class: 'choice-arrow', 'aria-hidden': 'true' }, '↗'))));
}
function welcomeView() {
  return node('section', { class: 'welcome fade-in' }, eyebrow('A LITTLE LESS EXPOSED'),
    node('h1', { tabindex: '-1' }, 'Your wallet.', node('br'), 'Your way to connect.'),
    text('Choose the connection that feels right for you. A little more privacy, or a little more speed.'),
    node('div', { class: 'actions' }, button('Get started', () => { state.screen = 'choice'; render(true); }, 'primary')),
    node('div', { class: 'welcome-art' }, routeArt(), text('An illustration of the proposed private route. Your browser first connects through a gateway.')),
    boundaries());
}
function choiceView() {
  return node('section', { class: 'fade-in' }, steps(1),
    intro(state.returning ? 'CHOOSE AGAIN' : 'BEFORE YOUR WALLET', 'Privacy is your choice.',
      'Choose how Zigs connects to the network. You can change this anytime.'),
    state.returning ? text('This scenario represents a missing or unreadable preference. No saved preference was read.', 'notice') : null,
    choiceCards(), node('div', { class: 'actions' }, button('Continue', () => begin(state.draft), 'primary'),
      button('Back', () => { state.screen = 'welcome'; render(true); }, 'quiet-button')),
    node('div', { class: 'choice-footer' }, icon('lock'),
      node('span', {}, 'In the proposed product, your choice stays on this browser. No wallet-specific requests begin until the chosen transport is ready.')),
    boundaries());
}
function begin(mode) {
  Object.assign(state, { mode, status: mode === 'private' ? 'connecting' : 'connected',
    screen: mode === 'private' ? 'establish' : 'dashboard', milestone: 0, deferred: null, tab: 'overview' });
  render(true);
}
function connectionView() {
  return node('section', { class: 'fade-in' }, steps(2),
    intro('A MORE PRIVATE ROUTE', 'Establishing private connection', 'Preparing the route before wallet activity begins.'),
    routeArt(), node('div', { class: 'connection-card' }, node('h2', {}, 'Connection milestones'),
      text('Illustrative milestones · Advance using the review tools.', 'entry-note'),
      node('ol', { class: 'milestones' }, ...milestones.map((label, i) => node('li', {
        class: i < state.milestone ? 'done' : i === state.milestone ? 'active' : '',
        'aria-current': i === state.milestone ? 'step' : null,
      }, node('span', { class: 'milestone-marker', 'aria-hidden': 'true' }, i < state.milestone ? '✓' : String(i + 1)), label))),
      text('No percentages or timed progress. In the product, each milestone must come from verified transport events.', 'notice')),
    node('div', { class: 'actions' }, button('Connection controls', openPanel)), boundaries());
}
function dashboardView() {
  const ready = state.status === 'connected';
  const nav = node('nav', { class: 'dashboard-nav', 'aria-label': 'Illustrative wallet navigation' },
    ...['overview', 'settings'].map((tab) => button(tab === 'overview' ? 'Overview' : 'Settings', () => {
      state.tab = tab; render(true);
    }, '', { 'aria-current': state.tab === tab ? 'page' : null })));
  const status = state.deferred
    ? `Switch to ${modeName(state.deferred)} is waiting for ${activities[state.activity]} to reach a safe point. Current mode stays ${modeName(state.mode)}.`
    : ready ? 'Illustrative connected state. This preview does not synchronize a wallet.'
      : 'Cached display only. In the proposed product, wallet networking waits for the selected transport to be ready.';
  return node('section', { class: 'fade-in' }, nav,
    intro(state.returning ? 'RETURNING USER SCENARIO' : 'ILLUSTRATIVE WALLET',
      state.tab === 'settings' ? 'Settings' : 'A little more peace of mind.',
      state.tab === 'settings' ? 'Connection preferences for this browser.' : 'Sample wallet · No accounts, funds, or keys.'),
    text(status, 'notice'),
    state.tab === 'settings' ? node('section', { class: 'settings-row' },
      node('div', {}, node('h2', {}, 'Privacy & Network'), text('Choose how your wallet connects. Your approval rules stay the same.')),
      button('Manage connection', openPanel))
      : node('div', { class: 'sample-grid' },
        node('div', { class: 'sample-card' }, eyebrow('NETWORK CONNECTION'), node('h2', {}, modeName(state.mode)),
          text(`${labels[state.status]} · Illustrative`), button('Connection controls', openPanel, 'quiet-button')),
        node('div', { class: 'sample-card' }, eyebrow('WALLET ACTIVITY'), node('strong', {}, '—'),
          text('No balances or transactions loaded.'))),
    node('section', { class: 'privacy-separation' }, node('h2', {}, 'Two different kinds of privacy'),
      text('Network privacy concerns your connection and IP address. Transaction privacy concerns what your blockchain activity reveals. Neither replaces the other.')),
    state.activity !== 'idle' ? text(`Safety scenario: ${activities[state.activity]} in progress. No real operation is running.`, 'notice') : null,
    boundaries());
}
function advance() {
  if (state.deferred) {
    const target = state.deferred;
    state.activity = 'idle'; $('activity').value = 'idle';
    startSwitch(target); return;
  }
  if (state.mode === 'standard') { state.status = 'connected'; state.screen = 'dashboard'; }
  else if (state.milestone < milestones.length - 1) state.milestone++;
  else { state.status = 'connected'; state.screen = 'dashboard'; }
  render(true);
}
function render(focus = false) {
  $('content').replaceChildren(state.screen === 'welcome' ? welcomeView()
    : state.screen === 'choice' ? choiceView() : state.screen === 'establish' ? connectionView() : dashboardView());
  $('connection-label').textContent = statusText();
  $('connection-status').dataset.status = state.status;
  const canAdvance = ['connecting', 'reconnecting', 'switching'].includes(state.status);
  const advanceControl = state.deferred ? button('Show safe point', advance)
    : canAdvance ? button(state.mode === 'standard' ? 'Show Standard connected'
      : state.milestone === 3 ? 'Show services verified' : 'Show next milestone', advance) : null;
  $('scenario-actions').replaceChildren(...(advanceControl ? [advanceControl] : []));
  $('announcement').textContent = `${statusText()}. ${state.deferred ? 'Switch deferred until a safe point.' : ''} Design scenario only.`;
  if (focus) $('content').querySelector('h1')?.focus();
}
function dialogHeading(title) {
  dialog.replaceChildren(node('div', { class: 'dialog-top' },
    node('span', { class: 'eyebrow', id: 'dialog-preview' }, 'Design preview · No Tor connection or wallet activity'),
    button('×', closePanel, 'close-dialog', { 'aria-label': 'Close connection controls' })),
  node('h2', { id: 'dialog-title', tabindex: '-1' }, title));
}
function showDialog(opener) {
  if (!dialog.open) {
    dialogOpener = opener instanceof HTMLElement ? opener : document.activeElement;
    dialog.showModal();
  }
  $('dialog-title').focus();
}
function closePanel() { dialog.close(); }
dialog.addEventListener('close', () => {
  if (dialogOpener?.isConnected) dialogOpener.focus();
  else $('connection-status').focus();
});
dialog.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  const controls = [...dialog.querySelectorAll('button:not(:disabled), a[href], summary, input, select')]
    .filter((element) => element.getClientRects().length);
  const first = controls[0], last = controls.at(-1), active = document.activeElement;
  if (event.shiftKey && (active === first || !controls.includes(active))) {
    event.preventDefault(); last?.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault(); first?.focus();
  }
});
function openPanel(event) {
  dialogHeading('Privacy & Network');
  dialog.append(node('div', { class: 'dialog-status' }, node('span', { class: 'status-dot', 'aria-hidden': 'true' }), statusText()),
    text('Illustrative connection status. No network transport is running.'));
  if (!state.mode) {
    dialog.append(text('Choose a connection before opening a wallet.'), node('div', { class: 'actions' },
      button('Choose connection', () => { closePanel(); state.screen = 'choice'; render(true); }, 'primary')));
  } else {
    if (state.status === 'unavailable') dialog.append(text('Private is unavailable in this browser scenario. Wallet requests stay paused. You can retry or explicitly choose Standard.', 'notice'));
    if (['interrupted', 'offline'].includes(state.status)) dialog.append(text('Wallet requests stay paused. Your Private choice is retained when Private is selected; there is no automatic direct fallback.', 'notice'));
    if (state.deferred) dialog.append(text(`Switching to ${modeName(state.deferred)} is deferred during ${activities[state.activity]}. The current connection mode stays selected. Use Show safe point in the review tools.`, 'notice'));
    dialog.append(node('div', { class: 'actions' },
      state.mode === 'private' && state.status !== 'connected'
        ? button('Retry private connection', () => {
          closePanel(); state.status = 'reconnecting'; state.milestone = 0; state.deferred = null; render(true);
        }, 'secondary', { disabled: !!state.deferred || state.status === 'switching' }) : null,
      button(state.mode === 'private' ? 'Switch to Standard' : 'Switch to Private', () => requestSwitch(state.mode === 'private' ? 'standard' : 'private'),
        'secondary', { disabled: !!state.deferred || state.status === 'switching' })));
  }
  dialog.append(boundaries());
  showDialog(event?.currentTarget);
}
function requestSwitch(target) {
  dialogHeading(target === 'standard' ? 'Use a Standard connection?' : 'Use a Private connection?');
  dialog.append(text(target === 'standard'
    ? 'Wallet services may see your IP address. Switching affects future requests; it cannot undo information already shared.'
    : 'Supported wallet traffic would use Tor. The website host and browser gateway can still see your IP. Private may be slower.'),
  text(state.activity === 'idle' ? 'New wallet requests pause while the replacement transport is established.'
    : `The switch will wait until ${activities[state.activity]} reaches a safe point. No operation will be retried or aborted by this preview.`, 'notice'),
  node('div', { class: 'actions' }, button('Keep current connection', openPanel),
    button(target === 'standard' ? 'Use Standard connection' : 'Use Private connection', () => {
      closePanel();
      if (state.activity !== 'idle') { state.deferred = target; render(true); }
      else startSwitch(target);
    }, 'primary')));
  showDialog();
}
function startSwitch(target) {
  Object.assign(state, { mode: target, status: 'switching', milestone: 0, deferred: null, screen: 'dashboard' });
  render(true);
}
function applyScenario(value) {
  if (dialog.open) closePanel();
  Object.assign(state, { screen: 'dashboard', mode: 'private', draft: 'private', status: 'connected',
    milestone: 0, deferred: null, returning: false, tab: 'overview' });
  if (['welcome', 'choice', 'no-preference'].includes(value)) {
    state.screen = value === 'welcome' ? 'welcome' : 'choice'; state.mode = null; state.status = 'idle';
    state.returning = value === 'no-preference';
  } else if (['connecting', 'validating'].includes(value)) {
    state.screen = 'establish'; state.status = 'connecting'; state.milestone = value === 'validating' ? 3 : 0;
  } else if (value === 'standard' || value === 'return-standard' || value === 'standard-offline') {
    state.mode = 'standard'; state.draft = 'standard'; state.status = value === 'standard-offline' ? 'offline' : 'connected';
    state.returning = value === 'return-standard';
  } else if (value === 'return-private') {
    state.returning = true; state.status = 'connecting';
  } else if (value !== 'connected') state.status = value;
  render();
}
$('scenario').addEventListener('change', (event) => applyScenario(event.target.value));
$('activity').addEventListener('change', (event) => {
  state.activity = event.target.value;
  if (state.activity === 'idle' && state.deferred) { startSwitch(state.deferred); return; }
  render();
});
$('connection-status').addEventListener('click', openPanel);
$('theme').addEventListener('click', () => {
  const light = document.documentElement.dataset.theme !== 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  $('theme').textContent = light ? 'Dark theme' : 'Light theme';
  $('theme').setAttribute('aria-label', `Switch to ${light ? 'dark' : 'light'} theme`);
});
render();
