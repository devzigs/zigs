// QR code encoder: byte mode, error correction level M, versions 1-20 (up to 666 bytes).
// Enough for addresses and invite links, with no third-party code. Checked against libqrencode
// by web/test/qr.mjs.

// Per version: [data codewords per block, blocks] for group 1 and group 2, and EC codewords per block.
const BLOCKS = [null,
  [16, 1, 0, 0, 10], [28, 1, 0, 0, 16], [44, 1, 0, 0, 26], [32, 2, 0, 0, 18], [43, 2, 0, 0, 24],
  [27, 4, 0, 0, 16], [31, 4, 0, 0, 18], [38, 2, 39, 2, 22], [36, 3, 37, 2, 22], [43, 4, 44, 1, 26],
  [50, 1, 51, 4, 30], [36, 6, 37, 2, 22], [37, 8, 38, 1, 22], [40, 4, 41, 5, 24], [41, 5, 42, 5, 24],
  [45, 7, 46, 3, 28], [46, 10, 47, 1, 28], [43, 9, 44, 4, 26], [44, 3, 45, 11, 26], [41, 3, 42, 13, 26],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46],
  [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
  [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90]];

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x = (x << 1) ^ (x & 0x80 ? 0x11d : 0); }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0;

function rsRemainder(data, ecLen) {
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    gen.forEach((g, j) => { next[j] ^= g; next[j + 1] ^= mul(g, EXP[i]); });
    gen = next;
  }
  const rem = new Array(ecLen).fill(0);
  for (const d of data) {
    const f = d ^ rem.shift(); rem.push(0);
    for (let j = 0; j < ecLen; j++) rem[j] ^= mul(gen[j + 1], f);
  }
  return rem;
}

const dataCapacity = (v) => { const [a, na, b, nb] = BLOCKS[v]; return a * na + b * nb; };

function codewords(bytes) {
  let v = 1;
  const bitsFor = (ver) => 4 + (ver < 10 ? 8 : 16) + 8 * bytes.length;
  while (v <= 20 && bitsFor(v) > dataCapacity(v) * 8) v++;
  if (v > 20) throw new Error("Text is too long for a QR code.");
  const cap = dataCapacity(v) * 8, bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
  for (let pad = 0xec; data.length < cap / 8; pad ^= 0xec ^ 0x11) data.push(pad);
  const [a, na, b, nb, ec] = BLOCKS[v], blocks = [];
  let at = 0;
  for (const [len, count] of [[a, na], [b, nb]]) for (let i = 0; i < count; i++) { blocks.push(data.slice(at, at + len)); at += len; }
  const ecs = blocks.map((blk) => rsRemainder(blk, ec)), out = [];
  for (let i = 0; i < b || i < a; i++) for (const blk of blocks) if (i < blk.length) out.push(blk[i]);
  for (let i = 0; i < ec; i++) for (const e of ecs) out.push(e[i]);
  return { v, out };
}

function bch(value, poly, polyBits) {
  let r = value << (polyBits - 1);
  for (let i = 31 - Math.clz32(r); i >= polyBits - 1; i = 31 - Math.clz32(r)) r ^= poly << (i - (polyBits - 1));
  return r;
}

// Function patterns: finders, separators, timing, alignment, dark module, reserved info areas.
function baseGrid(v) {
  const n = 17 + 4 * v, m = Array.from({ length: n }, () => new Array(n).fill(null));
  const set = (r, c, dark) => { if (r >= 0 && c >= 0 && r < n && c < n) m[r][c] = dark; };
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      set(r0 + r, c0 + c, ring !== 2 && ring !== 4 && r >= 0 && r <= 6 && c >= 0 && c <= 6);
    }
  }
  for (let i = 8; i < n - 8; i++) { m[6][i] = i % 2 === 0; m[i][6] = i % 2 === 0; }
  const al = ALIGN[v], last = al[al.length - 1];
  for (const r of al) for (const c of al) {
    const corner = (r === 6 && c === 6) || (r === 6 && c === last) || (r === last && c === 6);
    if (corner) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) m[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
  }
  for (let i = 0; i < 9; i++) { if (m[8][i] === null) m[8][i] = false; if (m[i][8] === null) m[i][8] = false; }
  for (let i = 0; i < 8; i++) { m[8][n - 1 - i] = false; m[n - 1 - i][8] = false; }
  m[n - 8][8] = true;
  if (v >= 7) {
    const info = (v << 12) | bch(v, 0x1f25, 13);
    for (let i = 0; i < 18; i++) {
      const bit = ((info >> i) & 1) === 1, a = Math.floor(i / 3), b = n - 11 + (i % 3);
      m[a][b] = bit; m[b][a] = bit;
    }
  }
  return m;
}

