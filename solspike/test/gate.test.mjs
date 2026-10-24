// Tests of the Zcash baseline gate (tools/baseline.mjs). Usage: node solspike/test/gate.test.mjs
// The real tool runs in a small fixture repository with a real policy() (cf/src/index.js). Each
// control changes one thing that the gate must see, and the gate must exit 1 and name it.
// C0 is the clean state (exit 0), C1 to C17 are the changes, C18 to C21 run the tool by another
// path to the same file, C22 to C24 run baseline.sh with a stand-in tool, D5 is a missing .state.
// C26 to C33 are the stamp of a passing run (begin, reuse) and the use that baseline.sh makes
// of it. C34 to C36 are the age, the installed packages and TZ in the key of the stamp.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { compare, failed, servedHeaders } from "../tools/baseline.mjs";

const SPIKE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(SPIKE, "..");
const FIX = join(SPIKE, ".state/tmp/gate-fixture");
const LINKS = join(SPIKE, ".state/tmp/gate-links");
const SH_FIX = join(SPIKE, ".state/tmp/gate-sh");
const NOW = join(FIX, "solspike/.state/baseline-now.json");

const FILES = {
  "wasm/Cargo.toml": "[package]\n",
  "wasm/src/lib.rs": "pub fn one() {}\n",
  "web/pkg/z_bg.wasm": "wasm bytes",
  "web/signed.js": "export const signed = 1;\n",
};
const EXITS = "web/test/a.mjs\t0\nweb/test/b.mjs\t0\nweb/test/qr.mjs\tskipped\tno qrencode\n";
const CSP = "default-src 'none'; connect-src 'self' ws://app.zigs.app";
const HEADERS = [
  "HTTP/1.1 200 OK",
  "content-type: text/html",
  `Content-Security-Policy: ${CSP}`,
  "x-content-type-options: nosniff",
  "",
  "",
].join("\r\n");

const put = (rel, text) => {
  mkdirSync(dirname(join(FIX, rel)), { recursive: true });
  writeFileSync(join(FIX, rel), text);
};
const read = (rel) => readFileSync(join(FIX, rel), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: FIX, encoding: "utf8" });

function buildFixture() {
  for (const [rel, text] of Object.entries(FILES)) put(rel, text);
  mkdirSync(join(FIX, "cf/src"), { recursive: true });
  copyFileSync(join(REPO, "cf/src/index.js"), join(FIX, "cf/src/index.js"));
  mkdirSync(join(FIX, "solspike/tools"), { recursive: true });
  copyFileSync(join(SPIKE, "tools/baseline.mjs"), join(FIX, "solspike/tools/baseline.mjs"));
  put("exits.tsv", EXITS);
  put("headers.txt", HEADERS);
  put(".gitignore", "/solspike/.state\n/alt-*\nnode_modules/\n");
  git("init", "-q");
  git("add", "-A");
  const who = ["user.name=t", "user.email=t@example.invalid", "commit.gpgsign=false"];
  git(...who.flatMap((c) => ["-c", c]), "commit", "-q", "--allow-empty", "-m", "fixture");
}

const TOOL = join(FIX, "solspike/tools/baseline.mjs");

/** Runs the real tool in the fixture, by the path `tool` (it may be a link): { code, out }. */
function gate(mode, { exits = "exits.tsv", headers = "headers.txt", tool = TOOL, env = {} } = {}) {
  const run = spawnSync("node", [tool, mode, join(FIX, exits), join(FIX, headers)], {
    cwd: FIX,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 60000,
  });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

// Two links to the real tool: one to the solspike folder and one to the file.
function buildLinks() {
  mkdirSync(LINKS, { recursive: true });
  const links = { dir: join(FIX, "solspike"), "tool.mjs": TOOL };
  for (const [name, target] of Object.entries(links)) {
    const link = join(LINKS, name);
    if (lstatSync(link, { throwIfNoEntry: false })) unlinkSync(link);
    symlinkSync(target, link);
  }
}

before(() => {
  buildFixture();
  buildLinks();
  const record = gate("record");
  assert.equal(record.code, 0, record.out);
});

test("C0 the clean fixture passes", () => {
  const res = gate("check");
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /0 problems/);
});

