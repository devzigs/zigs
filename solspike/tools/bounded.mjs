// Runs a command with a time limit, in a process group of its own. When the time is up, and
// when the command ends and leaves processes behind, every process of the group is stopped by
// PID (SIGTERM, then SIGKILL for a confirmed survivor). A child that outlives its parent must
// not keep heavy.lock. Never use this for a command that has to keep running.
import { spawn } from "node:child_process";
import { groupPids } from "./procs.mjs";

const TERM_GRACE_MS = 3000;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const signal = (pid, sig) => {
  try {
    process.kill(pid, sig);
  } catch {
    // The process ended between the listing and the signal.
  }
};

/** Stops the processes of a group by PID. Returns the PIDs that it found. */
export async function stopGroup(pgid) {
  const found = groupPids(pgid);
  found.forEach((pid) => signal(pid, "SIGTERM"));
  for (let waited = 0; waited < TERM_GRACE_MS && groupPids(pgid).length; waited += 100) {
    await sleep(100);
  }
  groupPids(pgid).forEach((pid) => signal(pid, "SIGKILL"));
  return found;
}

/**
 * Runs cmd with args. Resolves { code, signal, timedOut, ms, output, strays }: `output` is
 * stdout and stderr together, `strays` the PIDs of the group that were still alive at the end.
 */
export function runBounded(cmd, args, { ms, env = {}, cwd = process.cwd() }) {
  return new Promise((done) => {
    const began = Date.now();
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => chunks.push(c));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void stopGroup(child.pid);
    }, ms);
    // An orphan may keep the pipes open, so the end is the exit event and not the close event.
    child.once("exit", async (code, sig) => {
      clearTimeout(timer);
      await sleep(150);
      child.stdout.destroy();
      child.stderr.destroy();
      const strays = await stopGroup(child.pid);
      const output = Buffer.concat(chunks).toString("utf8");
      done({ code, signal: sig, timedOut, ms: Date.now() - began, output, strays });
    });
  });
}
