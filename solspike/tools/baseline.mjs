// The Zcash baseline of the clone.
// Usage: node tools/baseline.mjs record|check EXITS.tsv HEADERS.txt
//        node tools/baseline.mjs begin | reuse EXITS.tsv
// EXITS.tsv has one line per test: name, exit code or "skipped", reason. HEADERS.txt is the
// response of the dev server for "/" (curl -D). baseline.sh writes both.
// record writes solspike/baseline.json. check writes .state/baseline-now.json and compares it
// with baseline.json: test results, sha256 of wasm/, web/pkg/ and web/signed.js, policy(), and
// the security headers that the dev server really sent. Record on the base commit only: the
// file names it, and policy.test.mjs reads the base policy from that commit.
// A run with 0 problems on a clean tree leaves a stamp in .state (never in the repo). begin
// starts a run: it removes the stamp. A run with problems removes the pending file of begin.
// reuse writes EXITS.tsv from the stamp and exits 0 when the working tree is clean and has the
// files, the Node version, cf/.dev.vars, qrencode, TZ and installed packages (the hash of
// node_modules/.package-lock.json of cf, solspike and solspike/tools) of the stamped run, and the
// stamp is not older than 24 h. baseline.sh then runs no test, but it still reads the headers
// from the server and check compares as always.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const SPIKE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(SPIKE, "..");
const BASELINE = join(SPIKE, "baseline.json");
const NOW = join(SPIKE, ".state/baseline-now.json");
const STAMP = join(SPIKE, ".state/baseline-stamp.json");
const PENDING = join(SPIKE, ".state/baseline-pending.json");
const DEV_VARS = join(ROOT, "cf/.dev.vars");
const RECORD = "solspike/baseline.json";
const HASHED = ["wasm", "web/pkg", "web/signed.js"];
const PACKAGE_DIRS = ["cf", "solspike", "solspike/tools"];
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Inputs of policy(), not the address of the dev server: they stay the same on every port.
const URLS = ["http://localhost:8795/", "https://app.zigs.app/", "http://127.0.0.1:8795/"];
// The response headers that the gate compares. wrangler dev sends the route host in the policy
// (ws://app.zigs.app), so the served string differs from policy() of a localhost URL.
const SERVED = [
  "content-security-policy",
  "referrer-policy",
  "x-content-type-options",
  "x-frame-options",
  "permissions-policy",
  "strict-transport-security",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "cross-origin-embedder-policy",
];

const sha = (data) => createHash("sha256").update(data).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const hashOf = (file) => [relative(ROOT, file), sha(readFileSync(file))];

/** Every file below a path, sorted. A target/ directory is build output and is skipped. */
function walk(abs) {
  if (!statSync(abs).isDirectory()) return [abs];
  return readdirSync(abs)
    .filter((name) => name !== "target")
    .sort()
    .flatMap((name) => walk(join(abs, name)));
}

const hashes = () => Object.fromEntries(HASHED.flatMap((p) => walk(join(ROOT, p))).map(hashOf));

/** The Zigs policy(), cut out of cf/src/index.js and run as written. */
function policies() {
  const src = readFileSync(join(ROOT, "cf/src/index.js"), "utf8");
  const chain = /const CHAIN_SERVERS = [\s\S]*?;\n/.exec(src)?.[0];
  const fn = /function policy\(url\) \{[\s\S]*?\n\}\n/.exec(src)?.[0];
  if (!chain || !fn) throw new Error("cannot find policy() in cf/src/index.js");
  const policy = runInNewContext(`${chain}\n${fn}\npolicy`, {}, { timeout: 1000 });
  const byUrl = Object.fromEntries(URLS.map((u) => [u, policy(new URL(u))]));
  return { sourceSha256: sha(chain + fn), byUrl };
}

function readTests(file) {
  const tests = {};
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const [name, code, reason = ""] = line.split("\t");
    tests[name] = code === "skipped" ? { exit: null, skipped: reason } : { exit: Number(code) };
  }
  return tests;
}

