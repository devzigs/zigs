// The table check of the app.js split (APPJS-SPLIT.md 4.2, step 1). It stops (exit 1) on a
// statement with no row in table.tsv, a statement in the file of another module, and a top-level
// name that is also a browser or Node global (window-names.txt: Chrome 155, prototype chain
// included). It prints the load-time read sites and the size of each module.
// Usage: node solspike/split/table.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadPage, ORDER, pageFiles, placement, readTable, SPLIT, withInternals,
} from "./lib.mjs";

withInternals();
// oxlintrc-page.json lists the browser globals of the page by hand and has no browser env, so
// no-undef finds a missing import of these two names (EventTarget.prototype.when, window.opener).
const ALLOW = new Map([["opener", "loop"], ["when", "kit"]]);
const browser = readFileSync(join(SPLIT, "window-names.txt"), "utf8").split("\n")
  .filter((l) => l && !l.startsWith("#"));
const GLOBALS = new Set([...browser, ...Object.getOwnPropertyNames(globalThis)]);

const page = loadPage(pageFiles());
const table = readTable();
const { target: modOf, errors } = placement(page, table);

for (const [name, it] of page.owner) {
  const m = modOf.get(it.chunk);
  if (GLOBALS.has(name) && ALLOW.get(name) !== m) {
    errors.push(`web/${it.chunk.file}:${it.chunk.start}: ${name} is also a global name`);
  }
}

const absent = [...table.names.keys()].filter((n) => !page.owner.has(n));
if (absent.length) console.log(`rows with no statement yet (${absent.length}):`, absent.join(" "));

console.log("load-time uses of another module:");
for (const it of page.items) {
  const m = modOf.get(it.chunk);
  if (!it.runsAtLoad || m === "entry") continue;
  for (const n of new Set([...it.lcalls, ...it.lreads, ...it.lwrites])) {
    const o = page.owner.get(n);
    const om = o && modOf.get(o.chunk);
    const at = `web/${it.chunk.file}:${it.chunk.start}`;
    if (om && om !== m) console.log(`  ${at} ${m} uses ${n} of ${om}`);
  }
}

const size = new Map();
for (const c of page.chunks) {
  const m = modOf.get(c) ?? "?";
  const s = size.get(m) ?? { stmts: 0, lines: 0 };
  s.stmts += c.nodes.length;
  s.lines += c.lead.length + c.end - c.start + 1;
  size.set(m, s);
}
console.log("module        statements  lines");
for (const m of [...ORDER, "entry", "?"].filter((x) => size.has(x))) {
  const s = size.get(m);
  console.log(`  ${m.padEnd(13)} ${String(s.stmts).padStart(6)} ${String(s.lines).padStart(6)}`);
}
errors.forEach((e) => console.log(`ERROR ${e}`));
console.log(`table: ${page.items.length} statements, ${errors.length} errors`);
process.exitCode = errors.length ? 1 : 0;
