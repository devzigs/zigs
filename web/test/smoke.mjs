// The pure parts of solspike/smoke.mjs (S19): the problems of a page load, the answer to a
// password prompt, and the verdicts of M1 and S1. The live run needs Chrome and staging; this
// test needs neither. Run: node web/test/smoke.mjs   (Node 26)
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUTH_TRIES, authAnswer, linkVerdict, pageProblems, pickerVerdict, problemLines, readPassword,
  smokeOrigin, solVerdict,
} from "../../solspike/smoke.mjs";

const ORIGIN = "https://staging.zigs.app";

// ── The problems of a page load ──
{
  const records = [
    { kind: "request", id: "1", url: ORIGIN + "/" },
    { kind: "response", id: "1", url: ORIGIN + "/", status: 200 },
    { kind: "request", id: "2", url: ORIGIN + "/app-x.js" },
    { kind: "failed", id: "2", error: "net::ERR_ABORTED" },
    { kind: "request", id: "3", url: "https://other.example/x" },
    { kind: "failed", id: "3", error: "net::ERR_FAILED" },
    { kind: "response", id: "4", url: ORIGIN + "/ws?g=0", status: 429 },
    { kind: "response", id: "5", url: "https://other.example/y", status: 500 },
    { kind: "response", id: "6", url: ORIGIN + "/favicon.ico", status: 400 },
    { kind: "console", level: "assert", text: "Assertion failed" },
    { kind: "console", level: "error", text: "boom" },
    { kind: "console", level: "log", text: "fine" },
    { kind: "log", level: "error", text: "Failed to load resource" },
    { kind: "log", level: "warning", text: "a warning" },
    { kind: "exception", text: "TypeError: x is undefined" },
    { kind: "csp", directive: "script-src", blocked: "inline" },
  ];
  const p = pageProblems(records, ORIGIN);
  assert.deepEqual(p.consoleErrors, ["Assertion failed", "boom", "Failed to load resource"]);
  assert.deepEqual(p.pageErrors, ["TypeError: x is undefined"]);
  assert.deepEqual(p.csp, ["script-src inline"]);
  assert.deepEqual(p.failed, [ORIGIN + "/app-x.js: net::ERR_ABORTED"], "only our origin");
  assert.deepEqual(p.refused, [ORIGIN + "/ws?g=0: HTTP 429", ORIGIN + "/favicon.ico: HTTP 400"],
    "only our origin, from 400 on");
  const clean = pageProblems(records.slice(0, 2), ORIGIN);
  const lines = problemLines(clean, ORIGIN);
  assert.equal(lines.length, 5);
  assert.ok(lines.every(([ok, text]) => ok && text === "none"), "a clean load passes each line");
  assert.deepEqual(lines.map(([, , name]) => name), ["no console error", "no page error",
    "no CSP violation", `no failed request of ${ORIGIN}`, `no refused request of ${ORIGIN}`]);
  const bad = problemLines(p, ORIGIN);
  assert.deepEqual(bad.map(([ok]) => ok), [false, false, false, false, false]);
  assert.match(bad[0][1], /^3: Assertion failed \| boom \| Failed to load resource$/);
  const many = problemLines({ ...clean, consoleErrors: ["a", "b", "c", "d"] }, ORIGIN)[0][1];
  assert.equal(many, "4: a | b | c", "at most three examples");
  console.log("ok  the problems of a page load: errors, CSP, and failed requests of the origin");
}

// ── The password goes to the origin only ──
{
  const ask = (origin, source = "Server") => ({ authChallenge: { origin, source } });
  assert.deepEqual(authAnswer(ask(ORIGIN), ORIGIN, "pw"),
    { response: "ProvideCredentials", username: "smoke", password: "pw" });
  const others = [ask("https://evil.example"), ask(ORIGIN, "Proxy"),
    ask("http://staging.zigs.app"), {}, null, ask(ORIGIN + ".evil.example")];
  for (const params of others) {
    assert.deepEqual(authAnswer(params, ORIGIN, "pw"), { response: "CancelAuth" },
      JSON.stringify(params));
  }
  assert.deepEqual(authAnswer(ask(ORIGIN), ORIGIN, ""), { response: "CancelAuth" }, "no password");
  const last = authAnswer(ask(ORIGIN), ORIGIN, "pw", AUTH_TRIES - 1);
  assert.equal(last.response, "ProvideCredentials");
  assert.deepEqual(authAnswer(ask(ORIGIN), ORIGIN, "pw", AUTH_TRIES), { response: "CancelAuth" },
    "a wrong password is not sent for ever");
  console.log("ok  the password goes to the origin only");
}