const MASKS = [
  (i, j) => (i + j) % 2 === 0, (i) => i % 2 === 0, (i, j) => j % 3 === 0, (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0, (i, j) => (i * j) % 2 + (i * j) % 3 === 0,
  (i, j) => ((i * j) % 2 + (i * j) % 3) % 2 === 0, (i, j) => ((i + j) % 2 + (i * j) % 3) % 2 === 0,
];

function place(v, cw, mask) {
  const m = baseGrid(v), n = m.length, fixed = m.map((row) => row.map((x) => x !== null));
  let k = 0;
  for (let right = n - 1, up = true; right > 0; right -= 2, up = !up) {
    if (right === 6) right = 5;
    for (let t = 0; t < n; t++) {
      const r = up ? n - 1 - t : t;
      for (const c of [right, right - 1]) {
        if (fixed[r][c]) continue;
        const bit = k < cw.length * 8 && ((cw[k >> 3] >> (7 - (k & 7))) & 1) === 1;
        k++;
        m[r][c] = bit !== MASKS[mask](r, c);
      }
    }
  }
  const fmt = bch(mask, 0x537, 11) | (mask << 10), bits = fmt ^ 0x5412;
  for (let i = 0; i < 15; i++) {
    const bit = ((bits >> i) & 1) === 1;
    if (i < 6) m[i][8] = bit; else if (i < 8) m[i + 1][8] = bit; else m[n - 15 + i][8] = bit;
    if (i < 8) m[8][n - 1 - i] = bit; else if (i < 9) m[8][15 - i] = bit; else m[8][14 - i] = bit;
  }
  return m;
}

function penalty(m) {
  const n = m.length;
  let p = 0;
  const lines = [...m, ...m[0].map((_, c) => m.map((row) => row[c]))];
  for (const line of lines) {
    for (let i = 0, run = 1; i < n; i++, run++) {
      if (i === n - 1 || line[i] !== line[i + 1]) { if (run >= 5) p += run - 2; run = 0; }
    }
    const s = line.map((x) => (x ? "1" : "0")).join("");
    for (const pat of ["10111010000", "00001011101"]) for (let i = s.indexOf(pat); i >= 0; i = s.indexOf(pat, i + 1)) p += 40;
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const x = m[r][c];
    if (x === m[r][c + 1] && x === m[r + 1][c] && x === m[r + 1][c + 1]) p += 3;
  }
  const dark = m.flat().filter(Boolean).length;
  p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}

/** Returns the module matrix (true = dark) for `text`; `mask` forces a mask pattern 0-7. */
export function qrMatrix(text, mask = null) {
  const { v, out } = codewords(new TextEncoder().encode(text));
  if (mask !== null) return place(v, out, mask);
  let best = null, bestP = Infinity;
  for (let k = 0; k < 8; k++) { const m = place(v, out, k), p = penalty(m); if (p < bestP) { best = m; bestP = p; } }
  return best;
}

/** Returns an SVG string of the QR code with a 4-module quiet zone. */
export function qrSvg(text, label = "QR code") {
  const m = qrMatrix(text), n = m.length + 8;
  let d = "";
  m.forEach((row, r) => row.forEach((x, c) => { if (x) d += "M" + (c + 4) + " " + (r + 4) + "h1v1h-1z"; }));
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + " " + n + '" role="img" aria-label="' + label.replace(/"/g, "") + '" shape-rendering="crispEdges">'
    + '<rect width="' + n + '" height="' + n + '" fill="#fff"/><path fill="#000" d="' + d + '"/></svg>';
}
