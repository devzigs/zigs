// K1 of the app.js split (APPJS-SPLIT.md 4.3): compares the top-level statements of the page with
// a parent commit. Import lines and the word `export` do not count. It checks that no statement
// is lost, new or changed, that each statement is in the file of its module by table.tsv, that
// the statements of a file keep their old order, and that every comment line of the parent is
// in exactly one file (section banners may go: the tool prints them; a new file may add its
// heading line). Exit 1 on any difference: for a step that edits code (B, C), read the list.
// Usage: node solspike/split/ledger.mjs <parent> [<child commit>; default: the working tree]
import {
  BANNER, fail, pageFiles, parseFile, placement, readTable, withInternals,
} from "./lib.mjs";

withInternals();
const [parentRev, childRev] = process.argv.slice(2);
if (!parentRev) fail("usage: ledger.mjs <parent> [<child>]");
const parent = pageFiles(parentRev).map(({ file, text }) => parseFile(file, text));
const child = pageFiles(childRev).map(({ file, text }) => parseFile(file, text));
const problems = [];
const short = (text) => text.replace(/\s+/g, " ").slice(0, 70);

// 1. The same statements: a multiset of statement texts.
const pool = new Map();
parent.forEach((f) => f.chunks.forEach((c, i) => {
  if (!pool.has(c.plain)) pool.set(c.plain, []);
  pool.get(c.plain).push({ file: f.file, i, start: c.start });
}));
const from = new Map();
for (const f of child) {
  for (const c of f.chunks) {
    const hit = pool.get(c.plain)?.shift();
    if (hit) from.set(c, hit);
    else problems.push(`new or changed: web/${f.file}:${c.start} ${short(c.plain)}`);
  }
}
for (const list of pool.values()) {
  for (const p of list) {
    const c = parent.find((f) => f.file === p.file).chunks[p.i];
    problems.push(`lost or changed: web/${p.file}:${p.start} @ ${parentRev} ${short(c.plain)}`);
  }
}

// 2. Each statement in the file of its module.
if (!childRev) {
  const chunks = child.flatMap((f) => f.chunks);
  const { errors } = placement({ files: child, chunks }, readTable());
  problems.push(...errors);
}

// 3. The old order inside each file.
for (const f of child) {
  const last = new Map();
  for (const c of f.chunks) {
    const p = from.get(c);
    if (!p) continue;
    if ((last.get(p.file) ?? -1) > p.i) {
      problems.push(`order: web/${f.file}:${c.start} came before an earlier statement`);
    }
    last.set(p.file, p.i);
  }
}

// 4. Comment lines.
const isComment = (l) => l.startsWith("//") || l.startsWith("/*") || l.startsWith("*");
const comments = (f) => [...f.header, ...f.importText, ...f.chunks.flatMap((c) => c.lead),
  ...f.trailer].map((l) => l.trim()).filter(isComment);
const count = (files) => {
  const m = new Map();
  for (const l of files.flatMap(comments)) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
};
const before = count(parent), after = count(child);
const oldFiles = new Set(parent.map((f) => f.file));
const headings = new Set(child.filter((f) => !oldFiles.has(f.file)).flatMap((f) => f.header)
  .map((l) => l.trim()));
let banners = 0;
for (const l of new Set([...before.keys(), ...after.keys()])) {
  const d = (before.get(l) ?? 0) - (after.get(l) ?? 0);
  if (d > 0 && BANNER.test(l)) {
    banners += d;
    console.log(`banner dropped (${d}): ${l}`);
  } else if (d < 0 && headings.has(l) && d === -1) {
    console.log(`new heading: ${l}`);
  } else if (d !== 0) {
    problems.push(`comment ${d > 0 ? "lost" : "added"} (${Math.abs(d)}): ${l}`);
  }
}

const total = parent.reduce((n, f) => n + f.chunks.reduce((k, c) => k + c.nodes.length, 0), 0);
problems.forEach((p) => console.log(`DIFF ${p}`));
console.log(`ledger: ${total} statements in ${parentRev}, ${problems.length} differences, ` +
  `${banners} banner lines dropped`);
process.exitCode = problems.length ? 1 : 0;
