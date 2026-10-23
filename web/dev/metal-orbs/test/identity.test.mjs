import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { describeOrb, canonicalIdentity, FAMILIES, radiusAt } from '../identity.js';
import { fallbackSvg } from '../fallback.js';
import { FIXTURES } from '../fixtures.js';
test('seed agrees with independent SHA-256 of canonical public tuple', async () => {
  const address = '0xABCDEF0123456789ABCDEF0123456789ABCDEF01';
  const p = await describeOrb(' EIP155:001 ', address);
  assert.equal(p.chain, 'eip155:1'); assert.equal(p.address, address.toLowerCase());
  assert.equal(p.digest, createHash('sha256').update(JSON.stringify(['eip155:1', address.toLowerCase()])).digest('hex'));
  assert.deepEqual(p, await describeOrb('eip155:1', address.toLowerCase()));
  assert.notEqual(p.digest, (await describeOrb('eip155:2', address)).digest);
});
test('Base58 case and chain namespace are part of identity; Bech32 case is canonical', async () => {
  const fixture = FIXTURES[0], p = await describeOrb(fixture.chain, fixture.address);
  assert.equal(p.address, fixture.address);
  assert.notEqual(p.digest, (await describeOrb('solana:testnet', fixture.address)).digest);
  const changed = fixture.address.replace(/[a-h]/, (c) => c.toUpperCase());
  assert.notEqual(p.digest, (await describeOrb(fixture.chain, changed)).digest);
  assert.deepEqual(canonicalIdentity('zcash:testnet', 'UTEST1QQQQ'), canonicalIdentity('zcash:testnet', 'utest1qqqq'));
  assert.throws(() => canonicalIdentity('zcash:testnet', 'utest1QQqq'));
  assert.throws(() => canonicalIdentity('unknown', fixture.address));
  assert.throws(() => canonicalIdentity('eip155:1', '<svg onload=x>'));
});
test('24 public fixtures give distinct seeds, SVGs and geometry in all six families', async () => {
  const ps = await Promise.all(FIXTURES.map((f) => describeOrb(f.chain, f.address)));
  assert.equal(new Set(ps.map((p) => p.digest)).size, 24);
  assert.equal(new Set(ps.map(fallbackSvg)).size, 24);
  assert.equal(new Set(ps.map((p) => p.family)).size, FAMILIES.length);
  const shape = (p) => Array.from({ length: 64 }, (_, i) => {
    const t = i / 64 * Math.PI * 2; return radiusAt(p, Math.cos(t), Math.sin(t), 0).toFixed(6);
  }).join(',');
  assert.equal(new Set(ps.map(shape)).size, 24);
  for (const p of ps) {
    assert.deepEqual(p, await describeOrb(p.chain, p.address));
    assert.equal(fallbackSvg(p), fallbackSvg(await describeOrb(p.chain, p.address)));
    for (let i = 0; i < 80; i++) {
      const y = i / 40 - 1, x = Math.sqrt(1 - y * y), r = radiusAt(p, x, y, 0);
      assert.ok(Number.isFinite(r) && r > .8 && r < 1.2);
    }
  }
});
