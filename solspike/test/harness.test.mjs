// Tests of the harness itself.
// Usage: lockf -k "$SOL/heavy.lock" node --test-timeout=60000 solspike/test/harness.test.mjs
// Each test names the defect that it guards (D1 to D3, the orphan check, the exit backstop, the
// timers T, the process table P). Three tests start a real headless Chrome. A subject that hangs
// fails its test: it runs in a child process under a time limit (tools/bounded.mjs), and the
// group of that child is stopped by PID.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runBounded } from "../tools/bounded.mjs";
import { groupSnapshot, newInGroup, ownProcesses } from "../tools/procs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPIKE = resolve(HERE, "..");
const FAKE_CHROME = join(HERE, "fake-chrome.mjs");
const CHILD = join(HERE, "harness-child.mjs");
const TMP = join(SPIKE, ".state/tmp");

const subject = (scenario, env = {}, ms = 40000) =>
  runBounded("node", [CHILD, scenario], { ms, env });

const fakeChrome = (mode) => ({ SOLSPIKE_CHROME: FAKE_CHROME, FAKE_CHROME_MODE: mode });

function assertEndedAlone(res, code = 1) {
  assert.equal(res.timedOut, false, `the subject did not end by itself:\n${res.output}`);
  assert.equal(res.code, code, res.output);
  assert.deepEqual(res.strays, [], "processes were left behind");
}

test("D1 launch: a Chrome that never opens its port is stopped", async () => {
  const res = await subject("launch", fakeChrome("hang"));
  assertEndedAlone(res);
  assert.match(res.output, /timeout waiting for the Chrome debugging port/);
  assert.match(res.output, /\(Chrome stopped by SIGTERM\)/);
});

test("D1 launch: a Chrome that ignores SIGTERM gets SIGKILL", async () => {
  const res = await subject("launch", fakeChrome("stubborn"));
  assertEndedAlone(res);
  assert.match(res.output, /Chrome SIGKILL to own pid/);
});

test("D1 launch: a Chrome that exits at once is reported", async () => {
  const res = await subject("launch", fakeChrome("exit"));
  assertEndedAlone(res);
  assert.match(res.output, /Chrome exited with code 3 \(Chrome had exited\)/);
});

test("D1 rig: a Chrome that cannot be driven is stopped before the error goes up", async () => {
  const res = await subject("rig", fakeChrome("badws"));
  assertEndedAlone(res);
  assert.match(res.output, /CDP connection failed.*\(Chrome stopped by SIGTERM\)/);
});

test("D1 rig: a Chrome whose CDP handshake never finishes is stopped", async () => {
  const res = await subject("rig", fakeChrome("slowws"));
  assertEndedAlone(res);
  assert.match(res.output, /CDP connection: no answer in 1500 ms \(Chrome stopped by SIGTERM\)/);
});

test("D1 launch: a debugging port that accepts and never answers is bounded", async () => {
  const res = await subject("launch", fakeChrome("mute"));
  assertEndedAlone(res);
  assert.match(res.output, /timeout waiting for the Chrome debugging port.*Chrome stopped/);
  assert.ok(res.ms < 5000, `ended after ${res.ms} ms`);
});

test("T1 timers: a failed launch ends with the Chrome, not 5 s later", async () => {
  const res = await subject("launch", fakeChrome("hang"));
  assertEndedAlone(res);
  assert.ok(res.ms < 4000, `ended after ${res.ms} ms, a grace timer is still pending`);
});

test("T2 timers: a clean run exits 0 at once, its socket outlives the wait", async () => {
  const res = await subject("clean");
  assertEndedAlone(res, 0);
  assert.doesNotMatch(res.output, /stack: still running/);
  const notes = JSON.parse(res.output.split("\n").find((l) => l.startsWith('{"label":"t-clean"')));
  assert.equal(notes.leftProcesses, 0, JSON.stringify(notes));
});

test("D2 backstop: a run with an open handle ends by itself with exit code 1", async () => {
  const res = await subject("leak");
  assertEndedAlone(res);
  assert.match(res.output, /stack: still running 1500 ms after cleanup/);
});

test("O1 orphans: withStack fails a run that leaves a process whose parent is gone", async () => {
  const res = await subject("orphan");
  assert.equal(res.timedOut, false, res.output);
  assert.equal(res.code, 1, res.output);
  assert.doesNotMatch(res.output, /stack: still running/, "exit 1 must not come from the backstop");
  const notes = JSON.parse(res.output.split("\n").find((l) => l.startsWith('{"label":"t-orphan"')));
  assert.equal(notes.leftProcesses, 1, JSON.stringify(notes));
  assert.match(notes.left[0], / sleep$/);
  assert.equal(res.strays.length, 1, "the runner stops the orphan by PID");
});

