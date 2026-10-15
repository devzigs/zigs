// The subjects of harness.test.mjs. Each scenario runs in a process of its own, so that a hang
// is a result of the test and not a hang of the test. Usage: node test/harness-child.mjs NAME
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { launch, sleep } from "../harness/chrome.mjs";
import { startRig } from "../harness/rig.mjs";
import { withStack } from "../harness/stack.mjs";
import { groupSnapshot, ownGroup, ownProcesses, trackPeak } from "../tools/procs.mjs";

const quick = { server: false, backstopMs: 1500 };
// A process that outlives its parent: sh ends at once, the sleep keeps the group of this process.
const orphan = async () => {
  spawn("sh", ["-c", "sleep 60 & exit"], { stdio: "ignore" });
  await new Promise((ok) => setTimeout(ok, 500));
};
// A listener that nobody closes keeps the process alive.
const leak = async () => {
  createServer().listen(0, "127.0.0.1");
};

// A run with no fault. The CDP socket outlives its connect wait (4000 ms): a timer of the connect
// that is not cleared closes the socket, and the body fails.
const clean = async (rig) => {
  await sleep(4500);
  await rig.contextIds();
};
// Reads the process table. procs.mjs throws when it cannot read the ps output.
const table = async () => {
  const members = groupSnapshot().size;
  const own = ownProcesses([process.pid]).size;
  if (!ownGroup() || !members || !own) throw new Error("the process table has no row for us");
  console.log(JSON.stringify({ members, own }));
};

// The peak of this process with a sleeping child and a zombie below it: `sleep 0` ends at once
// and its parent, the exec'd sleep 30, never reads its status. The test starts this scenario
// under a shell, so one wrapper sits above. Only the process and the sleeping child are real.
const count = async () => {
  const kid = spawn("sh", ["-c", "sleep 0 & exec sleep 30"], { stdio: "ignore" });
  await sleep(500);
  const result = trackPeak(() => [process.pid]).stop();
  await new Promise((ok) => {
    kid.once("exit", ok);
    kid.kill("SIGTERM");
  });
  console.log(JSON.stringify(result));
};

const SCENARIOS = {
  launch: () => launch(1500),
  rig: () => startRig("t-rig", 1500),
  leak: () => withStack("t-leak", leak, quick),
  orphan: () => withStack("t-orphan", orphan, quick),
  clean: () => withStack("t-clean", clean, { ...quick, chromeWaitMs: 4000 }),
  procs: table,
  count,
};

const scenario = SCENARIOS[process.argv[2]];
if (!scenario) throw new Error(`unknown scenario ${process.argv[2]}`);
scenario().then(
  () => console.log("scenario ok"),
  (err) => {
    console.error(err.message);
    process.exitCode = 1;
  },
);
