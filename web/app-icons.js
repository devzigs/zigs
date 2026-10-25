// Small interface symbols use fixed stroked paths. Asset marks use the official, locally
// bundled artwork; sources and trademark terms are recorded in assets/README.md. No artwork
// comes from a wallet document, a person or a remote request.
const PATHS = Object.freeze({
  home: "M3 10.5 12 3l9 7.5M5 9v12h5v-7h4v7h5V9",
  wallet: "M4 6h15v14H4zM4 6V4h12v2M15 11h6v5h-6zM17 13.5h.01",
  approvals: "M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  activity: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  chat: "M21 11a8 8 0 0 1-8 8H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v4Z",
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM16 16l5 5",
  plus: "M12 5v14M5 12h14",
  security: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  unshield: "m9 4 3-1 8 3v6c0 2-1.5 4-3.3 5.6M14 20.1c-1.2.6-2 .9-2 .9s-8-4-8-9V6l2.6-1M3 3l18 18",
  addressBook: "M5 3h15v18H5zM2 7h4M2 12h4M2 17h4M12 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"
    + "m-3 10v-1a3 3 0 0 1 6 0v1",
  swap: "M3 7h17l-4-4m4 4-4 4M21 17H4l4-4m-4 4 4 4",
  settings: "M4 7h16M4 17h16M9 4v6M15 14v6",
  back: "M15 5l-7 7 7 7M8 12h13",
  send: "M7 17 17 7M7 7h10v10",
  receive: "M17 7 7 17M7 7v10h10",
  key: "M15 4a5 5 0 1 1-3 9l-7 7H2v-3l7-7a5 5 0 0 1 6-6ZM16 8h.01",
  fingerprint: "M8 3a8 8 0 0 1 12 7v3c0 1.4-.1 2.8-.4 4M4 7a8 8 0 0 0-1 4v2"
    + "M6 17c.7-1.2 1-2.6 1-4v-2a5 5 0 0 1 10 0v3c0 2-.4 4-1.1 6"
    + "M12 11a2 2 0 0 0-2 2v2c0 2-1 4-2 5M14 13v2c0 3-1 5-2 7",
  lock: "M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3",
  phone: "M7 2h10v20H7zM10 5h4M12 19h.01",
  laptop: "M4 4h16v12H4zM2 20h20l-2-4H4l-2 4Z",
  browser: "M3 4h18v16H3zM3 9h18M6 6.5h.01M9 6.5h.01",
  devices: "M3 4h14v11H3zM1 19h12M18 10h5v11h-5z",
});
const ASSETS = Object.freeze({
  zec: "/assets/zcash.svg",
  sol: "/assets/solana.svg",
  usdc: "/assets/usdc.svg",
});
const SVG = "http://www.w3.org/2000/svg";
// Larger educational/empty-state objects follow the site's original 64-unit relief language.
// They carry no status: adjacent application text remains authoritative.
const RELIEFS = Object.freeze({
  chat: ["M10 14h37v27H29L17 51V41h-7Z", "M47 24h7v25H40l-9 7v-9",
    "M21 23h15m-15 8h10"],
  devices: ["M10 13h29v22H10zM6 42h31M44 29h13v25H44z", "M15 18h19M49 48h3"],
  addressBook: ["M16 9h36v46H16zM10 19h10M10 32h10M10 45h10",
    "M34 20a6 6 0 1 1 0 12 6 6 0 0 1 0-12ZM24 45v-2a10 10 0 0 1 20 0v2"],
  security: ["M32 8c7 6 14 7 20 8v16c0 13-11 21-20 25-9-4-20-12-20-25V16"
    + "c6-1 13-2 20-8Z", "M32 16c5 4 10 5 13 6v10c0 9-7 15-13 18"
    + "-6-3-13-9-13-18V22c3-1 8-2 13-6Z", "m26 33 4 4 9-11"],
});
let reliefSequence = 0;

function svgNode(tag, attrs) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

