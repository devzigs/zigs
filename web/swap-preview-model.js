// A memory-only product preview. No wallet, storage, signer or network dependencies.
/** @typedef {'IDLE'|'INPUT_VALID'|'MOCK_QUOTING'|'MOCK_QUOTE_READY'|'MOCK_QUOTE_ERROR'|'MOCK_QUOTE_STALE'|'REVIEW_OPEN'|'REVIEW_CANCELLED'|'DEMO_PROGRESS'|'DEMO_COMPLETE'} SwapUiState */
/** @typedef {{originAssetId:string,destinationAssetId:string,amountAtomic:string,exactInput:true,recipient:string,refundTo:string,slippageBps:number,originNetwork:string,destinationNetwork:string}} SwapQuoteInput */
/** @typedef {{id:string,inputAtomic:string,outputAtomic:string,minimumOutputAtomic:string,source:'demo',routeLabel:string}} SwapQuote */
/** @typedef {{supportedAssets:()=>Promise<readonly object[]>,previewQuote:(input:SwapQuoteInput)=>Promise<SwapQuote>}} SwapProvider */
/** @typedef {{from:string,to:string,amount:string,slippageBps:number,destination:string,quote:SwapQuote|null,error:string,step:number,phase:SwapUiState}} SwapPreviewState */

export const SWAP_DEMO_ASSETS = Object.freeze([
  { id: 'demo:zec:zcash', symbol: 'ZEC', name: 'Zcash', network: 'Zcash', decimals: 8, icon: '/assets/zcash.svg', tone: 'zec', basis: 80 },
  { id: 'demo:sol:solana', symbol: 'SOL', name: 'Solana', network: 'Solana', decimals: 9, icon: '/assets/solana.svg', tone: 'sol', basis: 160 },
  { id: 'demo:usdc:solana', symbol: 'USDC', name: 'USD Coin', network: 'Solana', decimals: 6, icon: '/assets/usdc.svg', tone: 'usdc', basis: 1 },
].map(Object.freeze));
export const swapDemoAsset = (id) => SWAP_DEMO_ASSETS.find((a) => a.id === id);
const scale = (asset) => 10n ** BigInt(asset.decimals);

// Integer arithmetic keeps precision validation and tiny outputs honest, even in a demo.
export function swapAtomic(text, asset) {
  if (typeof text !== 'string' || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) || text.length > 60) return null;
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > asset.decimals) return null;
  return BigInt(whole || '0') * scale(asset) + BigInt(fraction.padEnd(asset.decimals, '0'));
}
export function swapDecimal(atomic, asset) {
  const value = BigInt(atomic), base = scale(asset);
  const fraction = (value % base).toString().padStart(asset.decimals, '0').replace(/0+$/, '');
  return (value / base).toString() + (fraction ? '.' + fraction : '');
}
export function swapInputError(s, fixture) {
  const from = swapDemoAsset(s.from), to = swapDemoAsset(s.to);
  if (!from || !to) return 'Choose an illustrative asset on each side.';
  if (s.from === s.to) return 'Choose different assets or networks.';
  if (!s.amount) return '';
  return amountError(s.amount, from) || fixtureBalanceError(s.amount, from, fixture)
    || (!s.destination ? 'Choose a preview destination.' : '');
}
function amountError(text, from) {
  const amount = swapAtomic(text, from);
  if (amount === null) return 'Enter a decimal amount with up to ' + from.decimals + ' decimal places.';
  if (amount <= 0n) return 'Enter an amount greater than zero.';
  if (amount > 1000000000n * scale(from)) return 'This amount exceeds the preview limit.';
  return '';
}
function fixtureBalanceError(text, from, fixture = {}) {
  if (fixture.staleBalance) return 'The fixture balance is out of date. Refresh the fixture before previewing.';
  if (fixture.balanceAtomic != null && swapAtomic(text, from) > BigInt(fixture.balanceAtomic)) return 'Insufficient illustrative balance. No real wallet balance is used.';
  return '';
}
function validPreviewAssets(input) {
  const from = swapDemoAsset(input.originAssetId), to = swapDemoAsset(input.destinationAssetId);
  return !!from && !!to && from.id !== to.id
    && input.originNetwork === from.network && input.destinationNetwork === to.network;
}
function validPreviewInput(input) {
  return validPreviewAssets(input) && input.exactInput === true
    && input.recipient === 'preview-only:destination' && input.refundTo === 'preview-only:refund'
    && [50, 100, 200].includes(input.slippageBps)
    && /^\d+$/.test(input.amountAtomic) && BigInt(input.amountAtomic) > 0n;
}

