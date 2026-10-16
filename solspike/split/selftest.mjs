// Tool test of the split tools (APPJS-SPLIT.md, step A5) on a small page in a temporary git
// clone: step C2 by hand, two moves, the ledger after each, and six changes that the ledger, the
// table or the move tool must refuse. Usage: node solspike/split/selftest.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPLIT } from "./lib.mjs";

const dir = mkdtempSync(join(tmpdir(), "zigs-split-"));
const web = join(dir, "web");
const put = (rel, text) => writeFileSync(join(dir, rel), text);
const get = (rel) => readFileSync(join(dir, rel), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
const tool = (name, ...args) => {
  const run = spawnSync(process.execPath, [join(SPLIT, `${name}.mjs`), ...args],
    { cwd: dir, encoding: "utf8", env: { ...process.env, SPLIT_ROOT: dir } });
  return { code: run.status, out: run.stdout + run.stderr };
};
const commit = (msg) => {
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-qm",
    msg);
  return git("rev-parse", "HEAD");
};

const APP = `// The app.
import { helper, other as renamed } from "/util.js";
// ── Kit ──
// A pure helper.
const fmt = (x) => helper(x) + renamed;
let count = 0; const items = new Map();
// ── State ──
const state = { n: "" };
function bump() { count++; items.set(count, fmt(count)); state.n = fmt(count); }
document.addEventListener("click", bump);
bump();
`;
const TABLE = "fmt\tkit\ncount\tstate\nitems\tstate\nstate\tstate\nbump\tstate\n" +
  '@document.addEventListener("click", bump);\tstate\n@bump();\tentry\n';

try {
  git("init", "-q");
  mkdirSync(join(web, "test"), { recursive: true });
  mkdirSync(join(dir, "solspike/split"), { recursive: true });
  put("web/app.js", APP);
  put("web/util.js", 'export const helper = (x) => "#" + x;\nexport const other = "!";\n');
  put("web/test/page.mjs", 'export const NAMES = ["state"];\n');
  put("solspike/split/table.tsv", TABLE);
  const base = commit("base");
  assert.equal(tool("table").code, 0, tool("table").out);

  // Step C2 by hand: the rest and an entry with the boot statement, then --relink.
  git("mv", "web/app.js", "web/app-rest.js");
  put("web/app-rest.js", get("web/app-rest.js").replace("// The app.", "// The rest.")
    .replace("bump();\n", ""));
  put("web/app.js", "// The app.\nbump();\n");
  let r = tool("move", "--relink");
  assert.equal(r.code, 0, r.out);
  const ENTRY_HEAD = /^\/\/ The app\.\nimport "\.\/util\.js";\nimport "\.\/app-rest\.js";\n/;
  assert.match(get("web/app.js"), ENTRY_HEAD);
  assert.match(get("web/app.js"), /import \{ bump \} from "\.\/app-rest\.js";/);
  const UTIL = 'import { helper, other as renamed } from "./util.js";';
  assert.ok(get("web/app-rest.js").includes(UTIL));
  assert.match(get("web/app-rest.js"), /^export function bump\(\)/m);
  assert.match(get("web/app-rest.js"), /^export const state = /m, "a name of NAMES is exported");
  r = tool("ledger", base);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /new heading: \/\/ The rest\./, "a new file may add its heading");
  const c2 = commit("c2");

  r = tool("move", "kit");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /moved 1 statements to web\/app-kit\.js/);
  const KIT = "// Pure helpers and the localStorage merge helpers. Imports no page module.";
  const kitHead = `${KIT}\n${UTIL}\n\n// A pure helper.\nexport const fmt`;
  assert.ok(get("web/app-kit.js").startsWith(kitHead), get("web/app-kit.js"));
  assert.match(get("web/app-rest.js"), /import \{ fmt \} from "\.\/app-kit\.js";/);
  assert.ok(!get("web/app-rest.js").includes("./util.js"), "the rest no longer needs util");
  r = tool("ledger", c2);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /banner dropped \(1\): \/\/ ── Kit ──/);
  const d1 = commit("kit");

  r = tool("move", "state");
  assert.equal(r.code, 0, r.out);
  assert.equal(tool("ledger", d1).code, 0);
  assert.match(get("web/app-state.js"), /^let count = 0; const items = new Map\(\);$/m,
    "two statements on one line move together, with no export: no other file uses them");
  assert.match(tool("move", "state").out, /exists already/);
  const run = spawnSync(process.execPath, ["--input-type=module", "-e",
    `globalThis.document = { addEventListener() {} };
     await import("./web/app.js");
     const { state } = await import("./web/app-state.js");
     if (state.n !== "#1!") throw new Error("state.n is " + state.n);`],
  { cwd: dir, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const d2 = commit("state");

  // The ledger refuses a changed statement, a lost comment and a new order.
  const stateJs = get("web/app-state.js");
  put("web/app-state.js", stateJs.replace("count++", "count += 2"));
  assert.match(tool("ledger", d2).out, /new or changed: web\/app-state\.js/);
  put("web/app-kit.js", get("web/app-kit.js").replace("// A pure helper.\n", ""));
  assert.match(tool("ledger", d2).out, /comment lost \(1\): \/\/ A pure helper\./);
  git("checkout", "--", "web");
  const pair = /^(export const state = .*)\n(export function bump.*)$/m;
  const swapped = stateJs.replace(pair, "$2\n$1");
  assert.notEqual(swapped, stateJs);
  put("web/app-state.js", swapped);
  assert.match(tool("ledger", d2).out, /order: web\/app-state\.js/);
  git("checkout", "--", "web");
  // The table refuses a statement in the file of another module, and a name with no row.
  put("solspike/split/table.tsv", TABLE.replace("fmt\tkit", "fmt\tstate"));
  assert.match(tool("table").out, /app-kit\.js:\d+: the table puts this in state/);
  put("solspike/split/table.tsv", TABLE.replace("fmt\tkit\n", ""));
  assert.match(tool("table").out, /no row for fmt/);
  // A relink without the list of test names would drop their exports: it stops.
  rmSync(join(web, "test/page.mjs"));
  assert.match(tool("move", "--relink").out, /no web\/test\/page\.mjs/);
  console.log("split selftest ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
