// The move tool of the app.js split (APPJS-SPLIT.md 4.2). Usage:
//   node solspike/split/move.mjs <module>   move the statements of <module> from the rest into
//                                           web/app-<module>.js, then --relink
//   node solspike/split/move.mjs --relink   write the imports and exports of every page file
//   node solspike/split/move.mjs --exports  step C1: add `export` for the names that the HOOKS of
//                                           app.mjs and sol-rig.mjs use; imports stay as they are
// It changes no statement text. It cuts whole chunks in their order, drops the section banner
// lines above the chunks that move, sets the word `export` on the statements that another file
// or a test uses, and writes each import block from the facts. Run table and steps first.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BANNER, chunkText, ENTRY, fail, fileOf, HEADING, importLine, loadPage, moduleOfFile, ORDER,
  pageFiles, parse, placement, PURE, readTable, REST, ROOT, testNames, usesOf, WEB, withInternals,
} from "./lib.mjs";
import { declaredNames, refsOf } from "./refs.mjs";

withInternals();

// The page names that the HOOKS text of the old test loaders uses (before step C2).
function hookNames(page) {
  const out = new Set();
  for (const test of ["web/test/app.mjs", "web/test/sol-rig.mjs"]) {
    const src = readFileSync(join(ROOT, test), "utf8");
    const m = /const HOOKS = `([\s\S]*?)`;/.exec(src);
    if (!m) continue;
    for (const node of parse(m[1]).body) {
      const r = refsOf(node.declaration ?? node, page.top);
      [...r.calls, ...r.reads, ...r.writes, ...r.muts].forEach((n) => out.add(n));
    }
  }
  return out;
}

// For every file: the names it takes from each source, and the names that other files use.
function links(page) {
  const fileOfName = new Map();
  for (const it of page.items) for (const n of it.names) fileOfName.set(n, it.chunk.file);
  const needs = new Map(page.files.map((f) => [f.file, new Map()]));
  const crossUsed = new Set();
  const add = (file, source, spec) => {
    const m = needs.get(file);
    if (!m.has(source)) m.set(source, new Set());
    m.get(source).add(spec);
  };
  const link = (it, n) => {
    const file = it.chunk.file, pure = page.pure.get(n), home = fileOfName.get(n);
    const spec = pure && (pure.imported === n ? n : `${pure.imported} as ${n}`);
    if (pure) return add(file, `${pure.source}.js`, spec);
    if (!home || home === file) return;
    if (it.writes.includes(n)) fail(`${n} of ${home} is assigned in ${file}: add a seam first`);
    add(file, home, n);
    crossUsed.add(n);
  };
  for (const it of page.items) new Set(usesOf(it)).forEach((n) => link(it, n));
  return { needs, crossUsed };
}

const SOURCES = [...PURE.map((p) => `${p}.js`), ...ORDER.map(fileOf), REST];

function importBlock(file, needs, present) {
  const lines = [];
  if (file === ENTRY) {
    for (const src of SOURCES.filter((s) => present.has(s))) lines.push(`import "./${src}";`);
  }
  for (const src of SOURCES.filter((s) => needs.has(s))) {
    lines.push(...importLine(needs.get(src), `./${src}`));
  }
  return lines;
}

function render(f, imports, exportOf) {
  const out = [...f.header, ...imports];
  if (out.length) out.push("");
  f.chunks.forEach((c, i) => {
    const lead = [...c.lead];
    while (i === 0 && lead.length && lead[0].trim() === "") lead.shift();
    out.push(...lead, ...chunkText(c, c.nodes.map((n, k) => exportOf(c, k))).split("\n"));
  });
  const trailer = [...f.trailer];
  while (trailer.length && trailer.at(-1).trim() === "") trailer.pop();
  return [...out, ...trailer].join("\n") + "\n";
}

// Cuts the chunks of module m out of the rest into a new file model. Returns the dropped banners.
function cut(page, target, m) {
  const rest = page.files.find((f) => f.file === REST) ?? fail("no web/app-rest.js: step C2 first");
  if (page.files.some((f) => f.file === fileOf(m))) fail(`web/${fileOf(m)} exists already`);
  const moving = rest.chunks.filter((c) => target.get(c) === m);
  if (!moving.length) fail(`the rest holds no statement of ${m}`);
  const dropped = [];
  for (const c of moving) {
    dropped.push(...c.lead.filter((l) => BANNER.test(l.trim())));
    c.lead = c.lead.filter((l) => !BANNER.test(l.trim()));
    c.file = fileOf(m);
  }
  rest.chunks = rest.chunks.filter((c) => target.get(c) !== m);
  page.files.push({ file: fileOf(m), header: [`// ${HEADING[m]}`], importText: [], chunks: moving,
    trailer: [] });
  return { moved: moving.reduce((n, c) => n + c.nodes.length, 0), dropped };
}

function write(page, mode) {
  const names = mode === "--exports" ? hookNames(page) : testNames();
  const { needs, crossUsed } = links(page);
  const used = (n) => crossUsed.has(n) || names.has(n);
  const exportOf = (c, k) => declaredNames(c.nodes[k]).some(used);
  const present = new Set([...page.files.map((f) => f.file),
    ...SOURCES.filter((s) => existsSync(join(WEB, s)))]);
  let changed = 0;
  for (const f of page.files) {
    const imports = mode === "--exports"
      ? f.importText
      : importBlock(f.file, needs.get(f.file), present);
    const text = render(f, imports, exportOf);
    const path = join(WEB, f.file);
    let old = null;
    try {
      old = readFileSync(path, "utf8");
    } catch { /* a new file */ }
    if (old === text) continue;
    writeFileSync(path, text);
    changed++;
    console.log(`wrote web/${f.file} (${moduleOfFile(f.file)})`);
  }
  return changed;
}

const arg = process.argv[2];
if (!arg) fail("usage: move.mjs <module> | --relink | --exports");
const page = loadPage(pageFiles());
if (arg !== "--relink" && arg !== "--exports") {
  if (!ORDER.includes(arg)) fail(`unknown module ${arg}`);
  const { target, errors } = placement(page, readTable());
  if (errors.length) fail(`run table first:\n${errors.join("\n")}`);
  const { moved, dropped } = cut(page, target, arg);
  console.log(`moved ${moved} statements to web/${fileOf(arg)}`);
  dropped.forEach((l) => console.log(`dropped banner: ${l.trim()}`));
}
const changed = write(page, arg);
console.log(`move: ${changed} files written`);
