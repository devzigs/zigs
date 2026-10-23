// Deterministic SVG projection shared with the metallic-orb preview. No renderer or storage.
import { radiusAt, emberDirection } from "./wallet-identity.js";
const n = (v) => v.toFixed(3);

function outline(p) {
  return Array.from({ length: 96 }, (_, i) => {
    const t = i / 96 * Math.PI * 2, x = Math.cos(t), y = Math.sin(t);
    const r = radiusAt(p, x, y, 0) * 36;
    return `${i ? "L" : "M"}${n(48 + x * r)} ${n(47 + y * r * p.squash)}`;
  }).join(" ") + "Z";
}

function facets(p) {
  let pattern = "";
  for (let i = 0; i < 10; i++) {
    const t = i * Math.PI / 5 + p.phase, t2 = t + .65;
    pattern += `<path d="M48 46L${n(48 + 43 * Math.cos(t))} ${n(47 + 43 * Math.sin(t))}`
      + `L${n(48 + 43 * Math.cos(t2))} ${n(47 + 43 * Math.sin(t2))}Z" `
      + `fill="${i % 2 ? "#f6f3ee" : "#101820"}" opacity="${i % 2 ? ".24" : ".29"}"/>`;
  }
  return pattern;
}

function hammering(p) {
  let pattern = "";
  for (let row = 0; row < 9; row++) for (let col = 0; col < 8; col++) {
    const x = 14 + col * 10 + (row % 2) * 5, y = 10 + row * 9;
    pattern += `<circle cx="${x}" cy="${y}" r="${n(2.2 + Math.sin(row * col + p.phase))}" `
      + 'fill="#121923" opacity=".3"/>'
      + `<circle cx="${x - .7}" cy="${y - .8}" r="1.3" fill="#fff" opacity=".35"/>`;
  }
  return pattern;
}

function ribbons(p) {
  let pattern = "";
  for (let i = 0; i < p.lobes; i++) {
    const x = 4 + i * 88 / p.lobes;
    const path = p.family === 4 ? `M0 ${x} Q48 ${x + 28} 96 ${x - 8}`
      : `M${x} 3 C${x - 25} 25 ${x + 35 + p.twist * 2} 60 ${x} 94`;
    pattern += `<path d="${path}" fill="none" stroke="#0c141c" `
      + `stroke-width="${p.family === 3 ? 5 : 2}" opacity=".55"/>`
      + `<path d="${path}" fill="none" stroke="#f1f3f4" stroke-width=".7" opacity=".6"/>`;
  }
  return pattern;
}

function inlay(p) {
  let result = "";
  for (const band of [-1, 1]) {
    const path = Array.from({ length: 97 }, (_, i) => {
      const [x, y, z] = emberDirection(p, -Math.PI / 2 + i / 96 * Math.PI, band);
      const r = radiusAt(p, x, y, z) * 36;
      return `${i ? "L" : "M"}${n(48 + x * r)} ${n(47 - y * r * p.squash)}`;
    }).join(" ");
    result += `<path data-finish="ember-inlay" d="${path}" fill="none" `
      + 'stroke="#ed9554" stroke-width="1.1"/>';
  }
  return result;
}

export function fallbackSvg(p) {
  const points = outline(p), base = ["#aab1b8", "#4c555f", "#cad0d4"][p.finish];
  const pattern = p.family === 0 ? facets(p) : p.family === 2 ? hammering(p) : ribbons(p);
  const accent = p.traits.rare ? inlay(p)
    : `<path d="M14 69Q48 88 84 55" fill="none" stroke="${p.accent}" `
      + 'stroke-width="2.2" opacity=".8"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs>'
    + '<radialGradient id="m" cx="32%" cy="24%" r="78%"><stop stop-color="#fbf8f3"/>'
    + `<stop offset=".22" stop-color="${base}"/><stop offset=".43" stop-color="#2a333d"/>`
    + `<stop offset=".56" stop-color="${base}"/><stop offset=".72" stop-color="#535b65"/>`
    + '<stop offset="1" stop-color="#10161e"/></radialGradient>'
    + `<clipPath id="c"><path d="${points}"/></clipPath></defs>`
    + '<ellipse cx="48" cy="86" rx="26" ry="3" fill="#000" opacity=".25"/>'
    + `<path d="${points}" fill="url(#m)"/><g clip-path="url(#c)" `
    + `transform="rotate(${n(p.tilt * 35)},48,47)">${pattern}${accent}</g>`
    + `<path d="${points}" fill="none" stroke="#dce2e8" stroke-opacity=".25" `
    + 'stroke-width=".5"/></svg>';
}
export const fallbackUrl = (p) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fallbackSvg(p))}`;