/** Deterministic fixtures only. Scenario injection is for the isolated test harness. */
export class MockSwapProvider {
  constructor(fixture = {}) { this.fixture = fixture; }
  async supportedAssets() { return SWAP_DEMO_ASSETS; }
  async previewQuote(input) {
    if (this.fixture.fail) throw Error('The illustrative quote is unavailable. Try the preview again.');
    if (this.fixture.unsupported) throw Error('This example pair has no illustrative route. Choose another pair.');
    const from = swapDemoAsset(input.originAssetId), to = swapDemoAsset(input.destinationAssetId);
    if (!validPreviewInput(input))
      throw Error('Invalid preview input. No live quote was requested.');
    const output = BigInt(input.amountAtomic) * BigInt(from.basis) * scale(to) / (BigInt(to.basis) * scale(from));
    const minimum = output * BigInt(10000 - input.slippageBps) / 10000n;
    if (minimum <= 0n) throw Error('This amount is too small for the illustrative destination precision.');
    return Object.freeze({ id: 'demo-quote', source: 'demo', inputAtomic: input.amountAtomic,
      outputAtomic: String(output), minimumOutputAtomic: String(minimum), routeLabel: 'NEAR Intents · planned' });
  }
}

export const SWAP_DEMO_STEPS = Object.freeze([
  'Quote review', 'Source authorisation', 'Deposit observed', 'Route processing', 'Destination delivery',
]);

export class SwapPreviewModel {
  constructor(provider = new MockSwapProvider(), changed = () => {}) {
    this.provider = provider; this.changed = changed; this.revision = 0;
    /** @type {SwapPreviewState} */
    this.value = { from: SWAP_DEMO_ASSETS[0].id, to: SWAP_DEMO_ASSETS[1].id, amount: '',
      slippageBps: 50, destination: 'example', quote: null, error: '', step: 0,
      phase: 'IDLE' };
  }
  emit() { this.changed(this.value); }
  applyInput(patch = {}) {
    for (const key of ['from', 'to', 'amount', 'slippageBps', 'destination'])
      if (Object.hasOwn(patch, key)) this.value[key] = patch[key];
    const s = this.value;
    s.quote = null; s.step = 0; s.error = swapInputError(s, this.provider.fixture);
    s.phase = s.error ? 'MOCK_QUOTE_ERROR' : s.amount ? 'INPUT_VALID' : 'IDLE';
    this.emit();
  }
  async update(patch) {
    const revision = ++this.revision;
    this.applyInput(patch);
    const s = this.value;
    if (s.error || !s.amount) return;
    s.phase = 'MOCK_QUOTING'; this.emit();
    try {
      const from = swapDemoAsset(s.from), to = swapDemoAsset(s.to);
      const quote = await this.provider.previewQuote({ originAssetId: s.from, destinationAssetId: s.to,
        amountAtomic: String(swapAtomic(s.amount, from)), exactInput: true,
        recipient: 'preview-only:destination', refundTo: 'preview-only:refund',
        slippageBps: s.slippageBps, originNetwork: from.network, destinationNetwork: to.network });
      if (revision !== this.revision) return;
      if (quote.source !== 'demo' || Object.hasOwn(quote, 'originDepositAddress'))
        throw Error('Only illustrative quotes without deposit addresses are accepted in this preview.');
      s.quote = quote; s.phase = 'MOCK_QUOTE_READY';
    } catch (error) {
      if (revision !== this.revision) return;
      s.error = error.message; s.phase = 'MOCK_QUOTE_ERROR';
    }
    this.emit();
  }
  reverse() { return this.update({ from: this.value.to, to: this.value.from }); }
  stale() {
    ++this.revision; this.value.quote = null; this.value.phase = 'MOCK_QUOTE_STALE';
    this.value.error = 'The illustrative quote was cleared. Refresh the preview to continue.'; this.emit();
  }
  review() {
    if (!this.value.quote || this.value.phase !== 'MOCK_QUOTE_READY') return false;
    this.value.phase = 'REVIEW_OPEN'; this.emit(); return true;
  }
  cancelReview() {
    if (this.value.phase === 'REVIEW_OPEN') { this.value.phase = 'REVIEW_CANCELLED'; this.emit(); }
  }
  resume() {
    if (this.value.phase === 'REVIEW_CANCELLED') { this.value.phase = 'MOCK_QUOTE_READY'; this.emit(); }
  }
  simulate() {
    if (this.value.phase !== 'REVIEW_OPEN') return;
    this.value.phase = 'DEMO_PROGRESS'; this.value.step = 0; this.emit();
  }
  advance() {
    if (this.value.phase !== 'DEMO_PROGRESS') return;
    this.value.step++;
    if (this.value.step === SWAP_DEMO_STEPS.length) this.value.phase = 'DEMO_COMPLETE';
    this.emit();
  }
  exitSimulation() {
    if (!['DEMO_PROGRESS', 'DEMO_COMPLETE'].includes(this.value.phase)) return;
    this.value.step = 0; this.value.phase = 'MOCK_QUOTE_READY'; this.emit();
  }
}