/** Applies a change, runs the check, undoes the change, and returns the result. */
function control({ edit, undo, ...opts }) {
  edit();
  try {
    return gate("check", opts);
  } finally {
    undo();
  }
}
const swap = (rel, from, to) => {
  const before = read(rel);
  assert.ok(before.includes(from), `${rel} has no ${from}`);
  return { edit: () => put(rel, before.replace(from, to)), undo: () => put(rel, before) };
};
const add = (rel) => ({ edit: () => put(rel, "new\n"), undo: () => unlinkSync(join(FIX, rel)) });
const drop = (rel) => {
  const text = read(rel);
  return { edit: () => unlinkSync(join(FIX, rel)), undo: () => put(rel, text) };
};
// Answers and test lists of other runs go into side files. The fixed files stay as they are.
const withHeaders = (text) => ({
  edit: () => put("alt-headers.txt", text),
  undo: () => {},
  headers: "alt-headers.txt",
});
const withExits = (text) => ({
  edit: () => put("alt-exits.tsv", text),
  undo: () => {},
  exits: "alt-exits.tsv",
});

const noNosniff = HEADERS.replace("x-content-type-options: nosniff\r\n", "");
const CONTROLS = [
  ["C1 web/signed.js changed", swap("web/signed.js", "= 1", "= 2"), /hash web\/signed\.js/],
  ["C2 a pkg wasm file changed", swap("web/pkg/z_bg.wasm", "wasm", "WASM"), /hash web\/pkg/],
  ["C3 a file added under wasm/src", add("wasm/src/new.rs"), /hash wasm\/src\/new\.rs: added/],
  ["C4 a file removed under wasm/src", drop("wasm/src/lib.rs"), /wasm\/src\/lib\.rs: removed/],
  [
    "C5 policy source changed",
    swap("cf/src/index.js", "default-src 'none'", "default-src 'self'"),
    /policy source changed/,
  ],
  [
    "C6 policy output changed",
    swap("cf/src/index.js", "'self' 'wasm-unsafe-eval'", "'self'"),
    /policy http:\/\/localhost:8795\/: changed/,
  ],
  [
    "C7 a test exits 1",
    withExits(EXITS.replace("a.mjs\t0", "a.mjs\t1")),
    /failed: web\/test\/a\.mjs/,
  ],
  [
    "C8 a test line is missing",
    withExits(EXITS.replace("web/test/b.mjs\t0\n", "")),
    /test web\/test\/b\.mjs: removed/,
  ],
  [
    "C9 a test is skipped",
    withExits(EXITS.replace("b.mjs\t0", "b.mjs\tskipped\tlazy")),
    /test web\/test\/b\.mjs: changed/,
  ],
  [
    "C10 served policy changed",
    withHeaders(HEADERS.replace("ws://app", "ws://evil")),
    /served content-security-policy: changed/,
  ],
  [
    "C11 another served header changed",
    withHeaders(HEADERS.replace("nosniff", "sniff")),
    /served x-content-type-options: changed/,
  ],
  [
    "C12 a served header is gone",
    withHeaders(noNosniff),
    /served x-content-type-options: removed/,
  ],
  [
    "C13 a served header is new",
    withHeaders(HEADERS.replace("\r\n\r\n", "\r\nreferrer-policy: no\r\n\r\n")),
    /served referrer-policy: added/,
  ],
];

for (const [name, spec, want] of CONTROLS) {
  test(name, () => {
    const res = control(spec);
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, want);
  });
}

const noPolicy = HEADERS.replace(/Content-Security-Policy[^\r]*\r\n/, "");
const BROKEN = [
  ["C14 the served page has no policy", noPolicy, /no content-security-policy/],
  ["C15 the served page is not a 200", HEADERS.replace("200 OK", "404 Not Found"), /want 200/],
  ["C16 the served answer is empty", "", /want 200/],
];

