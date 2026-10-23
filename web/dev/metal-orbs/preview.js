import { describeOrb, FAMILIES, FINISHES } from './identity.js';
import { WalletAvatar, metrics, releaseStudio } from './avatar.js';
import { fallbackSvg } from './fallback.js';
import { FIXTURES } from './fixtures.js';
const $ = (id) => document.getElementById(id);
const text = (tag, value, cls) => { const n = document.createElement(tag); n.textContent = value; if (cls) n.className = cls; return n; };
const descriptors = await Promise.all(FIXTURES.map((f) => describeOrb(f.chain, f.address)));
let svgOnly = false, components = [], inspectionComponents = [];
const short = (s) => `${s.slice(0, 8)}…${s.slice(-6)}`;
const makeAvatar = (p, size, eager = false) => {
  const img = WalletAvatar({ ...p, size, svgOnly, eager, label: `${FAMILIES[p.family]} wallet orb, ${size} pixels` });
  components.push(img); return img;
};
function inspect(p) {
  inspectionComponents.forEach((img) => img.dispose()); inspectionComponents = [];
  $('chain').value = p.chain; $('address').value = p.address;
  const avatar = makeAvatar(p, 96, true); inspectionComponents.push(avatar);
  const details = document.createElement('div'); details.className = 'details';
  details.append(text('p', `${FAMILIES[p.family]} / ${FINISHES[p.finish]}`), text('code', p.address),
    text('p', `${p.chain} · SHA-256`), text('code', p.digest),
    p.traits.rare ? text('p', 'Ember inlay · Rare finish · approximately 5% of generated identities') : text('p', `${p.traits.sculpture} · ${p.traits.metal}`));
  $('inspection').replaceChildren(avatar, details);
}
function draw() {
  components.forEach((img) => img.dispose()); components = [];
  const featured = [0, 1, 4].map((family) => descriptors.find((p) => p.family === family) ?? descriptors[family]);
  $('hero').replaceChildren(...featured.map((p) => makeAvatar(p, 96, true)));
  const cards = descriptors.map((p, i) => {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'orb-card';
    card.setAttribute('aria-label', `Inspect fixture ${i + 1}: ${FAMILIES[p.family]}, ${p.address}`);
    const top = text('div', '', 'card-top'); top.append(text('span', `NO. ${String(i + 1).padStart(2, '0')}`), text('span', FAMILIES[p.family].toUpperCase()));
    const sizes = text('div', '', 'size-row');
    for (const size of [96, 64, 48, 32]) {
      const figure = document.createElement('figure'); figure.append(makeAvatar(p, size), text('figcaption', `${size}`)); sizes.append(figure);
    }
    card.append(top, sizes, text('p', FINISHES[p.finish], 'card-name'), text('code', short(p.address), 'card-address'));
    card.addEventListener('click', () => { inspect(p); $('inspection').scrollIntoView({ behavior: 'instant', block: 'center' }); });
    return card;
  });
  $('gallery').replaceChildren(...cards);
  inspect(descriptors[0]);
  $('status').textContent = svgOnly ? 'SVG comparison · same seeds / no WebGL rendering' : 'Static PNGs · generated on visibility / cached in this browser';
}
$('svg-toggle').addEventListener('click', () => {
  svgOnly = !svgOnly; $('svg-toggle').setAttribute('aria-pressed', String(svgOnly));
  $('svg-toggle').textContent = svgOnly ? 'Return to metal renders' : 'Compare SVG fallback'; draw();
});
$('identity-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('input-error').textContent = '';
  try { inspect(await describeOrb($('chain').value, $('address').value)); }
  catch (error) { $('input-error').textContent = error.message; }
});
$('repeat').addEventListener('click', async () => {
  const button = $('repeat'); button.disabled = true;
  $('status').textContent = 'Checking two fresh studio renders for all 24 identities…';
  let studio;
  try {
    releaseStudio();
    const { createStudio } = await import('./renderer.js');
    const first = [], second = [];
    for (const output of [first, second]) {
      studio = createStudio();
      for (const p of descriptors) {
        await new Promise((resolve) => setTimeout(resolve, 0)); output.push(studio.render(p));
      }
      studio.dispose(); studio = null;
    }
    const matches = first.filter((value, i) => value === second[i]).length;
    const svgMatches = descriptors.filter((p) => fallbackSvg(p) === fallbackSvg(p)).length;
    $('status').textContent = `${matches}/24 fresh PNG repeats · ${svgMatches}/24 SVG repeats · ${new Set(first).size} unique images. Cross-GPU pixel identity is not guaranteed.`;
  } catch {
    $('status').textContent = `WebGL unavailable · ${descriptors.length}/24 deterministic SVG identities available.`;
  } finally { studio?.dispose(); button.disabled = false; }
});
// Preview-only inspection surface for browser QA. No app or wallet state is referenced.
window.orbPreview = { descriptors, metrics, FIXTURES };
draw();
