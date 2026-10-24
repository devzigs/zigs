// Mutation check of the harness tests and of the Solana page tests: each mutant undoes one fix
// or one rule in a copy of the tree, and the shipped check for it must fail in the way that
// mutations.mjs names. A mutant that survives, a patch that does not apply, or a check that is
// not green without the mutant, exits 1.
// Usage: lockf -k "$SOL/heavy.lock" node solspike/tools/mutate.mjs [ID ...]
// Do not nest lockf: the subjects run under the lock of this process. Up to three run at once
// (MUTATE_LANES=1 runs them one at a time). Each lane has a tree of its own, a server port
// (SOLSPIKE_PORT plus the lane number) and its part of the Chrome ports (SOLSPIKE_CHROME_PORTS).
// The lines come in the order of the list, as in a serial run.
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
const IGNORED_FILES = ["cf/.dev.vars"];
const LANES = Number(process.env.MUTATE_LANES ?? 3);

/** A lane: a mutation tree of its own and the ports of its own. */
function laneOf(n) {
  const port = Number(process.env.SOLSPIKE_PORT ?? 8795) + n;
  const [low, high] = (process.env.SOLSPIKE_CHROME_PORTS ?? "9350-9369").split("-").map(Number);
  const width = Math.floor((high - low + 1) / LANES);
  const from = low + n * width;
  const env = { SOLSPIKE_PORT: String(port), SOLSPIKE_CHROME_PORTS: `${from}-${from + width - 1}` };
  return { tree: join(SPIKE, `.state/mut/lane${n}`), env, seen: new Map() };
}

/** Copies every file of the clone (tracked, and new but not ignored) into an empty mutation tree.
 * A file that the clone deleted or renamed must not stay in the tree. */
function copyTree(tree) {
  rmSync(tree, { recursive: true, force: true });
  const args = ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];
  const list = execFileSync("git", args, { cwd: ROOT, maxBuffer: 1 << 26 });
  for (const rel of [...list.toString().split("\0").filter(Boolean), ...IGNORED_FILES]) {
    if (!existsSync(join(ROOT, rel))) continue;
    mkdirSync(dirname(join(tree, rel)), { recursive: true });
    copyFileSync(join(ROOT, rel), join(tree, rel));
  }
  const modules = join(tree, "cf/node_modules");
  if (!existsSync(modules)) symlinkSync(join(ROOT, "cf/node_modules"), modules);
}

const exec = (run, ms, lane) =>
  runBounded(run[0], run.slice(1), { ms, cwd: lane.tree, env: lane.env });

/** Applies the patches, returns a function that puts the old texts back. */
function apply(patches, tree) {
  const before = new Map();
  const undo = () => before.forEach((text, file) => writeFileSync(join(tree, file), text));
  try {
    for (const { file, from, to } of patches) {
      const text = before.get(file) ?? readFileSync(join(tree, file), "utf8");
      before.set(file, text);
      const parts = text.split(from);
      if (parts.length !== 2) {
        throw new Error(`${file}: the pattern occurs ${parts.length - 1} times`);
      }
      writeFileSync(join(tree, file), parts.join(to));
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

/** The check without the mutant, once for each command in the tree of the lane, as in a serial
 * run: a check may leave files in its tree, and the mutant runs after it in the same tree. */
async function control(m, lane) {
  const key = m.run.join(" ");
  if (lane.seen.has(key)) return lane.seen.get(key);
  const res = await exec(m.run, m.ms, lane);
  const green = !res.timedOut && res.code === 0;
  const why = `the check is not green without the mutant: ${key}\n${res.output}`;
  lane.seen.set(key, green ? null : why);
  return lane.seen.get(key);
}

async function runOne(m, lane) {
  const bad = await control(m, lane);
  if (bad) return { ok: false, why: bad };
  const undo = apply(m.patches, lane.tree);
  try {
    return verdict(m, await exec(m.run, m.ms, lane));
  } finally {
    undo();
  }
}

async function main() {
  const wanted = process.argv.slice(2);
  const todo = MUTATIONS.filter((m) => !wanted.length || wanted.includes(m.id));
  if (wanted.length && todo.length !== wanted.length) throw new Error("unknown mutant id");
  if (!Number.isInteger(LANES) || LANES < 1 || LANES > 3) throw new Error("MUTATE_LANES is 1 to 3");
  const lanes = Array.from({ length: LANES }, (_, n) => laneOf(n));
  lanes.forEach((lane) => copyTree(lane.tree));
  const results = [];
  let [next, printed, failures] = [0, 0, 0];
  const flush = () => {
    for (; results[printed]; printed += 1) {
      const { ok, why } = results[printed];
      failures += ok ? 0 : 1;
      const m = todo[printed];
      console.log(`${ok ? "killed " : "FAILED "} ${m.id}: ${m.what} - ${why}`);
    }
  };
  await Promise.all(
    lanes.map(async (lane) => {
      while (next < todo.length) {
        const at = next++;
        results[at] = await runOne(todo[at], lane).catch((err) => ({
          ok: false,
          why: err.message,
        }));
        flush();
      }
    }),
  );
  console.log(`mutants: ${todo.length}, failed: ${failures}`);
  process.exitCode = failures ? 1 : 0;
}

main();
