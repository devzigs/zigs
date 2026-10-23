// Read existing local verification facts. Artwork never grants wallet readiness.
import { ready, state } from "./app-state.js";
import { myVerified } from "./app-dkg.js";
import { mySeatSecrets } from "./app-keystore.js";
import { walletArtImage } from "./wallet-art.js";
import { walletMarble } from "./wallet-marble.js";

export function walletMarbleFacts(g = state.g) {
  if (!g || g.unreadable || g.networkMoved) return null;
  const w = g.id === state.gid ? state.wallet : ready[g.id];
  if (!w?.address || !w.birthday || w.network !== (g.network || "testnet")) return null;
  const verified = g.id === state.gid ? myVerified() : mySeatSecrets(g.id).some(([, s]) =>
    s.checkedWallet === JSON.stringify(w));
  return verified ? { address: w.address, network: w.network, verified: true } : null;
}

export const marbleWalletMark = (g = state.g, size = 48) =>
  walletArtImage(walletMarbleFacts(g), { size });
export const walletHeadingMarble = (g = state.g) => walletMarble(walletMarbleFacts(g));
