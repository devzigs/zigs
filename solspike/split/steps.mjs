// The steps check of the app.js split (APPJS-SPLIT.md 4.2, step 1, and K5). For the state now
// and for each move that is still to come, the code that has not moved is one module (rest). A
// step has a hazard when a module assigns a binding of another module (a TypeError), or when a
// statement that runs at load reads a binding of another module, also through the functions
// that it calls (a ReferenceError). kit is exempt: it imports nothing, so it runs first.
// Exit 1 when the state now or the next move has a hazard. Usage: node solspike/split/steps.mjs
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  fileOf, loadPage, ORDER, pageFiles, readTable, tableModule, usesOf, WEB, withInternals,
} from "./lib.mjs";

withInternals();
const page = loadPage(pageFiles());
const table = readTable();
const target = new Map();
for (const it of page.items) {
  const m = tableModule(table, it.chunk);
  if (m.error) throw new Error(`web/${it.chunk.file}:${it.chunk.start}: ${m.error} (run table)`);
  target.set(it, m);
}
const hoisted = (it) => it.kind === "function" || it.kind === "async function";
const label = (it) => it.names[0] ?? `@${it.chunk.file}:${it.chunk.start}`;

function letWrites(mod) {
  const out = [];
  for (const it of page.items) {
    for (const n of it.writes) {
      const o = page.owner.get(n);
      if (!o || o === it || mod(o) === mod(it)) continue;
      out.push(`${n} of ${mod(o)} is assigned by ${label(it)} (${mod(it)})`);
    }
  }
  return out;
}

const foreign = (o, origin, mod) => mod(o) !== origin && mod(o) !== "kit";
// What a statement uses when it runs at load (top), or when a load-time call runs it.
const pathOf = (it, top) => ({
  reads: top ? [...it.lreads, ...it.lwrites] : [...it.reads, ...it.writes, ...it.muts],
  calls: top ? it.lcalls : it.calls,
});

// One statement on the load path of `origin`: its reads of bindings of other modules go to
// `out`, the functions that it calls go to `work`.
function loadStep({ it, top, origin }, mod, out, work) {
  const { reads, calls } = pathOf(it, top);
  for (const n of reads) {
    const o = page.owner.get(n);
    const bad = o && o !== it && !hoisted(o) && foreign(o, origin, mod);
    if (bad) out.add(`${origin}: ${label(it)} reads ${n} of ${mod(o)}`);
  }
  calls.forEach((n) => callStep(it, n, { origin, mod, out, work }));
}

function callStep(it, n, { origin, mod, out, work }) {
  const o = page.owner.get(n);
  if (!o || o === it) return;
  const arrow = o.kind === "const-fn";
  if (arrow && foreign(o, origin, mod)) out.add(`${origin}: calls ${n} of ${mod(o)}`);
  if (hoisted(o) || arrow) work.push({ it: o, top: false, origin });
}

function loadReads(mod) {
  const out = new Set(), seen = new Set();
  const work = page.items.filter((it) => it.runsAtLoad && mod(it) !== "entry")
    .map((it) => ({ it, top: true, origin: mod(it) }));
  while (work.length) {
    const step = work.pop();
    const key = `${page.items.indexOf(step.it)}${step.top}${step.origin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    loadStep(step, mod, out, work);
  }
  return [...out];
}

// The names that module m takes from rest when it moves.
function fromRest(m, mod) {
  const out = new Set();
  for (const it of page.items) {
    if (mod(it) !== m) continue;
    for (const n of usesOf(it)) {
      const o = page.owner.get(n);
      if (o && mod(o) === "rest") out.add(n);
    }
  }
  return out;
}

const done = ORDER.filter((m) => existsSync(join(WEB, fileOf(m))));
const todo = ORDER.filter((m) => !done.includes(m));
let bad = 0, blocking = false;
for (let k = 0; k <= todo.length; k++) {
  const moved = new Set([...done, ...todo.slice(0, k)]);
  const mod = (it) => {
    const m = target.get(it);
    return m === "entry" || moved.has(m) ? m : "rest";
  };
  const hazards = [...letWrites(mod), ...loadReads(mod)];
  const m = todo[k - 1];
  const name = k === 0 ? "now" : `D${ORDER.indexOf(m) + 1} ${m}`;
  const extra = k === 0 ? "" : ` (takes ${fromRest(m, mod).size} names from rest)`;
  console.log(`${name.padEnd(17)} ${hazards.length ? `${hazards.length} hazards` : "ok"}${extra}`);
  hazards.forEach((h) => console.log(`    ${h}`));
  if (hazards.length) bad++;
  if (hazards.length && k <= 1) blocking = true;
}
console.log(`steps: ${todo.length} moves to come, ${bad} states with a hazard`);
process.exitCode = blocking ? 1 : 0;