// ── M1: every picker shows Testnet only, no tick ──
{
  const radio = (value, checked) => ({ value, checked });
  const picker = (where, radios, more = {}) =>
    ({ where, radios, ticks: 0, mainnet: false, ...more });
  const dialog = picker("create dialog", [radio("testnet", true)]);
  const account = picker("personal account", [radio("testnet", true)]);
  assert.deepEqual(pickerVerdict([dialog, account]),
    [true, "create dialog: testnet (chosen); personal account: testnet (chosen)"]);
  for (const shown of [
    [account],
    [],
    [picker("create dialog", [radio("testnet", true), radio("mainnet", false)]), account],
    [picker("create dialog", [radio("testnet", true)], { ticks: 1 }), account],
    [picker("create dialog", [radio("testnet", false)])],
    [picker("create dialog", [radio("mainnet", true)])],
    [dialog, picker("personal account", [radio("mainnet", true)])],
    [dialog, picker("personal account", [radio("testnet", true)], { mainnet: true })],
  ]) assert.equal(pickerVerdict(shown)[0], false, JSON.stringify(shown));
  console.log("ok  M1: each picker passes with Testnet only, no tick and no mainnet text");
}

// ── S1: connecting with the line shown, then open with the line hidden ──
{
  const step = (state, line) => ({ state, line });
  const seen = [step("idle", "hidden"),
    step("connecting", "shown: Connecting to the group server…"), step("open", "hidden")];
  const good = { seen, state: "open", loaded: true, line: "hidden" };
  assert.equal(linkVerdict(good)[0], true);
  assert.match(linkVerdict(good)[1],
    /^idle > connecting \(line shown\) > open; the probe group loaded; the status line is hidden$/);
  const changes = [{ seen: [step("idle", "hidden"), step("open", "hidden")] },
    { seen: [step("connecting", "hidden"), step("open", "hidden")] }, { state: "retrying" },
    { loaded: false }, { line: "shown: Connecting to the group server…" }, { line: "missing" }];
  for (const change of changes) {
    assert.equal(linkVerdict({ ...good, ...change })[0], false, JSON.stringify(change));
  }
  console.log("ok  S1: the link passes when the line shows while it connects and hides when open");
}

// ── The Solana part ──
{
  const good = { status: 200, rpcUrl: true, probe: "Error: unknown command" };
  assert.equal(solVerdict(good)[0], true);
  assert.match(solVerdict(good)[1], /HTTP 200, with a Helius URL; the Solana Worker answers$/);
  for (const change of [{ status: 503 }, { rpcUrl: false }, { probe: "The Solana worker failed" },
    { probe: "answered" }]) {
    assert.equal(solVerdict({ ...good, ...change })[0], false, JSON.stringify(change));
  }
  console.log("ok  the Solana part passes when the config answers and the Worker answers");
}

// ── The origin must be https: the password goes to it ──
{
  assert.equal(smokeOrigin(), "https://staging.zigs.app");
  assert.equal(smokeOrigin("https://app.zigs.app/x?y"), "https://app.zigs.app");
  assert.throws(() => smokeOrigin("http://staging.zigs.app"), /must be https/);
  const local = "http://127.0.0.1:8831";
  assert.equal(smokeOrigin(local), local, "a local test origin");
  assert.throws(() => smokeOrigin("ftp://127.0.0.1/"), /must be https/);
  assert.throws(() => smokeOrigin("not a url"));
  console.log("ok  the origin is https, or http on this machine");
}

// ── The password file ──
{
  const dir = mkdtempSync(join(tmpdir(), "smoke-"));
  writeFileSync(join(dir, "pw"), "secret\n");
  writeFileSync(join(dir, "crlf"), "secret\r\n");
  writeFileSync(join(dir, "inner"), " sec ret \n");
  writeFileSync(join(dir, "empty"), "\n");
  assert.equal(readPassword(join(dir, "pw")), "secret", "one end of line goes");
  assert.equal(readPassword(join(dir, "crlf")), "secret", "a CRLF end goes too");
  assert.equal(readPassword(join(dir, "inner")), " sec ret ", "spaces are part of the password");
  assert.throws(() => readPassword(join(dir, "empty")), /is empty/);
  assert.throws(() => readPassword(join(dir, "none")), /ENOENT/);
  console.log("ok  the password file: one end of line goes, an empty or missing file fails");
}
console.log("smoke: ok");