for (const [name, headers, want] of BROKEN) {
  test(name, () => {
    const res = control(withHeaders(headers));
    assert.notEqual(res.code, 0, res.out);
    assert.match(res.out, want);
  });
}

test("C17 a baseline without served headers fails", () => {
  const text = read("solspike/baseline.json");
  const old = JSON.parse(text);
  delete old.served;
  const res = control({
    edit: () => put("solspike/baseline.json", JSON.stringify(old)),
    undo: () => put("solspike/baseline.json", text),
  });
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /no served headers/);
});

// The tool runs main() only when node started the file. A path that is not the real path of the
// file (a link, dots) must still run it: a gate that prints nothing and exits 0 passes everything.
// C21 is the real path in another case. The volume of this Mac does not tell the cases apart.
const UPPER = TOOL.replace(/^\/private\/tmp\//, "/PRIVATE/TMP/");
const PATHS = [
  ["C18 a path through a linked folder", join(LINKS, "dir/tools/baseline.mjs")],
  ["C19 a link to the file", join(LINKS, "tool.mjs")],
  ["C20 a relative path with dots", "solspike/../solspike/tools/baseline.mjs"],
  ...(UPPER !== TOOL && existsSync(UPPER) ? [["C21 the real path in another case", UPPER]] : []),
];

for (const [name, tool] of PATHS) {
  test(`${name}: the gate runs and sees a change`, () => {
    const clean = gate("check", { tool });
    assert.equal(clean.code, 0, clean.out);
    assert.match(clean.out, /^check: \d+ tests, \d+ hashed files, 0 problems$/m);
    const res = control({ ...swap("web/signed.js", "= 1", "= 2"), tool });
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /hash web\/signed\.js/);
  });
}

// baseline.sh in a fixture whose tool is a stand-in. The web tests and limits.mjs are empty
// scripts, serve.sh only writes its call in calls.log, and curl finds no server: only the result
// line and the calls are under test.
const WEB_TESTS = (
  "chat signed app requests account personal payees vault util qr shim graph " +
  "sol-docs sol-ceremony sol-app sol-wasm sol-sessions sol-limits sol-pay sol-transfer"
).split(" ");
// The helpers of baseline.sh: in the fixture too, so a gate that forgets one stops.
const HELPERS = ["sol-rig", "sol-setup", "sol-chain", "sol-vector", "page"];

function runBaselineSh(toolText, { extra = {}, mode = "check" } = {}) {
  const files = { "solspike/tools/baseline.mjs": toolText, "cf/test/limits.mjs": "" };
  for (const name of [...WEB_TESTS, ...HELPERS]) files[`web/test/${name}.mjs`] = "";
  Object.assign(files, extra);
  mkdirSync(join(SH_FIX, "solspike/tools"), { recursive: true });
  mkdirSync(join(SH_FIX, "cf/test"), { recursive: true });
  mkdirSync(join(SH_FIX, "web/test"), { recursive: true });
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(SH_FIX, rel), text);
  const serve = '#!/bin/bash\necho "serve $1" >>"$CALLS"\n';
  writeFileSync(join(SH_FIX, "solspike/serve.sh"), serve, { mode: 0o755 });
  copyFileSync(join(SPIKE, "baseline.sh"), join(SH_FIX, "solspike/baseline.sh"));
  const sh = join(SH_FIX, "solspike/baseline.sh");
  const calls = join(SH_FIX, "calls.log");
  const env = { ...process.env, SOLSPIKE_PORT: process.env.SOLSPIKE_PORT ?? "8795", CALLS: calls };
  const run = spawnSync("bash", [sh, mode], { env, encoding: "utf8", timeout: 60000 });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

const LINE = 'console.log("check: 3 tests, 2 hashed files, %s problems");\n';

test("C22 baseline.sh fails when the tool prints no result line", () => {
  const res = runBaselineSh("// the tool ran no gate and ends with exit 0\n");
  assert.notEqual(res.code, 0, res.out);
  assert.match(res.out, /printed no check result line/);
});

