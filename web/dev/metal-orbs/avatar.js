import { describeOrb } from './identity.js';
import { fallbackUrl } from './fallback.js';
import { readImage, writeImage } from './cache.js';
export const SIZES = Object.freeze([32, 48, 64, 96]);
export const metrics = { renders: 0, cacheHits: 0, fallbacks: 0, activeContexts: 0 };
const pending = new Map();
let queue = Promise.resolve(), studio, disposeTimer, unavailable = false;
const idle = () => new Promise((resolve) => {
  if ('requestIdleCallback' in globalThis) requestIdleCallback(resolve, { timeout: 120 });
  else setTimeout(resolve, 0);
});
export function releaseStudio() {
  clearTimeout(disposeTimer); studio?.dispose(); studio = null; metrics.activeContexts = 0;
}
async function renderImage(p) {
  await idle();
  if (unavailable) throw new Error('WebGL unavailable');
  clearTimeout(disposeTimer);
  try {
    if (!studio) {
      const { createStudio } = await import('./renderer.js');
      studio = createStudio(); metrics.activeContexts = 1;
    }
    const image = studio.render(p); metrics.renders++;
    return image;
  } catch {
    unavailable = true; releaseStudio(); throw new Error('Using deterministic SVG');
  } finally { if (studio) disposeTimer = setTimeout(releaseStudio, 1200); }
}
export async function imageFor(p, { svgOnly = false } = {}) {
  if (svgOnly) { metrics.fallbacks++; return { src: fallbackUrl(p), mode: 'svg' }; }
  if (pending.has(p.key)) return pending.get(p.key);
  const work = (async () => {
    const cached = await readImage(p.key);
    if (cached) { metrics.cacheHits++; return { src: cached, mode: 'cached' }; }
    const job = queue.then(() => renderImage(p));
    queue = job.catch(() => {});
    try {
      const src = await job; await writeImage(p.key, src); return { src, mode: 'rendered' };
    } catch { metrics.fallbacks++; return { src: fallbackUrl(p), mode: 'svg' }; }
  })();
  pending.set(p.key, work);
  try { return await work; } finally { pending.delete(p.key); }
}

/** Native DOM component for this non-React application. Only public address and chain inputs.
 * Default lazy generation; `ready` resolves when visible work finishes, `dispose` cancels updates.
 */
export function WalletAvatar({ chain, address, size = 48, label = 'Wallet avatar', svgOnly = false, eager = false }) {
  if (!SIZES.includes(size)) throw new RangeError('WalletAvatar size must be 32, 48, 64 or 96');
  const img = document.createElement('img');
  img.width = img.height = size; img.alt = label; img.className = 'wallet-avatar'; img.decoding = 'async';
  img.dataset.state = 'loading';
  // Reserved dimensions and a static placeholder prevent layout shift while SHA-256 resolves.
  img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"%3E%3Ccircle cx="48" cy="48" r="34" fill="%2359626e"/%3E%3C/svg%3E';
  let disposed = false, observer, resolveReady;
  img.ready = new Promise((resolve) => { resolveReady = resolve; });
  img.dispose = () => { disposed = true; observer?.disconnect(); resolveReady(); };
  const descriptor = describeOrb(chain, address);
  descriptor.catch(() => {}); // A lazy image can remain offscreen indefinitely.
  async function start() {
    observer?.disconnect();
    if (disposed) return;
    try {
      const p = await descriptor;
      if (disposed) return;
      const fallback = fallbackUrl(p);
      img.src = fallback;
      img.onerror = () => { img.onerror = null; img.src = fallback; img.dataset.state = 'svg'; };
      const result = await imageFor(p, { svgOnly });
      if (!disposed) { img.src = result.src; img.dataset.state = result.mode; img.dataset.digest = p.digest; }
    } catch { if (!disposed) { img.dataset.state = 'unavailable'; img.alt = `${label} — unavailable`; } }
    finally { resolveReady(); }
  }
  if (!eager && 'IntersectionObserver' in globalThis) {
    observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) start(); }, { rootMargin: '120px' });
    observer.observe(img);
  } else start();
  return img;
}
