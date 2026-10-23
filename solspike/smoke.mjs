// The read-only browser smoke check of staging (S19 of the hackathon release work). The demo goal
// says "no console errors", and solspike/demo-check.sh checks HTTP answers only. This script opens
// the app in headless Chrome, in a fresh browser context, and prints PASS or FAIL for each check:
// - the page and the engine load, and the Tor demo popup of a first visit is turned down the way
//   a person does it (two clicks), so the rest runs on the page that a person uses;
// - every network picker on the page (the create dialog "Set up your wallet", and the personal
//   account form when it shows) shows Testnet only, with no tick (M1). The dialog draws all its
//   steps at once and hides all but one, so the picker of its third step is in the page without a
//   walk through the passkey step; the check opens the dialog and closes it with its × button;
// - the Solana part loads: /sol/config.json answers, the Solana Worker of the page starts, and it
//   answers a command that does not exist with "unknown command". The Solana tab itself needs a
//   wallet, and a new wallet is a write, so the check stops there;
// - the group server link (S1) goes from connecting, with the status line shown, to open, with
//   the line hidden, for the probe id of solspike/tools/demo-check.mjs;
// - no console error, page error, CSP violation, or failed or refused request of the origin.
// It creates no wallet and sends nothing to a chain. The only write to the group server can come
// from the first socket ever for the probe id: the server then makes an empty store for it, as for
// demo-check, which uses the same id.
// The password comes from SMOKE_PASSWORD_FILE (default ~/.config/zigs/staging-password). It goes
// to Chrome over the debugging socket only, as the answer to the password prompt of SMOKE_ORIGIN
// (default https://staging.zigs.app, which must be https). It is never printed, never in argv and
// never sent to another host. Exit codes: 0 all pass, 1 a check failed, 2 the run could not start.
// Usage: node solspike/smoke.mjs   (Node 26)
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PROBE_GROUP = "0".repeat(20);   // the probe id of solspike/tools/demo-check.mjs
const READY = "Crypto engine ready (WebAssembly)";
const LINK_MS = 20000;
const CONNECTING = "Connecting to the group server";

/**
 * The origin of SMOKE_ORIGIN. It must be https, because the password goes to it; plain http is
 * allowed for a local test origin only, where the password does not leave the machine.
 */
export function smokeOrigin(text = "https://staging.zigs.app") {
  const url = new URL(text);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(`SMOKE_ORIGIN must be https, got ${url.origin}`);
  }
  return url.origin;
}

/** The problems of a page load in the records of the harness rig (harness/rig.mjs). */
export function pageProblems(records, origin) {
  const urls = new Map(records.filter((r) => r.kind === "request").map((r) => [r.id, r.url]));
  const own = (url) => {
    try { return new URL(url).origin === origin; } catch { return false; }
  };
  const errorLine = (r) => ["console", "log"].includes(r.kind)
    && ["error", "assert"].includes(r.level);
  return {
    consoleErrors: records.filter(errorLine).map((r) => r.text),
    pageErrors: records.filter((r) => r.kind === "exception").map((r) => r.text),
    csp: records.filter((r) => r.kind === "csp").map((r) => `${r.directive} ${r.blocked}`),
    failed: records.filter((r) => r.kind === "failed" && own(urls.get(r.id)))
      .map((r) => `${urls.get(r.id)}: ${r.error}`),
    refused: records.filter((r) => r.kind === "response" && own(r.url) && r.status >= 400)
      .map((r) => `${r.url}: HTTP ${r.status}`),
  };
}

// A wrong password makes Chrome ask again after each answer: the check answers this often, then
// it cancels, so the page shows the refusal and the run does not loop.
export const AUTH_TRIES = 3;

/**
 * The answer to a password prompt: the credentials go to the origin itself, and nowhere else.
 * `tried` counts the earlier answers with the credentials.
 */
export function authAnswer(params, origin, password, tried = 0) {
  const ask = params?.authChallenge ?? {};
  const ours = ask.origin === origin && ask.source === "Server";
  return ours && password && tried < AUTH_TRIES
    ? { response: "ProvideCredentials", username: "smoke", password } : { response: "CancelAuth" };
}

/**
 * M1: each network picker on the screen ({ where, radios, ticks, mainnet }) has one radio, Testnet,
 * chosen, no tick and no mainnet text. The create dialog must be one of them.
 */
export function pickerVerdict(pickers) {
  const fine = (p) => p.radios.length === 1 && p.radios[0].value === "testnet"
    && p.radios[0].checked && p.ticks === 0 && !p.mainnet;
  const options = (p) => p.radios.map((r) => r.value + (r.checked ? " (chosen)" : "")).join(", ");
  const say = (p) => `${p.where}: ${options(p) || "no option"}`
    + (p.ticks ? `, ${p.ticks} tick` : "") + (p.mainnet ? ", mainnet text" : "");
  const ok = pickers.some((p) => p.where === "create dialog") && pickers.every(fine);
  return [ok, pickers.map(say).join("; ") || "no network picker"];
}