test("C23 baseline.sh passes when the tool says 0 problems", () => {
  const res = runBaselineSh(LINE.replace("%s", "0"));
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /check: 3 tests, 2 hashed files, 0 problems/);
});

test("C24 baseline.sh keeps the exit code of the tool", () => {
  const res = runBaselineSh(`${LINE.replace("%s", "1")}process.exit(1);\n`);
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /1 problems/);
});

test("C25 baseline.sh stops on a web test that is neither a test nor a helper", () => {
  const stray = join(SH_FIX, "web/test/sol-new.mjs");
  mkdirSync(dirname(stray), { recursive: true });
  writeFileSync(stray, "");
  try {
    const res = runBaselineSh(LINE.replace("%s", "0"));
    assert.equal(res.code, 2, res.out);
    assert.match(res.out, /web\/test\/sol-new\.mjs is neither in TESTS nor in HELPERS/);
  } finally {
    unlinkSync(stray);
  }
});

test("D5 check creates the .state folder when it is missing", () => {
  rmSync(dirname(NOW), { recursive: true, force: true });
  const res = gate("check");
  assert.equal(res.code, 0, res.out);
  assert.ok(existsSync(NOW), "baseline-now.json was not written");
});

test("M7 failed() names every test that ran and did not exit 0", () => {
  const tests = { a: { exit: 0 }, b: { exit: 2 }, c: { exit: null, skipped: "why" } };
  assert.deepEqual(failed(tests), ["failed: b"]);
});

test("M8 compare() reports an added, a removed and a changed entry of each kind", () => {
  const csp = "content-security-policy";
  const base = {
    baseCommit: "HEAD",
    tests: { a: { exit: 0 } },
    hashes: { f: "1" },
    policy: { byUrl: { u: "p" }, sourceSha256: 1 },
    served: { [csp]: "x" },
  };
  const now = {
    tests: { a: { exit: 1 } },
    hashes: { g: "1" },
    policy: { byUrl: { u: "q" }, sourceSha256: 2 },
    served: { [csp]: "y", "referrer-policy": "r" },
  };
  const wanted = [
    "test a: changed",
    "hash f: removed",
    "hash g: added",
    "policy u: changed",
    "policy source changed",
    `served ${csp}: changed`,
    "served referrer-policy: added",
  ];
  const problems = compare(base, now);
  for (const want of wanted) {
    assert.ok(problems.includes(want), `${want} is missing in ${JSON.stringify(problems)}`);
  }
});

test("S1 servedHeaders keeps the listed headers and reads names in any case", () => {
  const got = servedHeaders(HEADERS);
  assert.deepEqual(got, { "content-security-policy": CSP, "x-content-type-options": "nosniff" });
});

// The stamp of a passing run. begin starts a run, a passing record or check keeps the stamp, and
// reuse gives the exits back while the files, Node, .dev.vars, qrencode, TZ and the installed
// packages are the same, the stamp is not older than 24 h and the working tree is clean.
const STAMP = join(FIX, "solspike/.state/baseline-stamp.json");
const PENDING = join(FIX, "solspike/.state/baseline-pending.json");
const tool = (...args) => toolEnv({}, ...args);
const toolEnv = (env, ...args) => {
  const opts = { cwd: FIX, env: { ...process.env, ...env }, encoding: "utf8", timeout: 60000 };
  const run = spawnSync("node", [TOOL, ...args], opts);
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
};
const GOT = "solspike/.state/got.tsv";
const reuse = (env = {}) => toolEnv(env, "reuse", join(FIX, GOT));
const stampedRun = () => {
  assert.equal(tool("begin").code, 0);
  const res = gate("check");
  assert.equal(res.code, 0, res.out);
  assert.ok(existsSync(STAMP), "the passing run left no stamp");
};

test("C26 reuse gives back the exits of a passing run", () => {
  stampedRun();
  const res = reuse();
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /^reuse: yes, the passing run of /);
  assert.equal(read(GOT), EXITS);
});