/** The compared headers of a `curl -D` dump of a page. The page must be a 200 with a policy. */
export function servedHeaders(text) {
  const [status, ...lines] = text.split(/\r?\n/);
  if (!/^HTTP\/\S+ 200\b/.test(status)) {
    throw new Error(`served page: status "${status}", want 200`);
  }
  const found = {};
  for (const line of lines) {
    const colon = line.indexOf(":");
    const name = line.slice(0, colon).toLowerCase();
    if (colon > 0 && SERVED.includes(name)) found[name] = line.slice(colon + 1).trim();
  }
  if (!found["content-security-policy"]) {
    throw new Error("served page: no content-security-policy");
  }
  return found;
}

const collect = (exitsFile, headersFile) => ({
  baseCommit: git("rev-parse", "HEAD"),
  node: process.version,
  tests: readTests(exitsFile),
  hashes: hashes(),
  policy: policies(),
  served: servedHeaders(readFileSync(headersFile, "utf8")),
});

function diffMaps(label, a, b) {
  const out = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    const how = a[key] === undefined ? "added" : b[key] === undefined ? "removed" : "changed";
    out.push(`${label} ${key}: ${how}`);
  }
  return out;
}

/** The differences between the recorded baseline and the state now: a list of texts. */
export function compare(base, now) {
  const problems = [
    ...diffMaps("test", base.tests, now.tests),
    ...diffMaps("hash", base.hashes, now.hashes),
    ...diffMaps("policy", base.policy.byUrl, now.policy.byUrl),
    ...diffMaps("served", base.served ?? {}, now.served),
  ];
  if (!base.served) problems.push("baseline.json has no served headers: record it again");
  if (base.policy.sourceSha256 !== now.policy.sourceSha256) problems.push("policy source changed");
  try {
    git("merge-base", "--is-ancestor", base.baseCommit, "HEAD");
  } catch {
    problems.push(`base commit ${base.baseCommit} is not an ancestor of HEAD`);
  }
  return problems;
}

/** One text for each test that ran and did not exit 0. A skipped test is not a failure. */
export const failed = (tests) =>
  Object.entries(tests)
    .filter(([, t]) => t.exit !== null && t.exit !== 0)
    .map(([name]) => `failed: ${name}`);

const USAGE =
  "usage: node tools/baseline.mjs record|check EXITS.tsv HEADERS.txt | reuse EXITS.tsv | begin";

/** One hash of the files of HEAD without the record: a commit that only records the baseline, or
 * a merge of the same files, keeps it. */
function treeHash() {
  const args = ["ls-tree", "-r", "-z", "HEAD"];
  const list = execFileSync("git", args, { cwd: ROOT, maxBuffer: 1 << 28 });
  const files = list.toString("latin1").split("\0").filter(Boolean);
  return sha(files.filter((entry) => !entry.endsWith(`\t${RECORD}`)).join("\0"));
}

/** True when no file outside the ignored paths differs from HEAD, the record apart. */
function isClean() {
  const args = ["status", "--porcelain", "-z", "--untracked-files=all"];
  const list = execFileSync("git", args, { cwd: ROOT, maxBuffer: 1 << 26 });
  return list.toString("latin1").split("\0").filter(Boolean).every((e) => e.slice(3) === RECORD);
}

/** The hash of the file that npm writes for the installed packages of each folder. A missing file
 * is null: it is its own value. */
const packages = () =>
  Object.fromEntries(
    PACKAGE_DIRS.map((dir) => {
      const file = join(ROOT, dir, "node_modules/.package-lock.json");
      return [dir, existsSync(file) ? sha(readFileSync(file)) : null];
    }),
  );

/** What a run depends on besides the tests: the files of HEAD, the Node version, the secrets file
 * of the dev server (as a hash), whether qrencode lets qr.mjs run, TZ and the installed
 * packages. */
