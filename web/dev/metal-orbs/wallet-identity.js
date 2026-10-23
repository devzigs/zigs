// Presentation-only public input. Names, device labels and Solana never enter the seed.
import { describeOrb } from './identity.js';
export async function describeWalletIdentity({ zcash } = {}) {
  if (zcash?.verified !== true || !zcash.address || !['mainnet', 'testnet'].includes(zcash.network)) return null;
  return describeOrb(`zcash:${zcash.network}`, zcash.address);
}

// Animation memory lasts only for this document. It never changes setup readiness or storage.
export function createRevealSession() {
  const revealed = new Set();
  return {
    claim(digest) {
      if (!digest || revealed.has(digest)) return false;
      revealed.add(digest); return true;
    },
    has: (digest) => revealed.has(digest),
  };
}