/** Fixed decorative artwork, with unique in-document gradient references. */
export function sculptedIcon(name) {
  if (!Object.hasOwn(RELIEFS, name)) throw new Error("app-icons: no relief named " + name);
  const span = document.createElement("span"), id = "ui-relief-" + ++reliefSequence;
  span.className = "symbol symbol-sculpted";
  span.setAttribute("aria-hidden", "true"); span.setAttribute("data-icon", name);
  const svg = svgNode("svg", { viewBox: "0 0 64 64", fill: "none", focusable: "false",
    "stroke-linecap": "round", "stroke-linejoin": "round" });
  const defs = svgNode("defs", {}), gradient = svgNode("linearGradient", {
    id, x1: "0", y1: "0", x2: ".85", y2: "1" });
  ["#fafafa", "#d8d8d8", "#777", "#c4c4c4", "#888"].forEach((color, index) => {
    gradient.append(svgNode("stop", { offset: String(index / 4), "stop-color": color }));
  });
  defs.append(gradient); svg.append(defs);
  const back = svgNode("g", { class: "relief-shadow", stroke: "#050607", "stroke-width": "5",
    transform: "translate(0 1.7)" });
  const face = svgNode("g", { class: "relief-face", stroke: "url(#" + id + ")",
    "stroke-width": "2.8" });
  RELIEFS[name].forEach((path, index) => {
    back.append(symbolPath(path, "relief-part"));
    face.append(symbolPath(path, "relief-part relief-part-" + index));
  });
  svg.append(back, face); span.append(svg);
  return span;
}
// Separate physical details allow small, purposeful gestures without moving the control.
const DETAILS = Object.freeze({
  home: "M3 10.5 12 3l9 7.5", approvals: "m9 12 2 2 4-4", activity: "M12 7v5l3 2",
  chat: "M8 8h8M8 12h5", search: "M16 16l5 5", plus: "M12 5v14",
  security: "m8 12 3 3 5-6", addressBook: "M2 7h4M2 12h4M2 17h4",
  swap: "M3 7h17l-4-4m4 4-4 4", settings: "M9 4v6M15 14v6",
  send: "M7 7h10v10", receive: "M7 7v10h10", lock: "M8 11V8a4 4 0 0 1 8 0v3",
  wallet: "M15 11h6v5h-6z", key: "M16 8h.01", browser: "M3 9h18",
});
const BODIES = Object.freeze({
  home: "M5 9v12h5v-7h4v7h5V9",
  approvals: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  activity: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z",
  plus: "M5 12h14", send: "M7 17 17 7", receive: "M17 7 7 17",
  security: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z",
  settings: "M4 7h16M4 17h16", swap: "M21 17H4l4-4m-4 4 4 4",
  lock: "M5 11h14v10H5z", browser: "M3 4h18v16H3zM6 6.5h.01M9 6.5h.01",
  wallet: "M4 6h15v14H4zM4 6V4h12v2M17 13.5h.01",
  addressBook: "M5 3h15v18H5zM12 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"
    + "m-3 10v-1a3 3 0 0 1 6 0v1",
});

function symbolPath(value, className) {
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", value); path.setAttribute("class", className);
  return path;
}

/** Decorative brand object only; never a device, wallet or security status. */
export function zigsEmblem(size = "hero") {
  const hero = size !== "small";
  const plate = document.createElement("div");
  plate.className = "zigs-emblem zigs-emblem--" + (hero ? "hero welcome-brand-plate" : "small");
  plate.setAttribute("aria-hidden", "true");
  if (hero) {
    plate.setAttribute("data-motion", "brand");
    plate.setAttribute("data-welcome-brand", "");
  }
  const face = document.createElement("div");
  face.className = "zigs-emblem-face";
  const image = document.createElement("img");
  image.className = "zigs-emblem-logo" + (hero ? " welcome-brand-logo" : "");
  const attrs = { src: "/logo.png?v=fingerprint-17dbdecb64d0", alt: "", width: "160", height: "160",
    draggable: "false" };
  for (const [key, value] of Object.entries(attrs)) image.setAttribute(key, value);
  face.append(image);
  plate.append(face);
  return plate;
}

function artwork(name) {
  const image = document.createElementNS(SVG, "image");
  image.setAttribute("href", ASSETS[name]);
  image.setAttribute("width", "24");
  image.setAttribute("height", "24");
  return image;
}

/**
 * A decorative symbol: a span with an inline SVG, hidden from screen readers. The text next to
 * it carries the meaning.
 * @param {string} name An interface symbol or asset mark; an unknown name throws.
 * @returns {HTMLSpanElement}
 */
export function icon(name) {
  const asset = Object.hasOwn(ASSETS, name);
  if (!asset && !Object.hasOwn(PATHS, name)) {
    throw new Error("app-icons: no symbol named " + name);
  }
  const span = document.createElement("span");
  span.className = "symbol";
  span.setAttribute("data-icon", name);
  span.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(SVG, "svg");
  const attrs = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round",
    focusable: "false" };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  if (asset) svg.append(artwork(name));
  else {
    svg.append(symbolPath(PATHS[name], "icon-relief"),
      symbolPath(BODIES[name] || PATHS[name], "icon-body"));
    if (DETAILS[name]) svg.append(symbolPath(DETAILS[name], "icon-detail"));
  }
  span.append(svg);
  return span;
}
