// Public display inputs only. No wallet, key, authentication or protocol imports.
const entries = new Map(), LIMIT = 96;
const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"%3E%3Ccircle cx="48" cy="48" r="32" fill="%2359626e"/%3E%3C/svg%3E';
export function walletArtEntry(facts) {
  const { address, network, verified } = facts || {};
  if (verified !== true || typeof address !== "string" || !address
    || !["mainnet", "testnet"].includes(network)) return null;
  const key = JSON.stringify([network, address]);
  if (entries.has(key)) return entries.get(key);
  const entry = { descriptor: null, src: PLACEHOLDER, mode: "loading", listeners: new Set() };
  const notify = () => entry.listeners.forEach((update) => update());
  entry.ready = (async () => {
    try {
      const [{ describeWalletIdentity }, { fallbackUrl }] = await Promise.all([
        import("./dev/metal-orbs/wallet-identity.js"), import("./dev/metal-orbs/fallback.js"),
      ]);
      entry.descriptor = await describeWalletIdentity({ zcash: { address, network, verified } });
      if (!entry.descriptor) throw new Error("No display identity");
      entry.fallback = fallbackUrl(entry.descriptor);
      entry.src = entry.fallback; entry.mode = "svg"; notify();
    } catch { entry.mode = entry.descriptor ? "svg" : "unavailable"; }
    notify(); return entry;
  })();
  entry.load = () => entry.rendered ??= (async () => {
    await entry.ready;
    try {
      if (entry.descriptor) {
        const { imageFor } = await import("./dev/metal-orbs/avatar.js");
        const result = await imageFor(entry.descriptor);
        entry.src = result.src; entry.mode = result.mode;
      }
    } catch { /* The deterministic SVG remains usable if rendering cannot load. */ }
    notify(); entry.listeners.clear(); return entry;
  })();
  entries.set(key, entry);
  while (entries.size > LIMIT) entries.delete(entries.keys().next().value);
  return entry;
}

/** A reserved image box; slow or unavailable artwork never delays its surrounding controls. */
export function walletArtImage(facts, { size = 48, label = "" } = {}) {
  if (![32, 48, 64, 96].includes(size)) throw new RangeError("Unsupported wallet artwork size");
  const img = document.createElement("img"), entry = walletArtEntry(facts);
  const display = entry || { src: PLACEHOLDER, mode: "unavailable" };
  img.className = "wallet-art"; img.width = img.height = size; img.alt = label;
  img.decoding = "async"; img.src = display.src;
  img.setAttribute("data-art-state", display.mode);
  if (!label) img.setAttribute("aria-hidden", "true");
  const update = () => {
    if (!img.isConnected) return;
    img.src = entry.src; img.setAttribute("data-art-state", entry.mode);
    if (entry.descriptor) img.setAttribute("data-art-digest", entry.descriptor.digest);
  };
  if (entry) attachImage(entry, img, update);
  return img;
}

function attachImage(entry, img, update) {
  if (entry.descriptor) img.setAttribute("data-art-digest", entry.descriptor.digest);
  entry.listeners.add(update);
  entry.ready.then(async () => {
    if (img.isConnected) { update(); await entry.load(); update(); }
    entry.listeners.delete(update);
  });
  img.onerror = () => {
    img.onerror = null; img.src = entry.fallback || PLACEHOLDER;
    img.setAttribute("data-art-state", entry.fallback ? "svg" : "unavailable");
  };
}
