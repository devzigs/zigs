// Mutation check of the harness tests and of the Solana page tests: each mutant undoes one fix
// or one rule in a copy of the tree, and the shipped check for it must fail in the way that
// mutations.mjs names. A mutant that
// survives, a patch that does not apply, or a check that is not green without the mutant,
// exits 1. Usage: lockf -k "$SOL/heavy.lock" node solspike/tools/mutate.mjs [ID ...]
// Do not nest lockf: the subjects run under the lock of this process. They run one at a time.
import { execFileSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBounded } from "./bounded.mjs";
import { MUTATIONS } from "./mutations.mjs";

const SPIKE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(SPIKE, "..");
const TREE = join(SPIKE, ".state/mut/tree");
const IGNORED_FILES = ["cf/.dev.vars"];

/** Copies every file of the clone (tracked, and new but not ignored) into an empty mutation tree.
 * A file that the clone deleted or renamed must not stay in the tree. */
function copyTree() {
  rmSync(TREE, { recursive: true, force: true });
  const args = ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];
  const list = execFileSync("git", args, { cwd: ROOT, maxBuffer: 1 << 26 });
  for (const rel of [...list.toString().split("\0").filter(Boolean), ...IGNORED_FILES]) {
    if (!existsSync(join(ROOT, rel))) continue;
    mkdirSync(dirname(join(TREE, rel)), { recursive: true });
    copyFileSync(join(ROOT, rel), join(TREE, rel));
  }
  const modules = join(TREE, "cf/node_modules");
  if (!existsSync(modules)) symlinkSync(join(ROOT, "cf/node_modules"), modules);
}

const exec = (run, ms) =>
  runBounded(run[0], run.slice(1), { ms, cwd: TREE });

/** Applies the patches, returns a function that puts the old texts back. */
function apply(patches) {
  const before = new Map();
  const undo = () => before.forEach((text, file) => writeFileSync(join(TREE, file), text));
  try {
    for (const { file, from, to } of patches) {
      const text = before.get(file) ?? readFileSync(join(TREE, file), "utf8");
      before.set(file, text);
      const parts = text.split(from);
      if (parts.length !== 2) {
        throw new Error(`${file}: the pattern occurs ${parts.length - 1} times`);
      }
      writeFileSync(join(TREE, file), parts.join(to));
    }
  } catch (err) {
    undo();
    throw err;
  }
  return undo;
}

function verdict(m, res) {
  if (res.timedOut) return { ok: false, why: `the check hung (${res.ms} ms), stopped by PID` };
  if (res.code === 0) return { ok: false, why: "the check passed: the mutant survived" };
  if (!m.detect.test(res.output)) {
    const tail = res.output.trim().split("\n").slice(-6).join(" | ").slice(-400);
    return { ok: false, why: `failed, but not as ${m.detect}: ${tail}` };
  }
  if (m.forbid?.test(res.output)) return { ok: false, why: `the output matches ${m.forbid}` };
  return { ok: true, why: `killed in ${res.ms} ms` };
}

async function control(m, seen) {
  const key = m.run.join(" ");
  if (seen.has(key)) return seen.get(key);
  const res = await exec(m.run, m.ms);
  const ok = !res.timedOut && res.code === 0;
  seen.set(key, ok ? null : `the check is not green without the mutant: ${key}\n${res.output}`);
  return seen.get(key);
}

async function runOne(m, seen) {
  const bad = await control(m, seen);
  if (bad) return { ok: false, why: bad };
  const undo = apply(m.patches);
  try {
    return verdict(m, await exec(m.run, m.ms));
  } finally {
    undo();
  }
}

async function main() {
  const wanted = process.argv.slice(2);
  const todo = MUTATIONS.filter((m) => !wanted.length || wanted.includes(m.id));
  if (wanted.length && todo.length !== wanted.length) throw new Error("unknown mutant id");
  copyTree();
  const seen = new Map();
  let failures = 0;
  for (const m of todo) {
    const res = await runOne(m, seen).catch((err) => ({ ok: false, why: err.message }));
    failures += res.ok ? 0 : 1;
    console.log(`${res.ok ? "killed " : "FAILED "} ${m.id}: ${m.what} - ${res.why}`);
  }
  console.log(`mutants: ${todo.length}, failed: ${failures}`);
  process.exitCode = failures ? 1 : 0;
}

main();
