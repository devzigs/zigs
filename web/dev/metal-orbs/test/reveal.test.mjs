import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { describeOrb, descriptorFromDigest, canonicalIdentity, isRareDigest, RARE_THRESHOLD, VERSION } from '../identity.js';
import { describeWalletIdentity, createRevealSession } from '../wallet-identity.js';
import { FLOW_FIXTURES } from '../flow-fixtures.js';
import { fallbackSvg } from '../fallback.js';
import { walletArtEntry } from '../../../wallet-art.js';

test('production artwork requires verified input and prepares SVG without loading a renderer', async () => {
  const zcash = FLOW_FIXTURES.ember.zcash;
  assert.equal(walletArtEntry(null), null);
  assert.equal(walletArtEntry({ ...zcash, verified: false }), null);
  const entry = walletArtEntry(zcash);
  await entry.ready;
  assert.equal(entry.descriptor.digest, (await describeWalletIdentity({ zcash })).digest);
  assert.equal(entry.mode, 'svg');
  assert.match(entry.src, /^data:image\/svg\+xml/);
  assert.equal(entry.rendered, undefined, 'detached or pure consumers do not load WebGL');
  assert.equal(walletArtEntry({ ...zcash, name: 'Renamed', solana: true }), entry);
  const invalid = walletArtEntry({ address: '<not-an-address>', network: 'testnet', verified: true });
  await invalid.ready;
  assert.equal(invalid.mode, 'unavailable');
  assert.equal(invalid.descriptor, null);
});

test('rarity uses exactly the last two digest bytes, with the approved threshold', () => {
  const bytes = new Uint8Array(32).fill(255);
  let rare = 0;
  for (let word = 0; word <= 65535; word++) {
    bytes[30] = word >>> 8; bytes[31] = word & 255;
    if (isRareDigest(bytes)) rare++;
  }
  assert.equal(rare, 3277); assert.equal(RARE_THRESHOLD, 3277);
  assert.ok(Math.abs(rare / 65536 - .05) < .00001);
  for (const [word, expected] of [[0,true], [3276,true], [3277,false], [65535,false]]) {
    bytes[30] = word >>> 8; bytes[31] = word & 255;
    assert.equal(isRareDigest(bytes), expected);
  }
});

test('rare trait adds two SVG inlays while retaining the same underlying sculpture', () => {
  const identity = canonicalIdentity('zcash:testnet', FLOW_FIXTURES.everyday.zcash.address);
  const bytes = new Uint8Array(createHash('sha256').update(identity.input).digest());
  bytes[30] = 0; bytes[31] = 0;
  const rare = descriptorFromDigest(identity, bytes);
  bytes[30] = 255; bytes[31] = 255;
  const ordinary = descriptorFromDigest(identity, bytes);
  assert.equal(rare.traits.inlay, 'Ember inlay'); assert.equal(ordinary.traits.inlay, null);
  assert.equal(rare.family, ordinary.family); assert.equal(rare.finish, ordinary.finish);
  assert.equal(rare.phase, ordinary.phase); assert.equal(rare.amplitude, ordinary.amplitude);
  assert.equal((fallbackSvg(rare).match(/data-finish="ember-inlay"/g) || []).length, 2);
  assert.ok(!fallbackSvg(ordinary).includes('data-finish="ember-inlay"'));
  assert.notEqual(fallbackSvg(rare), fallbackSvg(ordinary));
  assert.ok(Object.isFrozen(rare.traits)); assert.equal(VERSION, 'metal-orb-v3');
});

test('wallet identity is tied to verified Zcash public address/network only', async () => {
  const wallet = FLOW_FIXTURES.ember;
  const expected = await describeWalletIdentity(wallet);
  assert.ok(expected.traits.rare);
  assert.deepEqual(expected, await describeWalletIdentity({ ...wallet, name: 'Renamed wallet',
    device: 'Second device', solana: { enabled: false, cluster: 'mainnet-beta', address: 'ignored' } }));
  assert.deepEqual(expected, await describeWalletIdentity({ zcash: { ...wallet.zcash, address: wallet.zcash.address.toUpperCase() } }));
  assert.notEqual(expected.digest, (await describeWalletIdentity(FLOW_FIXTURES.everyday)).digest);
  assert.notEqual(expected.digest, (await describeWalletIdentity({ zcash: { ...wallet.zcash, network: 'mainnet' } })).digest);
  assert.equal(await describeWalletIdentity({ zcash: { ...wallet.zcash, verified: false } }), null);
  assert.equal(await describeWalletIdentity({ zcash: { ...wallet.zcash, network: 'unknown' } }), null);
  assert.equal(await describeWalletIdentity(), null);
  assert.deepEqual(expected, await describeOrb('zcash:testnet', wallet.zcash.address));
});

test('ordinary and rare fixtures reflect their real digest; reveal memory is per document', async () => {
  const ordinary = await describeWalletIdentity(FLOW_FIXTURES.everyday);
  const rare = await describeWalletIdentity(FLOW_FIXTURES.ember);
  assert.equal(ordinary.traits.rare, false); assert.equal(rare.traits.rare, true);
  for (const p of [ordinary, rare]) {
    assert.equal(p.traits.rare, Number.parseInt(p.digest.slice(-4),16) < 3277);
    assert.deepEqual(p, await describeOrb(p.chain, p.address));
  }
  const first = createRevealSession(), anotherDocument = createRevealSession();
  assert.equal(first.claim(null), false);
  assert.equal(first.claim(ordinary.digest), true); assert.equal(first.claim(ordinary.digest), false);
  assert.equal(first.claim(rare.digest), true); assert.equal(first.claim(ordinary.digest), false);
  assert.equal(anotherDocument.claim(ordinary.digest), true);
});
