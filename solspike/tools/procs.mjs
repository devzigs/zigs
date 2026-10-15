// Counts the processes of a run: the root PIDs and all their descendants by parent PID.
// trackPeak() records the highest count while it runs. A process counts only when it is alive and
// does real work for the run. These do not count:
//   - a zombie (ps state Z): it has exited and waits for its parent to read its status, as a
//     Chrome helper does for a moment after it ends;
//   - the ps that does the sampling: it is a child of this process while it reads the table;
//   - the shells and lockf above this process (wrappersAbove): the caller owns them and their
//     number depends on how the caller started the run. The peak reports them in its own field,
//     and the total of both stays visible there.
// Usage: node tools/procs.mjs PID [PID ...]
// newInGroup() finds the processes that outlive their parent: an orphan has parent PID 1, so a
// walk down from the roots cannot see it, but it keeps its process group. It sees every process
// of the group, a zombie too.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const WRAPPERS = new Set(["lockf", "bash", "sh", "zsh"]);

// pid ppid pgid stat lstart comm, for example "123 1 123 S Wed Oct 14 22:18:37 2026 /bin/sleep".
// ps prints lstart in the locale and the time zone of its caller, so ps always runs as C and UTC.
const ROW =
  /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]{8}\s+\d{4})\s+(.*)$/;

function table() {
  const rows = new Map();
  const out = execFileSync("ps", ["-A", "-o", "pid=,ppid=,pgid=,stat=,lstart=,comm="], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
  });
  for (const line of out.split("\n")) {
    const m = ROW.exec(line);
    if (!m) continue;
    const start = m[5].replace(/\s+/g, " ");
    const row = { ppid: Number(m[2]), pgid: Number(m[3]), stat: m[4], start, comm: basename(m[6]) };
    rows.set(Number(m[1]), row);
  }
  if (!rows.has(process.pid)) throw new Error("ps -A has no readable row for this process");
  return rows;
}

function childrenOf(rows) {
  const kids = new Map();
  for (const [pid, { ppid }] of rows) kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
  return kids;
}

function wrapperPids(rows) {
  const found = [];
  let p = rows.get(process.pid)?.ppid;
  while (WRAPPERS.has(rows.get(p)?.comm)) {
    found.push(p);
    p = rows.get(p).ppid;
  }
  return found;
}

// The ps that reads the table is a child of this process, and the table lists it.
const sampler = (row) => row.comm === "ps" && row.ppid === process.pid;
const isZombie = (row) => row.stat.startsWith("Z");

/** The roots that exist in `rows` and every process below them, by parent PID. */
function below(rows, roots) {
  const kids = childrenOf(rows);
  const found = new Set();
  const add = (pid) => {
    if (found.has(pid) || !rows.has(pid)) return;
    found.add(pid);
    (kids.get(pid) ?? []).forEach(add);
  };
  roots.filter(Boolean).forEach(add);
  return found;
}

const named = (rows, pids) => new Map([...pids].map((pid) => [pid, rows.get(pid).comm]));

/** A Map pid -> command name of the roots and the live processes below them (see the header). */
export function ownProcesses(roots) {
  const rows = table();
  const real = [...below(rows, roots)].filter((pid) => {
    const row = rows.get(pid);
    return !isZombie(row) && !sampler(row);
  });
  return named(rows, real);
}

/** A Map pid -> command name of the shells and lockf above this process. They do not count. */
export function wrappersAbove() {
  const rows = table();
  return named(rows, wrapperPids(rows));
}

/** { name: count } of a process map, most frequent first. */
export function byName(own) {
  const counts = {};
  for (const name of own.values()) counts[name] = (counts[name] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

const key = (pid, row) => `${pid} ${row.start}`;

/** The PID of every live process of a process group. A test uses it to stop what it started. */
export function groupPids(pgid) {
  return [...table()].filter(([, row]) => row.pgid === pgid).map(([pid]) => pid);
}

/** The process group of this process. Node has no getpgrp(). */
export const ownGroup = () => table().get(process.pid).pgid;

/** Identities ("PID START") of the live processes of a group. The start time tells a PID apart
 * from a later process that reuses it. */
export function groupSnapshot(pgid = ownGroup()) {
  return new Set([...table()].filter(([, r]) => r.pgid === pgid).map(([pid, r]) => key(pid, r)));
}

/**
 * The processes of a group that are alive, not in `before` (so they started after the snapshot)
 * and left behind: [{ pid, comm }]. A process is left behind when its parent is gone (parent
 * PID 1) or when it is one of the `roots` or below one of them (the Chrome and the server that
 * the caller stopped). A live child of the caller is not counted, and neither are the caller,
 * its ancestors (the shells, lockf, a test runner) and the ps that does the sampling.
 */
export function newInGroup(before, { pgid = ownGroup(), roots = [] } = {}) {
  const rows = table();
  const stack = below(rows, roots);
  const skip = new Set([process.pid]);
  for (let p = rows.get(process.pid)?.ppid; rows.has(p) && !skip.has(p); p = rows.get(p).ppid) {
    skip.add(p);
  }
  const leftBehind = (pid, row) => row.ppid === 1 || !rows.has(row.ppid) || stack.has(pid);
  return [...rows]
    .filter(([pid, row]) => row.pgid === pgid && !skip.has(pid) && !sampler(row))
    .filter(([pid, row]) => !before.has(key(pid, row)) && leftBehind(pid, row))
    .map(([pid, row]) => ({ pid, comm: row.comm }));
}

/**
 * Samples every `ms`. getRoots() returns the current root PIDs. stop() returns the peak: the
 * highest count of ownProcesses, its names, the wrappers above this process by name, and the
 * `total` of the peak and the wrappers (the count of every process of this run, shells too).
 */
export function trackPeak(getRoots, ms = 250) {
  let peak = new Map();
  const sample = () => {
    const own = ownProcesses(getRoots());
    if (own.size > peak.size) peak = own;
  };
  sample();
  const timer = setInterval(sample, ms);
  return {
    stop() {
      clearInterval(timer);
      sample();
      const wrappers = wrappersAbove();
      return {
        peak: peak.size,
        byName: byName(peak),
        wrappers: byName(wrappers),
        total: peak.size + wrappers.size,
      };
    },
  };
}

// True when node started this file, also through a symlink or a path in another case: node
// resolves import.meta.url and keeps argv[1] as typed.
const isMain = () => {
  try {
    const real = realpathSync.native;
    return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isMain()) {
  const own = ownProcesses(process.argv.slice(2).map(Number));
  console.log(JSON.stringify({ count: own.size, byName: byName(own) }));
}
