// Presentation and local demo interactions only. No signing or payment APIs are imported.
import { el } from './app-dom.js';
import { icon } from './app-icons.js';
import { createPostQuantumSwapPreview } from './app-postquantum-swap-preview.js';
import { MockSwapProvider, SWAP_DEMO_ASSETS, SWAP_DEMO_STEPS, SwapPreviewModel,
  swapDecimal, swapDemoAsset, swapInputError } from './swap-preview-model.js';

const previewTag = () => el('span', { class: 'swap-preview-tag' },
  el('span', { 'aria-hidden': 'true' }, '◌'), 'Preview mode');
const token = (asset) => el('img', { class: 'swap-token ' + asset.tone,
  src: asset.icon, alt: '', width: 32, height: 32, 'aria-hidden': 'true' });
const text = (cls, value, tag = 'p') => el(tag, { class: cls }, value);
const button = (label, cls, onclick, attrs = {}) => el('button', {
  type: 'button', class: cls, onclick, ...attrs,
}, label);
const detail = (name, value) => el('div', { class: 'swap-detail-row' }, el('dt', {}, name), el('dd', {}, value));
const privacy = (zec) => zec
  ? 'Ironwood routing is unverified. Transparent Zcash transfers can reveal information.'
  : 'Network visibility varies by route. Input, output and intermediate transfers may be publicly visible.';