// A sleep whose parent has ended: init owns it, so nobody has to reap it. `leader` is the PID of
// the group that it started in (detached) and that is gone.
async function startOrphan(seconds, detached = false) {
  // The sleep must not hold the pipe, or the close event waits for the sleep.
  const sh = spawn("sh", ["-c", `sleep ${seconds} >/dev/null 2>&1 & echo $!`], {
    detached,
    stdio: ["ignore", "pipe", "ignore"],
  });
  let text = "";
  sh.stdout.on("data", (c) => (text += c));
  await new Promise((ok) => sh.once("close", ok));
  return { leader: sh.pid, pid: Number(text.trim()) };
}

test("O2 orphans: the group sees what a walk down from the root cannot see", async () => {
  const { leader, pid } = await startOrphan(30, true);
  try {
    assert.equal(ownProcesses([leader]).size, 0, "the old count is blind to it");
    assert.deepEqual(newInGroup(new Set(), { pgid: leader }).map((p) => p.pid), [pid]);
    const seen = groupSnapshot(leader);
    assert.deepEqual(newInGroup(seen, { pgid: leader }), [], "a snapshot member is old");
    const own = newInGroup(new Set()).map((p) => p.pid);
    assert.ok(!own.includes(process.pid) && !own.includes(process.ppid), "caller and parent");
  } finally {
    process.kill(pid, "SIGTERM");
  }
});

test("O3 orphans: a live child of the caller is not left behind, a stopped root is", () => {
  const before = groupSnapshot();
  const kid = spawn("sleep", ["30"], { stdio: "ignore" });
  try {
    assert.deepEqual(newInGroup(before), [], "a live child of the caller was counted");
    const roots = newInGroup(before, { roots: [kid.pid] }).map((p) => p.pid);
    assert.deepEqual(roots, [kid.pid], "a root that is still alive after the stop is missed");
  } finally {
    kid.kill("SIGTERM");
  }
});

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// P1 and P2: procs.mjs reads ps, and ps prints the start time in the locale of its caller.
test("P1 procs.mjs: the process table does not depend on locale or time zone", async (t) => {
  const env = { LC_ALL: "fr_FR.UTF-8", TZ: "America/New_York" };
  const args = ["-p", String(process.pid), "-o", "lstart="];
  const raw = execFileSync("ps", args, { env: { ...process.env, ...env }, encoding: "utf8" });
  if (/^[A-Z][a-z]{2} [A-Z][a-z]{2} /.test(raw)) {
    t.skip("ps prints English: fr_FR.UTF-8 is not installed");
    return;
  }
  const res = await subject("procs", env, 20000);
  assertEndedAlone(res, 0);
  assert.match(res.output, /"members":[1-9]/);
});

