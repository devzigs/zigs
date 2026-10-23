// Decorative identity from already-accepted public wallet metadata. Never a security signal.
import { el } from "./app-dom.js";
import { ready, state } from "./app-state.js";
import { describeOrb } from "./wallet-identity.js";
import { fallbackUrl } from "./wallet-avatar-svg.js";

const neutral = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">'
  + '<circle cx="48" cy="48" r="33" fill="#59626e" opacity=".45"/>'
  + '<circle cx="48" cy="48" r="24" fill="none" stroke="#aab1b8" opacity=".5"/></svg>');
// Document-memory only, bounded. Names, balances, keys and device labels never enter the seed.
const images = new Map();
function imageFor(chain, address) {
  const key = JSON.stringify([chain, address]);
  if (!images.has(key)) {
    if (images.size >= 64) images.delete(images.keys().next().value);
    const image = describeOrb(chain, address).then(fallbackUrl);
    images.set(key, image);
    image.catch(() => images.delete(key));
  }
  return images.get(key);
}

/** Reserve geometry immediately. Each async result belongs only to its original image node. */
export function walletAvatarFor(g, size = 32) {
  const image = el("img", { class: "wallet-avatar", width: size, height: size,
    alt: "", "aria-hidden": "true", decoding: "async", src: neutral });
  if (!g) return image;
  const wallet = g.id === state.gid ? state.wallet : ready[g.id];
  if (!wallet?.address || !["mainnet", "testnet"].includes(g.network)) return image;
  imageFor("zcash:" + g.network, wallet.address).then((src) => {
    // Redraws and wallet changes remove old nodes; late work cannot touch the new wallet.
    if (image.isConnected === false) return;
    image.setAttribute("src", src);
  }).catch(() => { /* Keep the neutral identity if public metadata is unavailable. */ });
  return image;
}