/** The optional provider argument is used only by the isolated development harness. */
export function createSwapPreview(context = {}, provider = new MockSwapProvider()) {
  let source = context, modal = null, observer = null, trigger = null;
  let pickerSide = null, searchText = '', rotation = 0;
  const model = new SwapPreviewModel(provider, update);
  const root = el('div', { class: 'page swap-page', id: 'panel-swap',
    'data-key': 'panel-swap', tabindex: '-1' });
  const pay = el('input', { id: 'swap-amount', class: 'swap-amount', type: 'text',
    inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', placeholder: '0.00',
    'aria-label': 'Amount you pay', 'aria-describedby': 'swap-amount-help swap-error',
    oninput: (ev) => { void model.update({ amount: ev.target.value }); } });
  const receive = el('input', { class: 'swap-amount swap-output', readonly: true,
    'aria-label': 'Illustrative amount you receive', value: '—', tabindex: '0' });
  const fromButton = button('', 'swap-asset-button', (ev) => openPicker('from', ev.currentTarget),
    { 'aria-label': 'Choose asset to pay', 'aria-haspopup': 'dialog', 'data-key': 'swap-from' });
  const toButton = button('', 'swap-asset-button', (ev) => openPicker('to', ev.currentTarget),
    { 'aria-label': 'Choose asset to receive', 'aria-haspopup': 'dialog', 'data-key': 'swap-to' });
  const fromNetwork = text('swap-network', ''), toNetwork = text('swap-network', '');
  const error = text('swap-error', ''); error.id = 'swap-error'; error.setAttribute('role', 'status');
  const quoteStatus = text('swap-quote-status', 'Select a pair and enter an amount to preview a swap.');
  quoteStatus.setAttribute('role', 'status');
  const quoteDetails = el('dl', { class: 'swap-quote-details' });
  const reverse = button(icon('swap'), 'swap-reverse', () => {
    rotation += 180; reverse.style.setProperty('--swap-rotation', rotation + 'deg');
    void model.reverse();
  }, { 'aria-label': 'Reverse swap direction', 'data-key': 'swap-reverse' });
  const review = button(['Preview swap', el('span', { 'aria-hidden': 'true' }, '↗')],
    'swap-primary', (ev) => {
      if (!model.review()) return;
      openModal('Review swap preview', ev.currentTarget); drawReview();
    }, { disabled: true, 'data-key': 'swap-review', 'aria-haspopup': 'dialog' });
  const routeFrom = el('div', { class: 'swap-route-end' });
  const routeTo = el('div', { class: 'swap-route-end' });
  const privacyText = text('', '');
  const destination = el('select', { id: 'swap-destination', 'aria-label': 'Preview destination',
    onchange: (ev) => { void model.update({ destination: ev.target.value }); } },
  el('option', { value: 'example' }, 'Example destination · preview only'),
  el('option', { value: '' }, 'Choose a preview destination'));
  const settings = el('details', { class: 'swap-settings' });
  const settingValue = el('span', {}, '0.5%');
  const presets = [50, 100, 200].map((bps) => button(bps / 100 + '%', 'swap-preset', () => {
    void model.update({ slippageBps: bps });
  }, { 'aria-pressed': bps === 50 ? 'true' : 'false' }));
  settings.append(el('summary', {}, icon('settings'), 'Slippage', settingValue),
    el('div', { class: 'swap-settings-panel' }, text('', 'Maximum slippage', 'strong'),
      text('swap-caption', 'Illustrative setting'), el('div', { class: 'swap-presets' }, presets)));
  const sourceLine = text('swap-source-context', '');
  const networkLine = text('', '');
  const quantumFlow = createPostQuantumSwapPreview(() => {
    quantumIntroNodes().forEach(node => { node.hidden = false; });
    quantumContinue.focus();
  });
  const quantumContinue = button(['Continue', el('span', { 'aria-hidden': 'true' }, '→')],
    'swap-primary pq-continue', () => {
      quantumIntroNodes().forEach(node => { node.hidden = true; });
      quantumFlow.start();
    }, { 'aria-label': 'Continue to post-quantum swap demo' });
  let activeTab = 'private';
  const modes = [
    { id: 'private', label: 'Private Swaps', status: 'Preview' },
    { id: 'quantum', label: 'Post-Quantum Privacy', status: 'Planned' },
  ];
  const modeTabs = modes.map((mode) => button([
    el('span', { class: 'swap-tab-label' }, mode.label),
    el('span', { class: 'swap-tab-provider' }, 'Powered by NEAR Intents'),
    el('span', { class: 'swap-tab-status', id: 'swap-tab-' + mode.id + '-status' }, mode.status),
  ], 'swap-mode-tab', () => selectTab(mode.id), {
    role: 'tab', id: 'swap-tab-' + mode.id, 'aria-controls': 'swap-panel-' + mode.id,
    'aria-selected': String(mode.id === activeTab), tabindex: mode.id === activeTab ? '0' : '-1',
    'aria-label': mode.label, 'aria-describedby': 'swap-tab-' + mode.id + '-status',
    onkeydown: (ev) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
      ev.preventDefault();
      const index = ev.key === 'Home' ? 0 : ev.key === 'End' ? 1
        : (modes.findIndex((m) => m.id === activeTab) + (ev.key === 'ArrowRight' ? 1 : -1) + modes.length) % modes.length;
      selectTab(modes[index].id, true);
    },
  }));
  root.append(el('header', { class: 'swap-heading' },
    el('div', { class: 'swap-topline' }, text('swap-eyebrow', 'EXCHANGE'), previewTag()),
    el('h1', {}, 'Swap assets', el('span', { 'aria-hidden': 'true' }, '.')),
    text('swap-subtitle', 'Exchange across networks with a clear quote before you proceed.')),
  el('div', { class: 'swap-mode-tabs', role: 'tablist', 'aria-label': 'Swap privacy options' }, modeTabs),
  el('div', { class: 'swap-panel', id: 'swap-panel-private', role: 'tabpanel',
    'aria-labelledby': 'swap-tab-private', tabindex: '0' },
  el('div', { class: 'swap-grid' },
    el('section', { class: 'swap-composer', 'aria-label': 'Swap composer' },
      el('div', { class: 'swap-pane' },
        el('div', { class: 'swap-pane-label' }, el('label', { for: 'swap-amount' }, 'You pay'),
          button('Max', 'swap-max', null, { disabled: true, 'aria-describedby': 'swap-amount-help' })),
        el('div', { class: 'swap-amount-row' }, pay, fromButton), fromNetwork,
        el('p', { class: 'swap-caption', id: 'swap-amount-help' }, 'Wallet balance unavailable in preview')),
      el('div', { class: 'swap-switch-row' }, reverse),
      el('div', { class: 'swap-pane swap-receive' },
        el('div', { class: 'swap-pane-label' }, el('span', {}, 'You receive'),
          text('swap-caption', 'Illustrative estimate', 'span')),
        el('div', { class: 'swap-amount-row' }, receive, toButton), toNetwork),
      el('div', { class: 'swap-quote' }, quoteStatus, quoteDetails), error,
      el('div', { class: 'swap-composer-footer' }, review,
        text('swap-caption swap-footer-note', 'No assets move. No quote is reserved.'))),
    el('aside', { class: 'swap-support', 'aria-label': 'Swap route and details' },
      el('section', { class: 'swap-detail-card' },
        el('div', { class: 'swap-detail-heading' }, el('h2', {},
          button(['Swap details', el('span', { 'aria-hidden': 'true' }, '↗')], 'swap-details-open',
            (ev) => { openModal('Swap details', ev.currentTarget); drawDetails(); },
            { 'aria-haspopup': 'dialog', 'data-key': 'swap-details' })), settings),
        text('swap-caption', 'Conceptual route'),
        el('div', { class: 'swap-route' }, routeFrom,
          el('span', { class: 'swap-route-link', 'aria-hidden': 'true' }, '→'), routeTo),
        el('div', { class: 'swap-provider' }, el('span', { class: 'swap-provider-mark', 'aria-hidden': 'true' }, 'N'),
          el('div', {}, text('', 'NEAR Intents', 'strong'), text('swap-caption', 'Planned provider · no live route'))),
        el('div', { class: 'swap-destination' }, el('label', { for: 'swap-destination' }, 'Receive to'), destination),
        button('Execution & network context ↗', 'swap-disclosure',
          (ev) => { openModal('Swap details', ev.currentTarget); drawDetails(); }, { 'aria-haspopup': 'dialog' })),
      el('section', { class: 'swap-privacy', 'aria-label': 'Route privacy' },
        icon('security'), el('div', {}, text('', 'Know the privacy boundary', 'h2'), privacyText)),
      text('swap-caption swap-support-note', 'Example assets and rates illustrate the experience. Route support is not guaranteed.')))),
  el('section', { class: 'swap-panel swap-quantum-panel', id: 'swap-panel-quantum', role: 'tabpanel',
    'aria-labelledby': 'swap-tab-quantum', tabindex: '0', hidden: true },
    el('div', { class: 'swap-quantum-intro' },
      text('swap-eyebrow', 'PLANNED ZCASH PRIVACY'),
      el('h2', {}, 'Separate swap addresses.', el('br'), 'Same shared wallet.'),
      text('swap-quantum-description', 'A separate viewing key for each ZEC swap, with your existing wallet approvals.'),
      el('div', { class: 'swap-quantum-status' }, icon('security'),
        el('div', {}, text('', 'Planned feature · try the demo', 'strong'),
          text('', 'No keys are generated and no assets move.'))),
      quantumContinue),
    el('div', { class: 'swap-quantum-steps', 'aria-label': 'Proposed swap experience' },
      [
        ['01', 'Separate addresses', 'Zigs would create a dedicated Zcash receiving or refund address automatically.'],
        ['02', 'Wallet approvals', 'The proposed flow would keep your shared wallet’s approval requirement.'],
        ['03', 'Recovery design', 'Swap receipts and refunds must remain recoverable after losing a device.'],
      ].map(([number, title, description]) => el('div', { class: 'swap-quantum-step' },
        el('span', { class: 'swap-step-number', 'aria-hidden': 'true' }, number),
        el('div', {}, text('', title, 'h3'), text('', description))))),
    el('div', { class: 'swap-quantum-boundary' },
      text('', 'What this would protect', 'strong'),
      text('', 'The full swap is not quantum-secure. Provider and public-chain visibility remain.')),
    quantumFlow.element));
  update();

  function selectTab(id, focus = true) {
    if (id !== activeTab) { closeModal(); resetQuantumFlow(); }
    activeTab = id;
    modeTabs.forEach((tab, i) => {
      const selected = modes[i].id === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      root.querySelector('#swap-panel-' + modes[i].id).hidden = !selected;
      if (selected && focus) tab.focus();
    });
  }

  function quantumIntroNodes() {
    return [...root.querySelector('#swap-panel-quantum').children].filter(node => node !== quantumFlow.element);
  }
  function resetQuantumFlow() {
    quantumFlow.reset();
    quantumIntroNodes().forEach(node => { node.hidden = false; });
  }

  function update() {
    const s = model.value, from = swapDemoAsset(s.from), to = swapDemoAsset(s.to);
    root.dataset.swapPhase = s.phase;
    fromButton.replaceChildren(token(from), el('span', {}, from.symbol), el('span', { class: 'swap-chevron', 'aria-hidden': 'true' }, '⌄'));
    toButton.replaceChildren(token(to), el('span', {}, to.symbol), el('span', { class: 'swap-chevron', 'aria-hidden': 'true' }, '⌄'));
    fromNetwork.textContent = from.network + ' · preview'; toNetwork.textContent = to.network + ' · preview';
    routeFrom.replaceChildren(token(from), text('swap-caption', 'FROM', 'span'), text('', from.network, 'strong'), text('swap-caption', from.symbol));
    routeTo.replaceChildren(token(to), text('swap-caption', 'TO', 'span'), text('', to.network, 'strong'), text('swap-caption', to.symbol));
    if (pay.value !== s.amount) pay.value = s.amount;
    pay.setAttribute('aria-invalid', String(!!s.error));
    receive.value = s.quote ? swapDecimal(s.quote.outputAtomic, to) : '—';
    receive.setAttribute('aria-label', 'Illustrative amount you receive: ' + receive.value + ' ' + to.symbol);
    error.textContent = s.error;
    error.hidden = !s.error;
    const ready = !!s.quote && ['MOCK_QUOTE_READY', 'REVIEW_CANCELLED'].includes(s.phase);
    if (s.phase === 'REVIEW_CANCELLED') model.resume();
    review.disabled = !ready;
    quoteStatus.textContent = s.quote ? 'Illustrative quote · Preview mode' : s.phase === 'MOCK_QUOTING'
      ? 'Calculating illustrative quote…' : 'Select a pair and enter an amount to preview a swap.';
    const rate = (from.basis / to.basis).toLocaleString('en-US', { maximumFractionDigits: 8 });
    quoteDetails.replaceChildren(
      detail('Illustrative rate', s.quote ? '1 ' + from.symbol + ' ≈ ' + rate + ' ' + to.symbol : '—'),
      detail('Minimum received', s.quote ? swapDecimal(s.quote.minimumOutputAtomic, to) + ' ' + to.symbol : '—'),
      detail('Network & provider fees', 'Calculated with a live quote'));
    settingValue.textContent = s.slippageBps / 100 + '%';
    presets.forEach((b, i) => b.setAttribute('aria-pressed', String([50, 100, 200][i] === s.slippageBps)));
    privacyText.textContent = privacy(from.symbol === 'ZEC' || to.symbol === 'ZEC');
    sourceLine.textContent = 'Source wallet: ' + (source.name || 'no wallet selected') + '. '
      + (source.threshold || 'Approval requirements will be shown with a selected wallet.');
    networkLine.textContent = (source.networks || 'Zcash Testnet · Solana Devnet')
      + '. Live execution requires separate network-compatibility approval; there is no mainnet fallback.';
    root.querySelectorAll('.swap-retry').forEach((n) => n.remove());
    if (s.error && s.amount && !swapInputError(s, provider.fixture)
      && ['MOCK_QUOTE_ERROR', 'MOCK_QUOTE_STALE'].includes(s.phase))
      error.append(' ', button('Retry preview', 'swap-retry', () => { void model.update(); }));
    if (modal && !pickerSide && modal.dataset.swapDetails !== 'true'
      && !['REVIEW_OPEN', 'DEMO_PROGRESS', 'DEMO_COMPLETE', 'REVIEW_CANCELLED'].includes(s.phase)) closeModal(false);
    if (modal && ['DEMO_PROGRESS', 'DEMO_COMPLETE'].includes(s.phase)) drawProgress();
  }

  function closeModal(cancel = true) {
    observer?.disconnect(); observer = null;
    const old = modal; modal = null; pickerSide = null;
    old?.close(); old?.remove();
    if (cancel) { model.cancelReview(); model.resume(); model.exitSimulation(); }
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }
  function openModal(title, opener) {
    if (modal) closeModal(false);
    trigger = opener; modal = el('dialog', { class: 'swap-modal', 'aria-labelledby': 'swap-modal-title' });
    modal.addEventListener('cancel', (ev) => { ev.preventDefault(); closeModal(); });
    // The native dialog owns Escape; do not let the wallet's unrelated layer handler consume it.
    modal.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeModal(); }
      if (ev.key === 'Tab') {
        const stops = [...modal.querySelectorAll('button,input,select,summary,[tabindex="0"]')]
          .filter((n) => !n.disabled && n.getClientRects().length);
        const at = stops.indexOf(document.activeElement), last = stops.length - 1;
        if (at < 0 || (ev.shiftKey ? at === 0 : at === last)) {
          ev.preventDefault(); stops[ev.shiftKey ? last : 0]?.focus();
        }
      }
    });
    modal.addEventListener('click', (ev) => { if (ev.target === modal) {
      const r = modal.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) closeModal();
    } });
    modal.append(el('div', { class: 'swap-modal-heading' },
      el('div', {}, previewTag(), el('h2', { id: 'swap-modal-title', tabindex: '-1' }, title)),
      button('×', 'swap-close', () => closeModal(), { 'aria-label': 'Close preview dialog' })),
    el('div', { class: 'swap-modal-content' }));
    document.body.append(modal); modal.showModal();
    modal.querySelector('h2').focus();
    observer = new window.MutationObserver(() => { if (!root.isConnected) closeModal(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  function openPicker(side, opener) {
    openModal(side === 'from' ? 'Choose asset to pay' : 'Choose asset to receive', opener);
    pickerSide = side; searchText = '';
    const search = el('input', { class: 'swap-search', type: 'search', placeholder: 'Search asset or network',
      'aria-label': 'Search illustrative assets', oninput: (ev) => { searchText = ev.target.value; drawAssets(); } });
    modal.querySelector('.swap-modal-content').append(search,
      el('div', { class: 'swap-asset-list' }),
      text('swap-caption', 'Illustrative assets only. Live support will be checked against provider and wallet capabilities.'));
    drawAssets(); search.focus();
  }
  function drawAssets() {
    const matches = SWAP_DEMO_ASSETS.filter((a) => (a.symbol + ' ' + a.name + ' ' + a.network).toLowerCase().includes(searchText.trim().toLowerCase()));
    modal.querySelector('.swap-asset-list').replaceChildren(...(matches.length ? matches.map((a) => button([
      token(a), el('span', {}, text('', a.symbol + ' · ' + a.network, 'strong'), text('swap-caption', a.name + ' · illustrative', 'span')),
      el('span', { class: 'swap-choice-mark', 'aria-hidden': 'true' }, a.id === model.value[pickerSide] ? '✓' : '↗'),
    ], 'swap-asset-choice', () => {
      const side = pickerSide; closeModal(false); void model.update({ [side]: a.id });
    }, { 'aria-label': a.symbol + ' on ' + a.network + ', illustrative' }))
      : [text('swap-picker-empty', 'No example assets match your search.') ]));
  }
  function reviewRows() {
    const s = model.value, from = swapDemoAsset(s.from), to = swapDemoAsset(s.to);
    return el('dl', { class: 'swap-review-details' },
      detail('You pay', s.amount + ' ' + from.symbol + ' · ' + from.network),
      detail('Estimated receive', swapDecimal(s.quote.outputAtomic, to) + ' ' + to.symbol + ' · ' + to.network),
      detail('Minimum received', swapDecimal(s.quote.minimumOutputAtomic, to) + ' ' + to.symbol),
      detail('Maximum slippage', s.slippageBps / 100 + '% · simulated'),
      detail('Recipient', 'Example destination — preview only'),
      detail('Refund destination', 'Example refund — preview only'),
      detail('Source wallet', source.name || 'No wallet selected'),
      detail('Approval requirement', source.threshold || 'Shown after wallet selection'),
      detail('Network & provider fees', 'Calculated with a live quote'),
      detail('Price impact & timing', 'Not supplied by this illustrative quote'),
      detail('Quote basis', 'Illustrative · no reservation or expiry'),
      detail('Route', from.network + ' → NEAR Intents (planned) → ' + to.network));
  }
  function drawDetails() {
    modal.dataset.swapDetails = 'true';
    const s = model.value, from = swapDemoAsset(s.from), to = swapDemoAsset(s.to);
    const select = destination.cloneNode(true);
    select.id = 'swap-modal-destination'; select.value = s.destination;
    select.addEventListener('change', (ev) => {
      const value = ev.target.value; closeModal(false); void model.update({ destination: value });
    });
    modal.querySelector('.swap-modal-content').replaceChildren(
      text('swap-caption', 'Illustrative route · no live quote reserved'),
      text('swap-details-route', from.network + ' → NEAR Intents (planned) → ' + to.network),
      quoteDetails.cloneNode(true),
      el('div', { class: 'swap-destination' }, el('label', { for: select.id }, 'Receive to'), select),
      text('swap-caption', sourceLine.textContent),
      el('div', { class: 'swap-review-warning' }, text('', 'Privacy & network context', 'strong'),
        text('', privacy(from.symbol === 'ZEC' || to.symbol === 'ZEC')), text('', networkLine.textContent),
        text('', 'The external provider would coordinate delivery through a trusted swapping agent. Wallet approval protection does not extend to the whole route.')),
      text('swap-caption', 'Only ZEC, SOL and USDC are shown. Example rates and assets do not guarantee live support.'),
      button('Back to preview', 'swap-secondary', () => closeModal()));
  }
  function drawReview() {
    const to = swapDemoAsset(model.value.to);
    modal.querySelector('.swap-modal-content').replaceChildren(
      el('div', { class: 'swap-review-amount' }, text('swap-caption', 'Illustrative receive amount'),
        text('', swapDecimal(model.value.quote.outputAtomic, to), 'strong'), text('swap-caption', to.symbol + ' · ' + to.network)),
      reviewRows(),
      el('div', { class: 'swap-review-warning' }, text('', 'Review the route boundary', 'strong'),
        text('', privacy(swapDemoAsset(model.value.from).symbol === 'ZEC' || to.symbol === 'ZEC')),
        text('', (source.networks || 'Zcash Testnet · Solana Devnet')
          + ' execution is not integrated. No destination or refund address has been validated.')),
      text('swap-simulation-note', 'No transaction will be signed or sent.'),
      button(['Simulate swap flow', el('span', { 'aria-hidden': 'true' }, '→')], 'swap-primary', () => {
        modal.querySelector('h2').textContent = 'Swap flow simulation'; model.simulate();
        modal.querySelector('h2').focus();
      }), button('Back to preview', 'swap-secondary', () => closeModal()));
  }
  function drawProgress() {
    const s = model.value, done = s.phase === 'DEMO_COMPLETE';
    modal.querySelector('.swap-modal-content').replaceChildren(
      text('swap-simulation-note', 'Simulation only · no signing or transfers'),
      el('ol', { class: 'swap-progress-list' }, SWAP_DEMO_STEPS.map((step, i) => el('li', {
        class: i < s.step ? 'is-demonstrated' : i === s.step ? 'is-current' : '',
        'aria-current': i === s.step ? 'step' : null,
      }, el('span', { class: 'swap-step-number', 'aria-hidden': 'true' }, i < s.step ? '✓' : i + 1),
      el('div', {}, text('', step, 'strong'), text('swap-caption', i < s.step ? 'Demonstrated · no real event'
        : i === s.step ? 'Next simulated step' : 'Illustrative step'))))),
      el('p', { class: 'swap-demo-result', role: 'status' }, done ? 'Demo complete. No assets were moved.'
        : 'Advance each example step yourself. Nothing is broadcast or signed.'),
      button(done ? 'Back to preview' : 'Next demo step →', 'swap-primary', () => {
        if (done) { closeModal(false); void model.update(); return; }
        model.advance(); modal.querySelector('.swap-primary').focus({ preventScroll: true });
      }));
  }
  return { element: root, model, setContext(next) {
    if (source.id !== next.id || source.threshold !== next.threshold || source.networks !== next.networks) {
      closeModal(); resetQuantumFlow(); model.stale();
    }
    source = next; update();
  } };
}