test("P2 procs.mjs: the command line runs through a symlink", () => {
  mkdirSync(TMP, { recursive: true });
  const link = join(TMP, `procs-link-${process.pid}.mjs`);
  symlinkSync(join(SPIKE, "tools/procs.mjs"), link);
  try {
    const out = execFileSync("node", [link, String(process.pid)], { encoding: "utf8" });
    assert.match(out, /^\{"count":[1-9]/);
  } finally {
    unlinkSync(link);
  }
});

// P3: the peak counts the live processes of the run. The scenario runs under a shell: that shell,
// the sampling ps and a zombie below the process are real rows of the table, and none of them
// counts. The shell is a wrapper, listed next to the peak and in the total.
test("P3 procs.mjs: the peak has no sampling ps, no shell above and no zombie", async () => {
  const res = await runBounded("sh", ["-c", 'node "$0" count; code=$?; exit $code', CHILD], {
    ms: 20000,
  });
  assertEndedAlone(res, 0);
  const line = res.output.split("\n").find((l) => l.startsWith('{"peak"'));
  assert.ok(line, `the scenario printed no peak:\n${res.output}`);
  const { peak, byName, wrappers, total } = JSON.parse(line);
  assert.ok(!("ps" in byName), `the sampling ps was counted: ${line}`);
  assert.ok(!("sh" in byName), `a shell above the process was counted: ${line}`);
  assert.equal(peak, 2, `a zombie was counted, or the child was not: ${line}`);
  assert.deepEqual(wrappers, { sh: 1 }, line);
  assert.equal(total, 3, line);
});

// D3: serve.sh signals a process only when it is the wrangler dev server of this clone: its
// command line and its directory match. Two fixtures: one has no cf/ (start stops at once), the
// other has fake wranglers in cf/ and in other/ (a stand-in that only sits and waits).
const PORT = process.env.SOLSPIKE_PORT ?? "8795";
const STOP_ROOT = join(TMP, "serve-fixture");
const LIVE_ROOT = join(TMP, "serve-live");
const PIDFILE = (root) => join(root, "solspike/.state/serve.pid");
const FOREIGN = { LC_ALL: "fr_FR.UTF-8", TZ: "America/New_York" };

function serve(root, cmd, env = {}) {
  const sh = join(root, "solspike/serve.sh");
  const full = { ...process.env, SOLSPIKE_PORT: PORT, ...env };
  const res = spawnSync("bash", [sh, cmd], { env: full, encoding: "utf8", timeout: 30000 });
  return `${res.stdout}${res.stderr}`;
}

function pidFixture(root, text) {
  mkdirSync(join(root, "solspike/.state"), { recursive: true });
  copyFileSync(join(SPIKE, "serve.sh"), join(root, "solspike/serve.sh"));
  writeFileSync(PIDFILE(root), text);
}

const command = (pid) =>
  spawnSync("ps", ["-ww", "-o", "command=", "-p", String(pid)], { encoding: "utf8" }).stdout;

// Starts a fake wrangler in LIVE_ROOT/<dir> with the command line of the real one, and returns
// its PID once ps shows that command line (before the exec, ps shows the shell).
async function startFake({ dir = "cf", port = PORT } = {}) {
  const home = join(LIVE_ROOT, dir);
  const cli = join(home, "node_modules/wrangler/wrangler-dist/cli.js");
  mkdirSync(dirname(cli), { recursive: true });
  writeFileSync(cli, "setInterval(() => {}, 1000);\n");
  const script = `(cd "$0" && exec node --no-warnings node_modules/wrangler/wrangler-dist/cli.js \
    dev --local --port "$1" --inspector-port 0) >/dev/null 2>&1 & echo $!`;
  const stdio = ["ignore", "pipe", "ignore"];
  const sh = spawn("sh", ["-c", script, home, String(port)], { stdio });
  let text = "";
  sh.stdout.on("data", (c) => (text += c));
  await new Promise((ok) => sh.once("close", ok));
  const pid = Number(text.trim());
  for (let i = 0; i < 100 && !command(pid).includes("wrangler-dist"); i += 1) await sleep(50);
  assert.ok(command(pid).includes("wrangler-dist"), "the fake wrangler did not start");
  return pid;
}

test("D3 serve.sh: a pid file that names no server of this clone is stale", async () => {
  const sleeper = await startOrphan(120);
  const pids = [sleeper.pid, await startFake({ dir: "other" }), await startFake({ port: "1" })];
  try {
    const old = `${pids[0]} Mon Jan  1 00:00:00 2001\n`;
    const entries = [...pids.map((p) => `${p}\n`), old, "", "x\n"];
    for (const entry of entries) {
      pidFixture(LIVE_ROOT, entry);
      assert.match(serve(LIVE_ROOT, "status", FOREIGN), /stopped/);
      assert.match(serve(LIVE_ROOT, "stop", FOREIGN), /stale pid file/);
      assert.ok(!existsSync(PIDFILE(LIVE_ROOT)), "the stale pid file is removed");
      assert.ok(pids.every(alive), `stop signalled a foreign process (${entry.trim()})`);
      pidFixture(STOP_ROOT, entry);
      assert.doesNotMatch(serve(STOP_ROOT, "start"), /already running/);
      assert.ok(pids.every(alive), "start signalled a foreign process");
    }
  } finally {
    pids.filter(alive).forEach((pid) => process.kill(pid, "SIGTERM"));
  }
});

test("D3 serve.sh: the wrangler of this clone is found by command line and directory", async () => {
  const pid = await startFake();
  pidFixture(LIVE_ROOT, `${pid}\n`);
  try {
    for (const env of [{}, FOREIGN]) {
      assert.match(serve(LIVE_ROOT, "status", env), new RegExp(`running pid ${pid}`));
    }
    assert.match(serve(LIVE_ROOT, "start", FOREIGN), /already running/);
    assert.match(serve(LIVE_ROOT, "stop", FOREIGN), new RegExp(`stopped \\(pid ${pid}`));
    for (let i = 0; i < 50 && alive(pid); i += 1) await sleep(100);
    assert.ok(!alive(pid), "the server is still alive");
    assert.ok(!existsSync(PIDFILE(LIVE_ROOT)), "the pid file is removed");
  } finally {
    if (alive(pid)) process.kill(pid, "SIGTERM");
  }
});
