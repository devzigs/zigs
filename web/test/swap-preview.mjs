import assert from 'node:assert/strict';
import { MockSwapProvider, SwapPreviewModel, SWAP_DEMO_ASSETS, SWAP_DEMO_STEPS,
  swapAtomic, swapDecimal } from '../swap-preview-model.js';
import { NearIntentsSwapProvider } from '../near-intents-swap-provider.js';

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
console.log('swap-preview: exact amounts, validation, stale-response races, demo transitions and live-adapter lock pass');
