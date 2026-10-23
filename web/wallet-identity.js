// Public display identity only. Never import wallet, signing, vault or protocol modules here.
export const VERSION = "metal-orb-v3";
export const FAMILIES = ["Faceted", "Fluted", "Hammered", "Folded", "Orbital", "Scalloped"];
export const FINISHES = ["Polished chrome", "Dark titanium", "Brushed silver"];
export const ACCENTS = ["#e78b50", "#cbae91", "#93acb7", "#b6b0c8", "#d6d9da"];
export const RARE_THRESHOLD = 3277;
export const isRareDigest = (bytes) => bytes[30] * 256 + bytes[31] < RARE_THRESHOLD;

function evmAddress(address) {
  if (!/^0x[0-9a-f]{40}$/i.test(address)) throw new TypeError("Expected a public EVM address");
  return address.toLowerCase();
}
function solanaAddress(address) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
    throw new TypeError("Expected a public Solana address");
  return address; // Base58 is case-sensitive. Display normalization, not protocol validation.
}
function zcashAddress(address) {
  if (address.length > 2048 || !/^[a-zA-Z0-9]+$/.test(address))
    throw new TypeError("Expected a public Zcash address");
  if (!/^(u1|utest1|zs1|ztestsapling1)/i.test(address)) return address;
  if (address !== address.toLowerCase() && address !== address.toUpperCase())
    throw new TypeError("Mixed-case Bech32 address");
  return address.toLowerCase();
}
function normalizedIdentity(chain, address) {
  if (/^eip155:[0-9]+$/.test(chain))
    return { chain: `eip155:${BigInt(chain.slice(7))}`, address: evmAddress(address) };
  if (/^solana:(mainnet-beta|devnet|testnet)$/.test(chain))
    return { chain, address: solanaAddress(address) };
  if (/^zcash:(mainnet|testnet)$/.test(chain)) return { chain, address: zcashAddress(address) };
  throw new TypeError("Unsupported display chain identifier");
}
export function canonicalIdentity(chain, address) {
  if (typeof chain !== "string" || typeof address !== "string")
    throw new TypeError("Public chain and address required");
  const identity = normalizedIdentity(chain.trim().toLowerCase(), address.trim());
  return { ...identity, input: JSON.stringify([identity.chain, identity.address]) };
}
export async function describeOrb(chain, address) {
  const identity = canonicalIdentity(chain, address);
  const bytes = new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(identity.input)));
  return descriptorFromDigest(identity, bytes);
}
export function descriptorFromDigest(identity, bytes) {
  const digest = Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
  const unit = (i) => bytes[i] / 255;
  const family = bytes[0] % 6, finish = bytes[1] % 3, rare = isRareDigest(bytes);
  const traits = Object.freeze({ sculpture: FAMILIES[family], metal: FINISHES[finish],
    rare, inlay: rare ? "Ember inlay" : null });
  return Object.freeze({ ...identity, digest, key: `${VERSION}:${digest}`, family: bytes[0] % 6,
    finish, traits, accent: ACCENTS[bytes[2] % ACCENTS.length], lobes: 4 + bytes[3] % 8,
    amplitude: .045 + unit(4) * .105, phase: unit(5) * Math.PI * 2, twist: 1 + bytes[6] % 4,
    tilt: (unit(7) - .5) * 1.3, rotation: unit(8) * Math.PI * 2, roughness: .17 + unit(9) * .15,
    rings: 1 + bytes[10] % 3, facetDetail: 1 + bytes[11] % 2, squash: .91 + unit(12) * .16,
    frequency: 3 + bytes[13] % 5, seam: unit(14) * 2 - 1 });
}
// Two closed, seeded inlay paths, shared by the PNG surface ribbons and SVG projection.
export function emberDirection(p, t, band) {
  const x = Math.sin(t), y = .26 * Math.sin(2 * t + p.phase) + band * .10, z = Math.cos(t);
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}
export function radiusAt(p, x, y, z) {
  const longitude = Math.atan2(z, x), latitude = Math.acos(Math.max(-1, Math.min(1, y)));
  const belt = Math.sin(latitude), wave = Math.cos(p.lobes * longitude + p.twist * y + p.phase);
  const a = p.amplitude, density = p.lobes + 2;
  switch (p.family) {
    case 0: return 1 + a * .35 * Math.sin(p.frequency * x + p.phase)
      * Math.cos(p.frequency * z);
    case 1: return 1 + a * wave * belt * belt;
    case 2: return 1 + a * .65 * Math.sin(density * x + p.phase)
      * Math.sin(density * .85 * y + 2) * Math.sin(density * 1.1 * z + p.phase * .7);
    case 3: return 1 + a * Math.sin(p.lobes * latitude + p.twist * longitude + p.phase) * belt;
    case 4: return 1 + a * .45 * Math.cos((y + .25 * Math.sin(longitude * 2)) * p.lobes * 3);
    default: return 1 + a * Math.cos(p.lobes * longitude + p.phase)
      * Math.sin(latitude * 3) * belt;
  }
}