/** S1: the steps that the watcher saw ({ state, line }), and the state at the end. */
export function linkVerdict({ seen, state, loaded, line }) {
  const shownWhileConnecting = seen.some((s) => s.state === "connecting"
    && s.line.startsWith("shown: " + CONNECTING));
  const ok = shownWhileConnecting && state === "open" && loaded && line === "hidden";
  const steps = seen.map((s) => s.state + (s.line.startsWith("shown") ? " (line shown)" : ""));
  return [ok, `${steps.join(" > ") || "no step"}; the probe group ${loaded ? "loaded" : "did "
    + "not load"}; the status line is ${line}`];
}

/** The Solana part: the config, and the answer of the Worker to a command that does not exist. */
export function solVerdict({ status, rpcUrl, probe }) {
  const alive = /unknown command/.test(probe);
  return [status === 200 && rpcUrl && alive, `/sol/config.json HTTP ${status}, `
    + `${rpcUrl ? "with" : "without"} a Helius URL; the Solana Worker ${alive ? "answers"
      : "does not answer: " + probe}`];
}

/** The lines of the page problems: [ok, text, name] for each check, at most three examples. */
export function problemLines(p, origin) {
  const line = (name, list) => [list.length === 0, list.length ? `${list.length}: `
    + list.slice(0, 3).join(" | ") : "none", name];
  return [
    line("no console error", p.consoleErrors),
    line("no page error", p.pageErrors),
    line("no CSP violation", p.csp),
    line(`no failed request of ${origin}`, p.failed),
    line(`no refused request of ${origin}`, p.refused),
  ];
}

export function readPassword(file) {
  const text = readFileSync(file, "utf8").replace(/\r?\n$/, "");
  if (!text) throw new Error(`${file} is empty`);
  return text;
}

// ── The live run (only when this file runs as the script) ──

