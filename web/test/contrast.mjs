// The colour tokens of web/design-system.css: every text colour reads at 4.5:1 or more (WCAG AA
// for normal text) on every surface, the edge of a field or a tick box at 3:1 or more (WCAG
// 1.4.11), in the dark and in the light palette, and the two copies of the light palette stay the
// same. Translucent colours are put over the surface below them.
// Run: node web/test/contrast.mjs   (Node 24)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../design-system.css", import.meta.url), "utf8");
const MIN = 4.5, MIN_EDGE = 3;
const TEXTS = ["text", "muted", "faint", "accent-text", "ok", "bad", "info", "warning"];
const SOFT = { ok: "ok-soft", bad: "bad-soft", info: "info-soft", warning: "warning-soft",
  "accent-text": "accent-soft" };

// The declarations of the first rule whose selector is `selector`, as name to value.
function tokens(selector) {
  const at = css.indexOf(selector + " {");
  assert.ok(at >= 0, "design-system.css has a rule " + selector);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/([\w-]+):\s*([^;]+);/g)]
    .map((m) => [m[1].replace(/^--/, ""), m[2].trim()]));
}

// [r, g, b, alpha] of a #rgb, #rrggbb or rgba() value.
function rgba(value) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(value);
  assert.ok(fn, "a colour token is #hex or rgba(): " + value);
  const [r, g, b, a = 1] = fn[1].split(",").map(Number);
  return [r, g, b, a];
}

const over = (top, base) => top.slice(0, 3).map((c, i) => c * top[3] + base[i] * (1 - top[3]));
const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) =>
  0.2126 * linear(r / 255) + 0.7152 * linear(g / 255) + 0.0722 * linear(b / 255);
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Every [label, ratio] pair of one palette.
function pairs(t) {
  const bg = rgba(t.bg).slice(0, 3);
  const panel = over(rgba(t.panel), bg);
  const surfaces = { bg, panel };
  for (const s of ["side", "raised", "sunk", "sheet"]) surfaces[s] = over(rgba(t[s]), bg);
  const out = [];
  for (const text of TEXTS) {
    for (const [s, under] of Object.entries(surfaces)) {
      out.push([text + " on " + s, ratio(rgba(t[text]), under)]);
    }
  }
  for (const [text, soft] of Object.entries(SOFT)) {
    out.push([text + " on " + soft, ratio(rgba(t[text]), over(rgba(t[soft]), panel))]);
  }
  out.push(["on-accent on accent", ratio(rgba(t["on-accent"]), rgba(t.accent))]);
  return out;
}

// The edge of a field or a tick box on the surfaces that hold them.
function edges(t) {
  const bg = rgba(t.bg).slice(0, 3);
  return ["sunk", "panel", "raised", "sheet"].map((s) =>
    ["line-field on " + s, ratio(rgba(t["line-field"]), over(rgba(t[s]), bg))]);
}

const dark = tokens(":root");
const light = tokens(':root[data-theme="light"]');
assert.deepEqual(tokens(':root:not([data-theme="dark"])'), light,
  "the light palette of the device setting is the same as the light palette of the choice");
const below = (list, min) =>
  list.filter(([, r]) => r < min).map(([k, r]) => k + " " + r.toFixed(2));
for (const [name, palette] of [["dark", dark], ["light", { ...dark, ...light }]]) {
  assert.deepEqual(below(pairs(palette), MIN), [],
    name + ": every text colour reads at " + MIN + ":1 or more");
  assert.deepEqual(below(edges(palette), MIN_EDGE), [],
    name + ": the edge of a field shows at " + MIN_EDGE + ":1 or more");
  console.log("ok  " + name + ": " + pairs(palette).length + " text pairs, 4 field edges");
}
console.log("contrast: ok");