test("C27 reuse says no for a changed file, a new file and a changed Node version", () => {
  stampedRun();
  const changed = swap("web/signed.js", "= 1", "= 2");
  changed.edit();
  assert.match(reuse().out, /^reuse: no, the working tree has changes/);
  changed.undo();
  const fresh = add("note.txt");
  fresh.edit();
  assert.match(reuse().out, /^reuse: no, the working tree has changes/);
  fresh.undo();
  assert.equal(reuse().code, 0, "control: the same files");
  const old = JSON.parse(readFileSync(STAMP, "utf8"));
  const stampWith = (key) => {
    writeFileSync(STAMP, JSON.stringify({ ...old, key: { ...old.key, ...key } }));
  };
  stampWith({ node: "v1" });
  assert.match(reuse().out, /^reuse: no, node is not the one of the stamped run/);
  stampWith({ devVars: "x" });
  assert.match(reuse().out, /^reuse: no, devVars is not the one/);
  writeFileSync(STAMP, "{");
  assert.match(reuse().out, /^reuse: no, the stamp is unreadable/);
  unlinkSync(STAMP);
  assert.match(reuse().out, /^reuse: no, there is no stamp/);
});

test("C28 begin removes the stamp; a run with a problem or on a dirty tree leaves none", () => {
  stampedRun();
  assert.equal(tool("begin").code, 0);
  assert.ok(!existsSync(STAMP), "begin keeps no stamp");
  put("solspike/.state/bad.tsv", EXITS.replace("a.mjs\t0", "a.mjs\t1"));
  assert.equal(gate("check", { exits: "solspike/.state/bad.tsv" }).code, 1);
  assert.ok(!existsSync(STAMP), "a failing run left a stamp");
  assert.ok(!existsSync(PENDING), "a failing run left the pending file");
  const note = add("note.txt");
  note.edit();
  assert.equal(tool("begin").code, 0);
  assert.equal(gate("check").code, 0, "the untracked file is no problem of the gate");
  assert.ok(!existsSync(STAMP), "a run on a dirty tree left a stamp");
  note.undo();
});

test("C29 a commit that only records the baseline keeps the stamp valid", () => {
  stampedRun();
  const text = read("solspike/baseline.json");
  put("solspike/baseline.json", text.replace('"node"', '"node" '));
  assert.equal(reuse().code, 0, "the record in the working tree is no change");
  const who = ["user.name=t", "user.email=t@example.invalid", "commit.gpgsign=false"];
  git("add", "-f", "solspike/baseline.json");
  git(...who.flatMap((c) => ["-c", c]), "commit", "-q", "-m", "record");
  const res = reuse();
  assert.equal(res.code, 0, res.out);
  assert.equal(gate("check").code, 0, "the base commit is an ancestor of the new HEAD");
});

const HOUR = 3600 * 1000;
const restamp = (change) => {
  const old = JSON.parse(readFileSync(STAMP, "utf8"));
  writeFileSync(STAMP, JSON.stringify({ ...old, ...change }));
};

test("C34 reuse says no for a stamp older than 24 h or with a date that is no date", () => {
  stampedRun();
  const ago = (hours) => new Date(Date.now() - hours * HOUR).toISOString();
  const old = /^reuse: no, the stamp is older than 24 h/;
  restamp({ at: ago(23) });
  assert.equal(reuse().code, 0, "control: a stamp of 23 h");
  restamp({ at: ago(25) });
  assert.match(reuse().out, old);
  restamp({ at: "yesterday" });
  assert.match(reuse().out, old);
  restamp({ at: undefined });
  assert.match(reuse().out, old);
});

const MODULES = ["cf", "solspike", "solspike/tools"].map(
  (dir) => `${dir}/node_modules/.package-lock.json`,
);
// The folders of node_modules are ignored by git, so a file that a failed run left stays.
const clearLocks = () => MODULES.forEach((rel) => rmSync(join(FIX, rel), { force: true }));