const fingerprint = () => ({
  tree: treeHash(),
  node: process.version,
  devVars: existsSync(DEV_VARS) ? sha(readFileSync(DEV_VARS)) : null,
  qrencode: spawnSync("sh", ["-c", "command -v qrencode"]).status === 0,
  tz: process.env.TZ ?? null,
  packages: packages(),
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Starts a full run: the old stamp goes, and the state of the tree is kept for its end. */
function begin() {
  rmSync(STAMP, { force: true });
  mkdirSync(dirname(PENDING), { recursive: true });
  writeFileSync(PENDING, JSON.stringify({ clean: isClean(), key: fingerprint() }));
}

/** Keeps a run with 0 problems if the tree was clean at its start and its end, and equal. */
function stamp(exits) {
  if (!existsSync(PENDING)) return;
  const start = JSON.parse(readFileSync(PENDING, "utf8"));
  rmSync(PENDING);
  const key = fingerprint();
  if (!start.clean || !isClean() || !same(start.key, key)) return;
  const text = JSON.stringify({
    key,
    at: new Date().toISOString(),
    exits: readFileSync(exits, "utf8"),
  });
  writeFileSync(STAMP, `${text}\n`);
}

/** The reason why the stamp `kept` cannot stand for a run now, or "" if it can. */
function whyNot(kept) {
  if (!kept) return "there is no stamp";
  if (typeof kept.exits !== "string") return "the stamp is damaged";
  // A date that does not parse is NaN, and NaN is not within the limit.
  if (!(Date.now() - Date.parse(kept.at) <= MAX_AGE_MS)) return "the stamp is older than 24 h";
  if (!isClean()) return "the working tree has changes";
  const key = fingerprint();
  const differs = Object.keys(key).find((name) => !same(key[name], kept.key?.[name]));
  return differs ? `${differs} is not the one of the stamped run` : "";
}

/** Writes the exit codes of the stamped run into the file. Returns the exit code. */
function reuse(exits) {
  rmSync(PENDING, { force: true });
  let kept = null;
  try {
    kept = existsSync(STAMP) ? JSON.parse(readFileSync(STAMP, "utf8")) : null;
  } catch (err) {
    console.log(`reuse: no, the stamp is unreadable (${err.message})`);
    return 1;
  }
  const why = whyNot(kept);
  if (why) {
    console.log(`reuse: no, ${why}`);
    return 1;
  }
  writeFileSync(exits, kept.exits);
  console.log(`reuse: yes, the passing run of ${kept.at} on the same files`);
  return 0;
}

function verify(mode, exits, headers) {
  const now = collect(exits, headers);
  const text = `${JSON.stringify(now, null, 2)}\n`;
  const problems = failed(now.tests);
  if (mode === "record") writeFileSync(BASELINE, text);
  else {
    mkdirSync(dirname(NOW), { recursive: true });
    writeFileSync(NOW, text);
    problems.push(...compare(JSON.parse(readFileSync(BASELINE, "utf8")), now));
  }
  const n = { tests: Object.keys(now.tests).length, hashes: Object.keys(now.hashes).length };
  console.log(`${mode}: ${n.tests} tests, ${n.hashes} hashed files, ${problems.length} problems`);
  problems.forEach((p) => console.log(`  ${p}`));
  if (!problems.length) stamp(exits);
  else rmSync(PENDING, { force: true });
  return problems.length ? 1 : 0;
}

function main() {
  const [mode, exits, headers] = process.argv.slice(2);
  if (mode === "begin") return begin();
  if (mode === "reuse" && exits) process.exit(reuse(exits));
  if (!["record", "check"].includes(mode) || !exits || !headers) throw new Error(USAGE);
  process.exit(verify(mode, exits, headers));
}

// True when node started this file, also through a symlink or a path in another case: node
// resolves import.meta.url and keeps argv[1] as typed. A false answer on a real run would end
// the gate with no output.
const isMain = () => {
  try {
    const real = realpathSync.native;
    return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isMain()) main();
