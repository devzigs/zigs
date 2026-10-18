// The stack of a live check: the dev server, one Chrome (rig) and a peak process count.
// withStack(label, body) starts them, runs body(rig), and always stops everything by PID. It
// prints one JSON line with what it started, how each part stopped, the peak process count
// and the processes that were left (must be 0). The peak counts the live processes of this run
// (this process, the server and Chrome, and all below them). It does not count zombies, the
// sampling ps or the shells above (tools/procs.mjs). The line lists those shells as `wrappers`
// and gives the sum as `total`. The cap of 16 applies to the peak. A left process is a new member
// of the process group of this run that lost its parent, or that is still Chrome or the server.
// A run that does not end by itself, because a handle stays open, is ended by a backstop: it
// must not hold heavy.lock. Call withStack once per process.
import { createServer } from "node:net";
import { startRig } from "./rig.mjs";
import { PORT, serverPid, startServer, stopServer } from "./server.mjs";
import { groupSnapshot, newInGroup, trackPeak } from "../tools/procs.mjs";

const PROCESS_CAP = 16;
// Idle keep-alive sockets of fetch() close after about 4 s, so a clean run ends well before this.
const BACKSTOP_MS = 12000;

const portOpen = (port) =>
  new Promise((ok) => {
    const probe = createServer();
    probe.once("error", () => ok(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => ok(true)));
  });

// A failing stop is recorded and must not keep the other parts running.
const attempt = async (stop) => {
  try {
    return await stop();
  } catch (err) {
    return `failed: ${err.message}`;
  }
};

async function stopAll(rig, notes, server, before) {
  const roots = [rig?.chrome.pid, serverPid()];
  notes.chrome = rig ? await attempt(() => rig.close()) : "not started";
  notes.server = server ? await attempt(() => stopServer()) : "not started";
  const left = newInGroup(before, { roots });
  notes.leftProcesses = left.length;
  if (left.length) notes.left = left.map((p) => `${p.pid} ${p.comm}`);
  // A run with no dev server does not own its port: another track may serve there.
  notes.portsFree = (!server || (await portOpen(PORT)))
    && (!rig || (await portOpen(rig.chrome.port)));
}

const runFailed = (n) =>
  [n.chrome, n.server].some((part) => part.startsWith("failed")) ||
  n.processes.peak > PROCESS_CAP ||
  n.leftProcesses > 0 ||
  !n.portsFree;

// An unref'd timer does not keep the process alive. It fires only if something else does.
function armBackstop(ms) {
  setTimeout(() => {
    const open = process.getActiveResourcesInfo();
    console.error(`stack: still running ${ms} ms after cleanup: ${open}`);
    process.exit(1);
  }, ms).unref();
}

// options.server = false runs Chrome alone: the mock scenarios use their own local servers.
export async function withStack(label, body, opts = {}) {
  const { server = true, backstopMs = BACKSTOP_MS, chromeWaitMs } = opts;
  let rig = null;
  const before = groupSnapshot();
  const notes = { label, cap: PROCESS_CAP };
  const tracker = trackPeak(() => [process.pid, serverPid(), rig?.chrome.pid]);
  try {
    notes.start = server ? startServer() : "no dev server";
    rig = await startRig(label, chromeWaitMs);
    notes.chromeVersion = rig.chrome.version;
    return await body(rig);
  } finally {
    await stopAll(rig, notes, server, before);
    notes.processes = tracker.stop();
    console.log(JSON.stringify(notes));
    armBackstop(backstopMs);
    if (runFailed(notes)) process.exitCode = 1;
  }
}
