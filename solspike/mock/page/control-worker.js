// A control Worker. It is served like the product Worker, so it runs under the same policy, and it
// tries what a hostile or broken Worker could try. Each call must be blocked, except the one to the
// mock server when the policy names it. The page records the outcomes.
const reason = (e) => `${e?.name ?? "Error"}: ${e?.message ?? e}`;
const attempt = (fn) =>
  Promise.resolve()
    .then(fn)
    .then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: reason(error) }),
    );

self.onmessage = async ({ data }) => {
  const tries = {
    // oxlint-disable-next-line no-eval -- deliberate CSP control: this call must be blocked
    eval: () => (0, eval)("1+1"),
    newFunction: () => new Function("return 1")(),
    fetchDecoy: () => fetch(`${data.decoy}/ping`).then((r) => r.status),
    importDecoy: () => import(`${data.decoy}/m.js`).then(() => "loaded"),
    fetchOther: () => fetch("http://zigs-control.invalid/ping").then((r) => r.status),
    fetchMock: () => fetch(`${data.mock}/ping`).then((r) => r.status),
  };
  for (const [name, fn] of Object.entries(tries)) {
    self.postMessage({ type: "control", name, ...(await attempt(fn)) });
  }
  await new Promise((done) => setTimeout(done, 300));
  self.postMessage({ type: "done" });
};
