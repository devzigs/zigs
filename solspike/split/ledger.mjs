// K1 of the app.js split (APPJS-SPLIT.md 4.3): compares the top-level statements of the page with
// a parent commit. Import lines and the word `export` do not count. It checks that no statement
// is lost, new or changed, that each statement is in the file of its module by table.tsv, that
// the statements of a file keep their old order, and that every comment line of the parent is
// in exactly one file (section banners may go: the tool prints them; a new file may add its
// heading line, and a deleted file takes its heading with it). Each import binding keeps its
// meaning: a name from a pure module keeps the source and the imported name of the parent, and
// a name from a page module comes, with no alias, from the module that declares it (no default
// or namespace import). It also does K6: no module over
// 800 lines, and no new line over 100 characters. A line that crosses 100 only by the word
// `export` is counted, not refused. Exit 1 on any difference: for a step that edits code (B, C),
// read the list.
// Usage: node solspike/split/ledger.mjs <parent> [<child commit>; default: the working tree]
import {
  BANNER, chunkText, fail, pageFiles, parseFile, placement, PURE, readTable, withInternals,
} from "./lib.mjs";
import { declaredNames } from "./refs.mjs";

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
const oldFiles = new Set(parent.map((f) => f.file)), newFiles = new Set(child.map((f) => f.file));
const headingsOf = (files, others) =>
  new Set(files.filter((f) => !others.has(f.file)).flatMap((f) => f.header).map((l) => l.trim()));
const headings = headingsOf(child, oldFiles), goneHeadings = headingsOf(parent, newFiles);
let banners = 0;
for (const l of new Set([...before.keys(), ...after.keys()])) {
  const d = (before.get(l) ?? 0) - (after.get(l) ?? 0);
  if (d > 0 && BANNER.test(l)) {
    banners += d;
    console.log(`banner dropped (${d}): ${l}`);
  } else if (d === -1 && headings.has(l)) {
    console.log(`new heading: ${l}`);
  } else if (d === 1 && goneHeadings.has(l)) {
    console.log(`heading of a deleted file: ${l}`);
  } else if (d !== 0) {
    problems.push(`comment ${d > 0 ? "lost" : "added"} (${Math.abs(d)}): ${l}`);
  }
}

// 5. Import bindings.
const PURE_FILES = new Set(PURE.map((p) => `${p}.js`));
const sourceOf = (imp) => imp.source.value.replace(/^\.?\//, "");
const pureBindings = (files) => new Map(files.flatMap((f) => f.imports)
  .filter((imp) => PURE_FILES.has(sourceOf(imp)))
  .flatMap((imp) => imp.specifiers
    .map((s) => [s.local.name, `${sourceOf(imp)}:${s.imported?.name}`])));
const declaredBy = new Map(child.map((f) => [f.file,
  new Set(f.chunks.flatMap((c) => c.nodes.flatMap(declaredNames)))]));
const pureBefore = pureBindings(parent);

function bindingProblem(file, source, s) {
  if (s.type !== "ImportSpecifier") return `web/${file} has a ${s.type} of ${source}`;
  const local = s.local.name, now = `${source}:${s.imported.name}`;
  if (PURE_FILES.has(source)) {
    const was = pureBefore.get(local);
    return was === now ? null : `${local} in web/${file} is ${now}, before ${was ?? "no import"}`;
  }
  const own = s.imported.name === local && declaredBy.get(source)?.has(local);
  return own ? null : `${local} in web/${file} does not come from the module that declares it`;
}

const bindings = child.flatMap((f) => f.imports.flatMap((imp) =>
  imp.specifiers.map((s) => bindingProblem(f.file, sourceOf(imp), s))));
bindings.filter(Boolean).forEach((p) => problems.push(`binding: ${p}`));

// 6. K6: sizes and long lines. Import lines do not count; neither does the word `export`.
const longLines = (files) => new Set(files.flatMap((f) => f.chunks.flatMap((c) => c.plain
  .split("\n"))).filter((l) => l.length > 100));
const before100 = longLines(parent);
let crossed = 0;
for (const f of child) {
  const lines = f.chunks.reduce((n, c) => n + c.lead.length + c.end - c.start + 1, 0)
    + f.header.length + f.importText.length;
  const rest = f.file === "app-rest.js" || (f.file === "app.js" && !newFiles.has("app-rest.js"));
  if (!rest && lines > 800) problems.push(`K6: web/${f.file} has ${lines} lines`);
  for (const c of f.chunks) {
    const shown = chunkText(c, c.exported).split("\n");
    shown.forEach((line, i) => {
      if (line.length <= 100) return;
      const plain = c.plain.split("\n")[i];
      if (before100.has(plain)) return;
      if (plain.length <= 100) crossed++;
      else problems.push(`K6: new long line web/${f.file}:${c.start + i}`);
    });
  }
}
console.log(`K6: ${crossed} lines cross 100 characters only by the word export`);

const total = parent.reduce((n, f) => n + f.chunks.reduce((k, c) => k + c.nodes.length, 0), 0);
problems.forEach((p) => console.log(`DIFF ${p}`));
console.log(`ledger: ${total} statements in ${parentRev}, ${problems.length} differences, ` +
  `${banners} banner lines dropped`);
process.exitCode = problems.length ? 1 : 0;
