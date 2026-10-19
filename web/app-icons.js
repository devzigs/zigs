// Small interface symbols: one stroked path each, drawn in the text colour. The paths are fixed
// here; the page never draws an SVG that comes from a document or a person.
const PATHS = Object.freeze({
  home: "M3 10.5 12 3l9 7.5M5 9v12h5v-7h4v7h5V9",
  approvals: "M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  activity: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  chat: "M21 11a8 8 0 0 1-8 8H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v4Z",
  security: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  settings: "M4 7h16M4 17h16M9 4v6M15 14v6",
  back: "M15 5l-7 7 7 7M8 12h13",
  send: "M7 17 17 7M7 7h10v10",
  receive: "M17 7 7 17M7 7v10h10",
  key: "M15 4a5 5 0 1 1-3 9l-7 7H2v-3l7-7a5 5 0 0 1 6-6ZM16 8h.01",
  lock: "M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3",
  phone: "M7 2h10v20H7zM10 5h4M12 19h.01",
  devices: "M3 4h14v11H3zM1 19h12M18 10h5v11h-5z",
  zec: "M7 6h10L7 18h10M12 3v3m0 12v3",
  // ◎, the sign that wallets write before SOL amounts; it draws no part of the Solana mark.
  sol: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
});
const SVG = "http://www.w3.org/2000/svg";

/**
 * A decorative symbol: a span with an inline SVG, hidden from screen readers. The text next to
 * it carries the meaning.
 * @param {string} name A key of PATHS; an unknown name throws.
 * @returns {HTMLSpanElement}
 */
export function icon(name) {
  if (!Object.hasOwn(PATHS, name)) throw new Error("app-icons: no symbol named " + name);
  const span = document.createElement("span");
  span.className = "symbol";
  span.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(SVG, "svg");
  const attrs = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round",
    focusable: "false" };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", PATHS[name]);
  svg.append(path);
  span.append(svg);
  return span;
}