test("C35 reuse says no for a new, a changed and a removed .package-lock.json", () => {
  const packages = /^reuse: no, packages is not the one of the stamped run/;
  clearLocks();
  try {
    stampedRun();
    assert.equal(reuse().code, 0, "control: the same packages");
    for (const rel of MODULES) {
      put(rel, "lock A\n");
      assert.match(reuse().out, packages, `${rel}: a file where the stamped run had none`);
      stampedRun();
      assert.equal(reuse().code, 0, `${rel}: control: the same packages`);
      put(rel, "lock B\n");
      assert.match(reuse().out, packages, `${rel}: a changed file`);
      unlinkSync(join(FIX, rel));
      assert.match(reuse().out, packages, `${rel}: a removed file`);
      stampedRun();
    }
  } finally {
    clearLocks();
  }
});

test("C36 reuse says no when TZ is not the TZ of the stamped run", () => {
  assert.equal(toolEnv({ TZ: "UTC" }, "begin").code, 0);
  assert.equal(gate("check", { env: { TZ: "UTC" } }).code, 0);
  assert.equal(reuse({ TZ: "UTC" }).code, 0, "control: the same TZ");
  assert.match(reuse({ TZ: "Asia/Tokyo" }).out, /^reuse: no, tz is not the one of the stamped/);
});

const REUSING = (verdict) => `
import { appendFileSync } from "node:fs";
const [mode] = process.argv.slice(2);
appendFileSync(process.env.CALLS, mode + "\\n");
if (mode === "reuse") console.log("reuse: ${verdict}");
if (mode === "check" || mode === "record") {
  console.log(mode + ": 3 tests, 2 hashed files, 0 problems");
}
`;
const MARK = () => join(SH_FIX, "ran.txt");
const RAN = {
  "web/test/chat.mjs": `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(MARK())}, "x");
`,
};

function shRun(verdict, mode = "check") {
  rmSync(MARK(), { force: true });
  rmSync(join(SH_FIX, "calls.log"), { force: true });
  const res = runBaselineSh(REUSING(verdict), { extra: RAN, mode });
  const calls = readFileSync(join(SH_FIX, "calls.log"), "utf8");
  return { ...res, ran: existsSync(MARK()), calls };
}

test("C30 baseline.sh check runs no test when the tool reuses a run", () => {
  const res = shRun("yes, the run of today");
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /baseline: reuse: yes, the run of today/);
  assert.match(res.out, /check: 3 tests, 2 hashed files, 0 problems/);
  assert.equal(res.ran, false, "a test ran");
  const again = "reuse\nserve start\nserve stop\ncheck\n";
  assert.equal(res.calls, again, "the headers are read from the server again");
});

test("C31 baseline.sh check runs every test when the tool does not reuse a run", () => {
  const res = shRun("no, there is no stamp");
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /baseline: reuse: no, there is no stamp/);
  assert.equal(res.ran, true, "the test did not run");
  assert.equal(res.calls, "reuse\nbegin\nserve start\nserve stop\ncheck\n");
});

test("C32 baseline.sh record never reuses a run", () => {
  const res = shRun("yes, the run of today", "record");
  assert.equal(res.code, 0, res.out);
  assert.equal(res.ran, true, "the test did not run");
  assert.equal(res.calls, "begin\nserve start\nserve stop\nrecord\n");
});

test("C33 baseline.sh writes one exits line for each test, in the order of TESTS", () => {
  const res = shRun("no, there is no stamp");
  assert.equal(res.code, 0, res.out);
  const exits = readFileSync(join(SH_FIX, "solspike/.state/baseline-exits.tsv"), "utf8");
  const names = exits.trim().split("\n").map((line) => line.split("\t")[0]);
  assert.equal(new Set(names).size, names.length, "one line for each test");
  assert.deepEqual(names.slice(-2), ["cf/test/gate.mjs", "cf/test/limits.mjs"]);
  assert.ok(names.indexOf("web/test/chat.mjs") < names.indexOf("web/test/signed.mjs"));
  assert.ok(names.indexOf("web/test/sol-ceremony.mjs") < names.indexOf("web/test/sol-pay.mjs"));
});
