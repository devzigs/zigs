// Page side of the Solana Worker: starts /sol/worker.js, sends one request at a time by id and
// returns the answer. It never reads, stores or logs the Helius URL: the caller passes it in the
// init request, and every error text of the Worker is already redacted there.

const NO_GATE = "This page could not read how the group proves, so nothing was proved.";

/**
 * Starts the Worker. call(cmd, args) resolves with the result or rejects with an Error. After
 * close() or a Worker error, every pending and every later call rejects: nothing waits forever.
 * Before each prove call the Worker asks the page how the group proves (SOL-4): `onGate()`
 * resolves with { mode: "local" }, { mode: "hosted" } or { refuse: text }.
 */
export function startSolWorker(url = "/sol/worker.js", onGate = undefined) {
  const worker = new Worker(url, { type: "module" });
  const waiting = new Map();
  let last = 0;
  let ended = null;
  const failAll = (text) => {
    ended = text;
    for (const { bad } of waiting.values()) bad(new Error(text));
    waiting.clear();
  };
  const answerGate = async (gate) => {
    let answer;
    try {
      answer = (await onGate?.()) ?? { refuse: NO_GATE };
    } catch (e) {
      answer = { refuse: String(e?.message ?? e) };
    }
    worker.postMessage({ gate, mode: answer.mode, refuse: answer.refuse });
  };
  worker.onmessage = ({ data }) => {
    if (typeof data?.gate === "number") return void answerGate(data.gate);
    const entry = waiting.get(data?.id);
    if (entry === undefined) return;
    waiting.delete(data.id);
    if (data.ok) entry.ok(data.result);
    else entry.bad(new Error(data.error));
  };
  worker.onerror = (event) => {
    event.preventDefault();
    failAll("The Solana worker failed");
  };
  return {
    call: (cmd, args = {}) =>
      new Promise((ok, bad) => {
        if (ended !== null) return bad(new Error(ended));
        last += 1;
        waiting.set(last, { ok, bad });
        worker.postMessage({ id: last, cmd, args });
      }),
    close() {
      worker.terminate();
      failAll("The Solana worker was closed");
    },
  };
}
