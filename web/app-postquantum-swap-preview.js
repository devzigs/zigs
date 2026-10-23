// Local product mock only. Never imports a live provider, signing, keys or persistence.
import { el } from './app-dom.js';
import { icon } from './app-icons.js';
import { MockSwapProvider, SWAP_DEMO_ASSETS, SwapPreviewModel,
  swapDecimal, swapDemoAsset } from './swap-preview-model.js';

const text = (cls, value, tag = 'p') => el(tag, { class: cls }, value);
const button = (label, cls, onclick, attrs = {}) => el('button', {
  type: 'button', class: cls, onclick, ...attrs,
}, label);
const detail = (name, value) => el('div', { class: 'swap-detail-row' },
  el('dt', {}, name), el('dd', {}, value));
const token = (asset) => el('img', { class: 'swap-token', src: asset.icon, alt: '',
  width: 32, height: 32, 'aria-hidden': 'true' });

export function createPostQuantumSwapPreview(onExit) {
  let stage = 'configure', reviewed = null, approvals = 0, progress = 0, outcome = null, run = 0;
  let detailsDialog = null, detailsObserver = null, detailsOpener = null;
  const model = new SwapPreviewModel(new MockSwapProvider(), updateQuote);
  const root = el('div', { class: 'pq-flow', hidden: true });
  const title = text('', 'Configure your swap', 'h2'); title.tabIndex = -1;
  const steps = el('ol', { class: 'pq-stepper', 'aria-label': 'Demo swap steps' });
  const content = el('div', { class: 'pq-content' });
  const recap = el('aside', { class: 'pq-recap', 'aria-label': 'Demo privacy and route' });
  const receive = text('pq-receive-value', '—', 'strong');
  const quoteDetails = el('dl', { class: 'swap-quote-details' });
  const error = text('swap-error', ''); error.id = 'pq-amount-error'; error.setAttribute('role', 'status');
  const amount = el('input', { id: 'pq-amount', class: 'swap-amount', type: 'text',
    inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
    'aria-label': 'Demo ZEC amount', 'aria-describedby': 'pq-amount-error pq-quote-note',
    oninput: () => { void model.update({ amount: amount.value }); } });
  const destinationAsset = el('select', { id: 'pq-receive-asset', 'aria-label': 'Demo receive asset',
    onchange: () => { void model.update({ to: destinationAsset.value }); } },
  ...[SWAP_DEMO_ASSETS[2], SWAP_DEMO_ASSETS[1]].map(a => el('option', { value: a.id }, a.symbol + ' · ' + a.network)));
  const next = button(['Review demo swap', el('span', { 'aria-hidden': 'true' }, '→')], 'swap-primary', () => {
    if (!model.value.quote || model.value.phase !== 'MOCK_QUOTE_READY') return;
    reviewed = Object.freeze({ amount: model.value.amount, to: model.value.to, quote: model.value.quote });
    show('review');
  }, { disabled: true });
  const form = el('form', { class: 'pq-form', onsubmit: ev => ev.preventDefault() },
    el('div', { class: 'swap-pane' },
      el('label', { class: 'pq-label', for: 'pq-amount' }, 'You pay · Zcash'),
      el('div', { class: 'swap-amount-row' }, amount,
        el('span', { class: 'pq-asset' }, token(SWAP_DEMO_ASSETS[0]), 'ZEC'))),
    el('div', { class: 'pq-route-arrow', 'aria-hidden': 'true' }, '↓'),
    el('div', { class: 'swap-pane swap-receive' },
      el('label', { class: 'pq-label', for: 'pq-receive-asset' }, 'Illustrative receive · Solana'),
      el('div', { class: 'pq-receive-row' }, receive, destinationAsset)),
    el('div', { class: 'pq-destination' },
      text('', 'Receive to', 'strong'), text('', 'Example external wallet')),
    quoteDetails,
    text('swap-caption', 'Example rate · fees unquoted and excluded.', 'p'));
  form.lastChild.id = 'pq-quote-note';
  form.append(error, next);
  root.append(el('header', { class: 'pq-flow-heading' },
    button('← Back', 'pq-back', () => { reset(); onExit(); }, { 'aria-label': 'Back to introduction' }),
    text('pq-demo-label', 'DEMO · NO FUNDS MOVE', 'span'),
    button(['Details', el('span', { 'aria-hidden': 'true' }, '↗')], 'swap-secondary pq-details-button', ev => openDetails(ev.currentTarget),
      { 'aria-haspopup': 'dialog', 'aria-label': 'Swap details & privacy' })),
    steps, el('div', { class: 'pq-flow-title' }, title),
    el('div', { class: 'pq-layout' }, content, recap));

  function focusTitle() {
    if (root.isConnected && !root.hidden) title.focus();
  }
  function reset() {
    closeDetails();
    stage = 'configure'; reviewed = null; approvals = 0; progress = 0; outcome = null;
    model.stale();
    root.hidden = true;
  }
  function start() {
    run++; stage = 'configure'; reviewed = null; approvals = 0; progress = 0; outcome = null;
    root.hidden = false; amount.value = '1'; destinationAsset.value = SWAP_DEMO_ASSETS[2].id;
    show('configure');
    void model.update({ from: SWAP_DEMO_ASSETS[0].id, to: destinationAsset.value,
      amount: amount.value, destination: 'example', slippageBps: 50 });
  }
  function updateQuote() {
    const s = model.value, to = swapDemoAsset(s.to);
    receive.textContent = s.quote ? swapDecimal(s.quote.outputAtomic, to) : '—';
    receive.setAttribute('aria-label', 'Illustrative receive amount: ' + receive.textContent + ' ' + to.symbol);
    error.textContent = s.error; error.hidden = !s.error;
    amount.setAttribute('aria-invalid', String(!!s.error));
    next.disabled = !s.quote || s.phase !== 'MOCK_QUOTE_READY';
    quoteDetails.replaceChildren(
      detail('Illustrative minimum', s.quote ? swapDecimal(s.quote.minimumOutputAtomic, to) + ' ' + to.symbol : '—'));
    if (stage === 'configure') drawRecap();
  }
  function drawRecap() {
    const to = swapDemoAsset(reviewed?.to || model.value.to);
    recap.replaceChildren(
      el('div', { class: 'pq-recap-preview' },
        el('div', { class: 'pq-key-card' }, icon('security'),
          text('', 'Dedicated refund · simulated', 'strong'),
          text('pq-reference', reference(), 'span')),
        el('dl', { class: 'pq-route-details' },
        detail('Route', 'ZEC → ' + to.symbol + ' on Solana'),
        detail('Example approvals', '2 of 3 devices')),
        text('swap-caption', 'Example reference only. No address or viewing key is generated.')));
  }
  function reference() { return 'DEMO-SWAP-' + String(run).padStart(3, '0'); }
  function closeDetails() {
    detailsObserver?.disconnect(); detailsObserver = null;
    const old = detailsDialog; detailsDialog = null;
    old?.close(); old?.remove();
    if (detailsOpener?.isConnected) detailsOpener.focus({ preventScroll: true });
  }
  function openDetails(opener) {
    closeDetails(); detailsOpener = opener;
    const s = reviewed || model.value, to = swapDemoAsset(s.to);
    detailsDialog = el('dialog', { class: 'swap-modal pq-details-dialog', 'aria-labelledby': 'pq-details-title' },
      el('div', { class: 'swap-modal-heading' },
        el('h2', { id: 'pq-details-title', tabindex: '-1' }, 'Swap details & privacy'),
        button('×', 'swap-close', closeDetails, { 'aria-label': 'Close swap details' })),
      text('swap-simulation-note', 'Demo only · no funds, no real quote · planned provider: NEAR Intents'),
      el('dl', { class: 'swap-review-details' },
        detail('Example wallet', '2 of 3 device approvals'),
        detail('Route', 'ZEC → ' + to.symbol + ' on Solana'),
        detail('Illustrative rate', '1 ZEC ≈ ' + (80 / to.basis) + ' ' + to.symbol),
        detail('Illustrative minimum', s.quote ? swapDecimal(s.quote.minimumOutputAtomic, to) + ' ' + to.symbol : 'Unavailable'),
        detail('Fees', 'Unquoted; not deducted in demo'),
        detail('Receive to', 'Example wallet · no real address'),
        detail('Refund to', 'Transparent Zcash address · example'),
        detail('Example reference', reference())),
      el('div', { class: 'pq-boundary' }, text('', 'Privacy boundary', 'strong'),
        text('', 'A live swap would reserve its own refund viewing key before quoting, keeping your usual address out of those swap parameters. NEAR Intents 1Click handles ZEC only at transparent addresses, so a live swap with ZEC would leave the shielded pool. Provider and public-chain visibility still apply. The full swap is not quantum-secure.')),
      text('swap-caption', 'No keys, addresses, transactions or recovery records are created. Live recovery must rediscover receipts and refunds after device loss; this demo does not verify it.'),
      button('Back to swap', 'swap-primary', closeDetails));
    detailsDialog.addEventListener('cancel', ev => { ev.preventDefault(); ev.stopPropagation(); closeDetails(); });
    detailsDialog.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeDetails(); }
      if (ev.key === 'Tab') {
        const stops = [...detailsDialog.querySelectorAll('button')], at = stops.indexOf(document.activeElement);
        if (at < 0 || (!ev.shiftKey && at === stops.length - 1) || (ev.shiftKey && at === 0)) {
          ev.preventDefault(); stops[ev.shiftKey ? stops.length - 1 : 0].focus();
        }
      }
    });
    document.body.append(detailsDialog); detailsDialog.showModal();
    detailsDialog.querySelector('h2').focus();
    detailsObserver = new window.MutationObserver(() => { if (!root.isConnected || root.hidden) closeDetails(); });
    detailsObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }
  function show(nextStage) {
    stage = nextStage; root.dataset.demoStage = stage;
    const at = stage === 'configure' ? 0 : ['review', 'expired'].includes(stage) ? 1 : stage === 'approvals' ? 2 : 3;
    steps.replaceChildren(...['Configure', 'Review', 'Approvals', 'Status'].map((label, i) =>
      el('li', { class: i === at ? 'is-current' : i < at ? 'is-complete' : '',
        'aria-current': i === at ? 'step' : null },
      el('span', { 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')), label)));
    title.textContent = { configure: 'Configure your swap', review: 'Review your demo swap',
      approvals: 'Collect example approvals', progress: 'Follow your demo swap',
      expired: 'The example quote expired', result: outcome === 'refund' ? 'Refund demonstrated' : 'Delivery demonstrated' }[stage];
    content.replaceChildren();
    drawRecap();
    if (stage === 'configure') content.append(form);
    if (stage === 'review') drawReview();
    if (stage === 'approvals') drawApprovals();
    if (stage === 'progress') drawProgress();
    if (stage === 'result') drawResult();
    if (stage === 'expired') content.append(
      text('pq-body', 'A live swap would need a new quote and a fresh review. Any example approvals have been cleared.'),
      button('Refresh demo quote', 'swap-primary', () => {
        show('configure'); void model.update();
      }));
    focusTitle();
  }
  function summary() {
    const to = swapDemoAsset(reviewed.to), q = reviewed.quote;
    return el('div', { class: 'pq-swap-summary' },
      el('div', {}, token(SWAP_DEMO_ASSETS[0]), text('swap-caption', 'PAY'), text('', reviewed.amount + ' ZEC', 'strong')),
      el('span', { 'aria-hidden': 'true' }, '→'),
      el('div', {}, token(to), text('swap-caption', 'EXAMPLE RECEIVE'), text('', swapDecimal(q.outputAtomic, to) + ' ' + to.symbol, 'strong')));
  }
  function expire() { approvals = 0; progress = 0; reviewed = null; show('expired'); }
  function drawReview() {
    const to = swapDemoAsset(reviewed.to);
    content.append(summary(), el('dl', { class: 'swap-review-details' },
      detail('Example minimum', swapDecimal(reviewed.quote.minimumOutputAtomic, to) + ' ' + to.symbol),
      detail('Slippage', '0.5% · illustrative'),
      detail('Receive to', 'Example wallet'),
      detail('Refund to', 'Transparent · example'),
      detail('Fees', 'Unquoted · excluded')),
    button('Continue to demo approvals', 'swap-primary', () => { approvals = 0; show('approvals'); }),
    el('div', { class: 'pq-secondary-actions' },
      button('Edit swap', 'swap-secondary', () => { reviewed = null; show('configure'); }),
      button('Expire quote', 'swap-secondary', expire, { 'aria-label': 'Simulate quote expiry' })));
  }
  function drawApprovals() {
    content.append(text('pq-body', 'Example 2-of-3 wallet.'),
      el('div', { class: 'pq-approval-count', role: 'status' }, approvals + ' of 2 example approvals'),
      el('div', { class: 'pq-device-list' }, ['This device', 'Second device'].map((name, i) =>
        el('div', { class: 'pq-device' + (i < approvals ? ' is-approved' : '') },
          el('span', { class: 'swap-step-number', 'aria-hidden': 'true' }, i < approvals ? '✓' : String(i + 1)),
          el('div', {}, text('', name, 'strong'), text('swap-caption', i < approvals ? 'Approval simulated' : 'Awaiting demo approval'))))),
      text('swap-caption', 'Third device not needed.'),
      approvals < 2
        ? button(approvals === 0 ? 'Simulate this device approval' : 'Simulate second device approval', 'swap-primary', () => {
          approvals++; show('approvals');
        })
        : button('Continue to simulated execution', 'swap-primary', () => { progress = 0; show('progress'); }),
      el('div', { class: 'pq-secondary-actions' },
        button('Back to review', 'swap-secondary', () => { approvals = 0; show('review'); }),
        button('Expire quote', 'swap-secondary', expire, { 'aria-label': 'Simulate quote expiry' })));
  }
  function drawProgress() {
    const labels = ['Deposit confirmation', 'NEAR Intents execution', 'Delivery or refund'];
    content.append(summary(),
      el('ol', { class: 'swap-progress-list' }, labels.map((label, i) => el('li', {
        class: i < progress ? 'is-demonstrated' : i === progress ? 'is-current' : '',
        'aria-current': i === progress ? 'step' : null },
      el('span', { class: 'swap-step-number', 'aria-hidden': 'true' }, i < progress ? '✓' : String(i + 1)),
      el('div', {}, text('', label, 'strong'), text('swap-caption', i < progress ? 'Simulated' : i === progress ? 'Next' : 'Pending'))))),
      button(['Simulate deposit confirmation', 'Simulate route execution', 'Simulate delivery'][progress], 'swap-primary', () => {
        if (progress < 2) { progress++; show('progress'); }
        else { outcome = 'delivery'; show('result'); }
      }));
    if (progress === 2) content.append(button('Simulate refund instead', 'swap-secondary', () => {
      outcome = 'refund'; show('result');
    }));
  }
  function drawResult() {
    const refund = outcome === 'refund', to = swapDemoAsset(reviewed.to);
    content.append(el('div', { class: 'pq-result', role: 'status' },
      icon(refund ? 'swap' : 'security'),
      text('swap-caption', refund ? 'EXAMPLE REFUND' : 'EXAMPLE DELIVERY'),
      text('', refund ? 'Refund to Zcash' : swapDecimal(reviewed.quote.outputAtomic, to) + ' ' + to.symbol, 'h3'),
      text('pq-body', refund
        ? 'Demo result. No funds moved and no real quote was used.'
        : 'Demo result. No funds moved and no real quote was used. Unquoted fees excluded.')),
      el('dl', { class: 'swap-review-details' },
        detail('Outcome', refund ? 'Refund · simulated' : 'Delivery · simulated'),
        detail('Swap reference', 'DEMO-SWAP-' + String(run).padStart(3, '0')),
        detail('Actual funds moved', 'None')),
      button('Try another demo swap', 'swap-primary', start));
  }
  return { element: root, start, reset };
}