// The page scripts below run in the page: they must not use outer variables.
// The "+" of the wallet list only opens the create dialog. The welcome card has a "Create wallet"
// button too, and the last step of the dialog has a "Create wallet" button that creates a wallet:
// the check never clicks that one.
const OPEN_CREATE = () => {
  const plus = document.querySelector('button[aria-label="New wallet"]');
  if (!plus || plus.disabled) return false;
  plus.click();
  return true;
};
const CLOSE_DIALOG = 'form[role=dialog] button[aria-label="Close"]';
const READ_PICKERS = () => [...document.querySelectorAll("fieldset.net-pick")].map((f) => ({
  where: f.querySelector('input[name="g-network"]') ? "create dialog"
    : f.querySelector('input[name="p-network"]') ? "personal account" : "a picker",
  radios: [...f.querySelectorAll('input[type="radio"]')]
    .map((e) => ({ value: e.value, checked: e.checked })),
  ticks: f.querySelectorAll('input[type="checkbox"]').length,
  mainnet: /mainnet/i.test(f.textContent) || !!f.querySelector('option[value="mainnet"]'),
}));
const READ_SOL = async () => {
  const res = await fetch("/sol/config.json", { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  const { startSolWorker } = await import("/sol/client.js");
  // A command that does not exist: the Worker refuses it before any handler, with no key and no
  // chain call. A Worker that did not start gives "The Solana worker failed".
  const probe = await startSolWorker().call("smoke-no-such-command")
    .then(() => "answered", (e) => String(e?.message ?? e));
  return { status: res.status, rpcUrl: typeof body.rpcUrl === "string" && body.rpcUrl.length > 0,
    probe };
};
// The status line of the page is drawn by the first watcher of the link (web/app-engine.js), so it
// is up to date when this one runs.
const JOIN = async (gid) => {
  const link = await window.zigs.use("link");
  window.__smokeSeen = [];
  link.watch((s) => {
    const el = document.getElementById("link");
    const shown = el && el.style.display !== "none";
    const line = !el ? "missing" : shown ? "shown: " + el.textContent : "hidden";
    const last = window.__smokeSeen.at(-1);
    if (last?.state !== s.state || last?.line !== line) {
      window.__smokeSeen.push({ state: s.state, line });
    }
  });
  (await window.zigs.use("db")).join(gid);
};
const READ_LINK = (gid) => window.zigs.use("link").then((link) => {
  const s = link.now(), el = document.getElementById("link");
  const shown = el && el.style.display !== "none";
  return { seen: window.__smokeSeen, state: s.state, loaded: !!s.groups[gid]?.loaded,
    line: !el ? "missing" : shown ? "shown: " + el.textContent : "hidden" };
});

// Answers the password prompt of the origin through a second CDP session on the page.
async function passwordSession(chrome, page, origin, password, connect) {
  let cdp = null, tried = 0;
  const answer = (m) => {
    if (m.method === "Fetch.requestPaused") {
      cdp.send("Fetch.continueRequest", { requestId: m.params.requestId }, m.sessionId)
        .catch(() => {});
    } else if (m.method === "Fetch.authRequired") {
      const authChallengeResponse = authAnswer(m.params, origin, password, tried);
      if (authChallengeResponse.response === "ProvideCredentials") tried++;
      cdp.send("Fetch.continueWithAuth", { requestId: m.params.requestId, authChallengeResponse },
        m.sessionId).catch(() => {});
    }
  };
  cdp = await connect(chrome.wsUrl, answer);
  const { sessionId } = await cdp.send("Target.attachToTarget",
    { targetId: page.targetId, flatten: true });
  await cdp.send("Fetch.enable", { handleAuthRequests: true,
    patterns: [{ urlPattern: origin + "/*" }] }, sessionId);
  return cdp;
}

async function checks(page, origin, h) {
  const out = [];
  const step = async (name, fn) => {
    try { out.push([...(await fn()), name]); }
    catch (e) { out.push([false, String(e.message), name]); }
  };
  await step("the page and the engine load", async () => {
    await page.navigate(origin + "/");
    await h.waitForEngine(page);
    await h.closePrivacyPopup(page);
    return [true, READY];
  });
  await step("every network picker shows Testnet only (M1)", async () => {
    await h.waitFor(() => h.run(page, OPEN_CREATE), 15000, () => "the New wallet button");
    await h.waitForText(page, "Set up your wallet");
    const verdict = pickerVerdict(await h.run(page, READ_PICKERS));
    await h.clickSelector(page, CLOSE_DIALOG);
    return verdict;
  });
  await step("the Solana part loads", async () => solVerdict(await h.run(page, READ_SOL)));
  await step("the group server link opens (S1)", async () => {
    await h.run(page, JOIN, PROBE_GROUP);
    const end = Date.now() + LINK_MS;
    let seen;
    do { await h.sleep(250); seen = await h.run(page, READ_LINK, PROBE_GROUP); }
    while (!(seen.state === "open" && seen.loaded && seen.line === "hidden") && Date.now() < end);
    return linkVerdict(seen);
  });
  return out;
}

// SIGINT or SIGTERM stops Chrome first: its context holds the password.
function onSignals(rig) {
  const stop = (code) => () => { rig.close().finally(() => process.exit(code)); };
  const handlers = [["SIGINT", stop(130)], ["SIGTERM", stop(143)]];
  for (const [sig, fn] of handlers) process.once(sig, fn);
  return () => { for (const [sig, fn] of handlers) process.off(sig, fn); };
}

async function main() {
  const origin = smokeOrigin(process.env.SMOKE_ORIGIN || undefined);
  const file = process.env.SMOKE_PASSWORD_FILE || join(homedir(), ".config/zigs/staging-password");
  const password = readPassword(file);
  const { redact } = await import("./harness/redact.mjs");
  redact.add(password, Buffer.from(`smoke:${password}`).toString("base64"));
  const { withStack } = await import("./harness/stack.mjs");
  const { connect, sleep, waitFor } = await import("./harness/chrome.mjs");
  const pageTools = await import("./harness/page.mjs");
  let failed = 0;
  await withStack("smoke", async (rig) => {
    const offSignals = onSignals(rig);
    const ctx = await rig.newContext("smoke");
    const page = await ctx.open();
    const cdp = await passwordSession(rig.chrome, page, origin, password, connect);
    try {
      const done = await checks(page, origin, { ...pageTools, sleep, waitFor });
      await sleep(1000);
      const all = [...done, ...problemLines(pageProblems(page.records, origin), origin)];
      for (const [ok, text, name] of all) {
        if (!ok) failed++;
        console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${redact(text)}`);
      }
    } finally {
      cdp.close();
      await ctx.dispose();
      offSignals();
    }
  }, { server: false });
  finish(failed);
}

// The last line and the exit code. withStack sets exit code 1 when Chrome did not stop cleanly or a
// process is left.
function finish(failed) {
  const harness = process.exitCode === 1
    ? " (the harness did not stop cleanly: see the line above)" : "";
  const bad = failed > 0 || harness !== "";
  console.log(bad ? `smoke: FAIL${failed ? ` (${failed})` : ""}${harness}` : "smoke: all pass");
  process.exitCode = bad ? 1 : 0;
}

// True when node runs this file, also through a symlink or a path in another case (the rule of
// solspike/tools/baseline.mjs): node resolves import.meta.url and keeps argv[1] as typed.
const isMain = () => {
  try {
    const real = realpathSync.native;
    return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isMain()) {
  main().catch((e) => {
    console.error("smoke: " + String(e?.message ?? e));
    process.exitCode = 2;
  });
}
