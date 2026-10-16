// The mutants of tools/mutate.mjs. A mutant undoes one fix or one check in a copy of the tree.
// `patches` change a file (`from` must occur exactly once), `run` is the shipped check that must
// fail, `detect` must match its output, and `forbid` (optional) must not. ms is the time limit.
const TEST = ["node", "--test-timeout=60000"];
const GATE = [...TEST, "solspike/test/gate.test.mjs"];
const HARNESS = "solspike/test/harness.test.mjs";
const only = (pattern) => [...TEST, `--test-name-pattern=${pattern}`, HARNESS];
const SELFTEST = ["node", "solspike/harness/selftest.mjs"];
const LIVE = ["node", "solspike/harness/live-check.mjs"];
const LEAK = ["python3", "-I", "solspike/tools/leak_scan.py", "solspike/tools"];

const BASELINE = "solspike/tools/baseline.mjs";
const CHROME = "solspike/harness/chrome.mjs";
const RIG = "solspike/harness/rig.mjs";
const STACK = "solspike/harness/stack.mjs";
const SCAN = "solspike/tools/leak_scan.py";
const SERVE = "solspike/serve.sh";
const PROCS = "solspike/tools/procs.mjs";
const patch = (file, from, to = "") => ({ file, from, to });
// The Solana page tests: each mutant breaks one rule of web/app.js or web/sol that a test of
// web/test pins. They run in the node rig (sol-rig.mjs), without a server or a browser.
const SOL_APP = ["node", "web/test/sol-app.mjs"];
const SOL_CEREMONY = ["node", "web/test/sol-ceremony.mjs"];
const APP_JS = "web/app.js";
const INDEX_JS = "cf/src/index.js";
const POLICY_TEST = ["node", "solspike/test/policy.test.mjs"];
const STORE_URL = '  localStorage.setItem("u", body.rpcUrl);\n';
const SOL_OFF = 'if (env.SOL !== "1") return new Response("Not found\\n", { status: 404 });\n  ';
const CONFIG_ROUTE = "if (url.pathname === SOL_CONFIG) return solConfig(req, env);\n";
const SOL_SECRETS = "web/sol/secrets.js";
const SOL_SESSION = "web/sol/session.js";
const SOL_CEREMONY_JS = "web/sol/ceremony.js"; // the echo, label and round 3 checks sit here
// A gate mutant is killed by its own control. If the clean state C0 fails too, the fixture is
// broken, every test fails, and any title would match.
const gate = (detect) => ({ detect, forbid: /✖ C0 / });

const NO_HOOK = patch(
  RIG,
  'if (!PAGE_TYPES.has(type)) await send("Runtime.evaluate"',
  'if (false) await send("Runtime.evaluate"',
);
const NO_CLOSE = patch(
  "solspike/harness/selftest.mjs",
  "    server.closeAllConnections();\n    await new Promise((ok) => server.close(ok));\n",
);
const NO_GROUP = patch(
  "solspike/tools/procs.mjs",
  "row.pgid === pgid && !skip.has(pid)",
  "row.ppid === pgid && !skip.has(pid)",
);
const NO_MKDIR = patch(BASELINE, "    mkdirSync(dirname(NOW), { recursive: true });\n");
const NO_FAILED = patch(BASELINE, "t.exit !== null && t.exit !== 0", "false");
const NO_DIFF = patch(BASELINE, "if (JSON.stringify(a[key]) ===", "if (true ||");
const NO_SERVED = patch(BASELINE, '    ...diffMaps("served", base.served ?? {}, now.served),\n');
const NO_POLICY_CHECK = patch(BASELINE, 'if (!found["content-security-policy"])', "if (false)");
const NO_STATUS_CHECK = patch(BASELINE, "if (!/^HTTP\\/\\S+ 200\\b/.test(status))", "if (false)");
const NO_BASE_CHECK = patch(BASELINE, "if (!base.served)", "if (false)");
const PID_ONLY = patch(SERVE, '  is_server "$pid"\n}', '  alive "$pid"\n}');
const NEVER_SERVER = patch(SERVE, '  is_server "$pid"\n}', "  false\n}");
// The guard of the two command line tools, and the form that it replaced: a comparison of the
// typed path with the real path, which is false for a link.
const GUARD =
  "    const real = realpathSync.native;\n" +
  "    return real(process.argv[1]) === real(fileURLToPath(import.meta.url));\n";
const TYPED_GUARD = "    return import.meta.url === `file://${process.argv[1]}`;\n";
const STALE = /✖ D3 serve\.sh: a pid file that names no server/;
const SKIP_DOT_DIRS = patch(
  SCAN,
  "    for base, _, names in os.walk(root, followlinks=False):\n",
  "    for base, dirs, names in os.walk(root, followlinks=False):\n" +
    '        dirs[:] = [d for d in dirs if not d.startswith(".")]\n',
);
const SKIP_DOT_FILES = patch(
  SCAN,
  "        for name in names:\n",
  '        for name in [n for n in names if not n.startswith(".")]:\n',
);

// `expect` is the regex that the output must match, or { detect, forbid, ms }.
const mutant = (id, what, run, patches, expect) => ({
  id,
  what,
  run,
  patches,
  ms: 180000,
  ...(expect instanceof RegExp ? { detect: expect } : expect),
});

const LABEL_LINE = "  d.program === W.sol_program_label();";
const POOL_AND_REGISTRY =
  '"zolana-devnet:sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6:' +
  'regyS5rkAcw2YzDJCmTwCTHs2s246FXxbmuRZ42u2PD"';
const PEER_ECHO = 'peerEchoes[j] = c.docs.soldkg2[j + "-" + i].echo;';
const SHARE_CALL = "!c.W.sol_share_fits(JSON.stringify(f.keyPackage)) &&";

// The mutants of the P8e page code (web/sol): each undoes one rule of the signing sessions, and
// web/test/sol-sessions.mjs must fail on the assertion that names the rule.
const sessions = (id, what, [file, from, to], detect) =>
  mutant(id, what, ["node", "web/test/sol-sessions.mjs"], [patch(`web/sol/${file}.js`, from, to)], {
    detect,
    ms: 240000,
  });
// The two defects of the P8e verifier (web/test/sol-limits.mjs): each mutant undoes one part of
// the fix of the watch cap (D1) or of the end of a session whose nonce was used (D2).
const limits = (id, what, [file, from, to], detect) =>
  mutant(id, what, ["node", "web/test/sol-limits.mjs"], [patch(`web/sol/${file}.js`, from, to)], {
    detect,
    ms: 400000,
  });
const payment = (id, what, [file, from, to], run, detect) =>
  mutant(id, what, run, [patch(file, from, to)], { detect, ms: 120000 });
const LIVE_LINE = "    .filter((ss) => !ENDED.has(ss.status) && SESSION_ID.test(ss.id))\n";
const REJECTION = /Missing expected rejection/;
const TRUTH = /true !== false|false !== true/;
const PACKAGE_LINE =
  'if (S(J(ss.package)) !== S(verified)) ' +
  'throw new Error("The package differs from the commits.");\n';
const CHAIN_LINE =
  'if (need && verdict[need] !== "yes") return verdict[need] === "wait" ? "wait" : "no";\n';
const TWICE_LINE =
  'if (c.commits[ss.id]?.[seat]) return "Seat " + seat + " approved this already.";\n';

export const MUTATIONS = [
  mutant("D1", "launch() leaves a Chrome that never answers", only("^D1 launch"),
    [patch(CHROME, "    return failWith(chrome, err);", "    throw err;")],
    { detect: /✖ D1 launch: a Chrome that never opens/, ms: 240000 }),
  mutant("D1-kill", "no SIGKILL for a Chrome that ignores SIGTERM", only("^D1 launch"),
    [patch(CHROME, '  proc.kill("SIGKILL");\n')], /✖ D1 launch: a Chrome that ignores/),
  mutant("D1-rig", "startRig() leaves a Chrome that it cannot drive", only("^D1 rig"),
    [patch(RIG, "    return failWith(chrome, err);", "    throw err;")], /✖ D1 rig/),
  mutant("D1-ws", "connect() waits for ever for the handshake", only("^D1 rig"),
    [patch(CHROME, "}, waitMs);\n    ws.addEventListener(", "}, 1e9);\n    ws.addEventListener(")],
    /✖ D1 rig: a Chrome whose CDP handshake/),
  mutant("D1-fetch", "the probe of the debugging port has no time limit", only("^D1 launch"),
    [patch(CHROME, "    signal: AbortSignal.timeout(Math.max(1, Math.min(leftMs, PROBE_MS))),\n")],
    /✖ D1 launch: a debugging port that accepts/),
  mutant("T-kill", "killChrome() leaves its grace timer pending", only("^T1"),
    [patch(
      CHROME,
      '  if (await settlesWithin(chrome.exited, graceMs)) return "stopped by SIGTERM";',
      "  const late = sleep(graceMs).then(() => false);\n" +
        "  const done = await Promise.race([chrome.exited.then(() => true), late]);\n" +
        '  if (done) return "stopped by SIGTERM";',
    )],
    /✖ T1 /),
  mutant("T-shutdown", "shutdown() leaves its 10 s timer pending", only("^T2"),
    [patch(
      CHROME,
      "  const gone = await settlesWithin(chrome.exited, 10000);",
      "  const late = sleep(10000).then(() => false);\n" +
        "  const gone = await Promise.race([chrome.exited.then(() => true), late]);",
    )],
    /✖ T2 /),
  mutant("N3", "connect() keeps its handshake timer after the open event", only("^T2"),
    [patch(CHROME, '"open", () => {\n      clearTimeout(timer);\n', '"open", () => {\n')],
    /✖ T2 /),
  mutant("D3", "serve.sh checks that the PID is alive, not that it is the server", only("^D3"),
    [PID_ONLY], STALE),
  mutant("D3-live", "serve.sh reports the live server of this clone as stale", only("^D3"),
    [NEVER_SERVER], /✖ D3 serve\.sh: the wrangler of this clone is found/),
  mutant("D3-cwd", "serve.sh does not compare the working directory", only("^D3"),
    [patch(SERVE, '  [ "$cwd" = "$cf" ]\n', "  true\n")], STALE),
  mutant("D3-port", "serve.sh does not compare the port", only("^D3"),
    [patch(SERVE, '--local --port $PORT "*)', '--local --port "*)')], STALE),
  mutant("N4", "drop_stale() keeps the pid file", only("^D3"),
    [patch(SERVE, 'no matching process, removed" >&2\n  rm -f "$PIDFILE"\n',
      'no matching process, removed" >&2\n')], STALE),
  mutant("P1", "ps runs in the locale and time zone of its caller", only("^P1"),
    [patch(PROCS, '    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },\n')], /✖ P1 /),
  mutant("P2", "procs.mjs compares the typed path", only("^P2"),
    [patch(PROCS, GUARD, TYPED_GUARD)], /✖ P2 /),
  mutant("G-symlink", "baseline.mjs compares the typed path", GATE,
    [patch(BASELINE, GUARD, TYPED_GUARD)], gate(/✖ C18 /)),
  mutant("G-belt", "baseline.sh passes a tool that prints no result line", GATE,
    [patch("solspike/baseline.sh", 'if ! grep -Eq "$line" <<<"$result"; then', "if false; then")],
    gate(/✖ C22 /)),
  mutant("N2", "runFailed() ignores left processes", only("^O1"),
    [patch(STACK, "  n.leftProcesses > 0 ||\n")], /✖ O1/),
  mutant("D5", "check does not create the .state folder", GATE, [NO_MKDIR], gate(/✖ D5/)),
  mutant("M7", "failed() returns nothing", GATE, [NO_FAILED], gate(/✖ M7/)),
  mutant("M8", "diffMaps() compares nothing", GATE, [NO_DIFF], gate(/✖ C1 /)),
  mutant("G-served", "the gate does not compare the served headers", GATE, [NO_SERVED],
    gate(/✖ C10 /)),
  mutant("G-served-csp", "a served page without a policy passes", GATE, [NO_POLICY_CHECK],
    gate(/✖ C14 /)),
  mutant("G-served-status", "a served page that is not a 200 passes", GATE, [NO_STATUS_CHECK],
    gate(/✖ C15 /)),
  mutant("G-served-base", "a baseline without served headers passes", GATE, [NO_BASE_CHECK],
    gate(/✖ C17 /)),
  mutant("G-live", "the served page policy changes (form-action)", LIVE,
    [patch("cf/src/index.js", `"form-action 'none'",`, `"form-action 'self'",`)],
    /the page policy is not the recorded one/),
  mutant("M10", "the leak scan skips dot directories", LEAK, [SKIP_DOT_DIRS], /hidden paths/),
  mutant("M10-files", "the leak scan skips dot files", LEAK, [SKIP_DOT_FILES], /hidden paths/),
  mutant("O1", "withStack finds no left process", only("^O1"),
    [patch(STACK, "  const left = newInGroup(before, { roots });", "  const left = [];")],
    /✖ O1/),
  mutant("O2", "newInGroup() follows the parent and not the group", only("^O2"), [NO_GROUP],
    /✖ O2/),
  mutant("O3", "every new group member counts, also a live child of the caller", only("^O3"),
    [patch("solspike/tools/procs.mjs", "&& leftBehind(pid, row))", ")")], /✖ O3/),
  mutant("O3-roots", "a Chrome or server that survives its stop is not counted", only("^O3"),
    [patch("solspike/tools/procs.mjs", " || stack.has(pid);", ";")], /✖ O3/),
  mutant("D2-backstop", "withStack has no backstop for an open handle", only("^D2 backstop"),
    [patch(STACK, "    armBackstop(backstopMs);\n")], /✖ D2 backstop/),
  mutant("D4", "disposing a context does nothing (M3)", SELFTEST,
    [patch(RIG, '    await state.cdp.send("Target.disposeBrowserContext", {', "    ({")],
    { detect: /B is still listed after dispose/, ms: 240000 }),
  mutant("M5", "the Worker CSP hook is missing", SELFTEST, [NO_HOOK],
    {
      detect: /timeout waiting for a CSP event from the Worker/,
      forbid: /stack: still running/,
      ms: 240000,
    }),
  mutant("D2", "M5 with the loopback server left open", SELFTEST, [NO_HOOK, NO_CLOSE],
    { detect: /stack: still running \d+ ms after cleanup/, ms: 240000 }),
  mutant("W-echo-peer", "round 3 sends its own echo as the echo of every peer", SOL_CEREMONY,
    [patch(SOL_CEREMONY_JS, PEER_ECHO, "peerEchoes[j] = s.echo;")],
    { detect: /seat 1 made a key share/, forbid: /timeout/, ms: 240000 }),
  mutant("W-label-publish", "a soldone document carries a label of the page, not of the wasm",
    SOL_CEREMONY, [patch(SOL_CEREMONY_JS, "program: W.sol_program_label(),", 'program: "other",')],
    { detect: /AssertionError|timeout/, ms: 240000 }),
  mutant("W-label-compare", "a seat does not compare the label of the documents",
    SOL_CEREMONY, [patch(SOL_CEREMONY_JS, LABEL_LINE, "  true;")], /another label/),
  mutant("W-label-const", "a seat compares the label with a text of the page, not of the wasm",
    SOL_CEREMONY, [patch(SOL_CEREMONY_JS, LABEL_LINE, `  d.program === ${POOL_AND_REGISTRY};`)],
    /another label/),
  mutant("W-share-check", "the restore does not ask the wasm if the key share fits", SOL_APP,
    [patch("web/sol/backup.js", SHARE_CALL, "false &&")], /AssertionError/),
  mutant("P3-ps", "the sampling ps counts", only("^P3"),
    [patch(PROCS, "return !isZombie(row) && !sampler(row);", "return !isZombie(row);")],
    /✖ P3 /),
  mutant("P3-zombie", "a zombie counts", only("^P3"),
    [patch(PROCS, "return !isZombie(row) && !sampler(row);", "return !sampler(row);")], /✖ P3 /),
  mutant("P3-shell", "the shells above count in the peak", only("^P3"),
    [patch(PROCS, "    const own = ownProcesses(getRoots());",
      "    const own = new Map([...ownProcesses(getRoots()), ...wrappersAbove()]);")], /✖ P3 /),
  mutant("sol-M6", "a wallet of unknown network counts as testnet", SOL_CEREMONY,
    [patch(APP_JS, 'solGroup(gid)?.network === "testnet"', 'solGroup(gid)?.network !== "mainnet"')],
    /a mainnet wallet watches no Solana document/),
  mutant("sol-M6-restore", "a Solana backup of a mainnet wallet is still read", SOL_APP,
    [patch(APP_JS, 'if (g && g.network !== "testnet") throw', "if (false) throw")],
    /testnet wallets only/),
  mutant("sol-M6-watch", "a mainnet wallet watches its start document", SOL_CEREMONY,
    [patch(APP_JS, "if (solWatched || !solOn(gid)) return;", "if (solWatched) return;")],
    /a mainnet wallet watches no Solana document/),
  mutant("sol-M9", "an empty solstart snapshot loads Solana", SOL_CEREMONY,
    [patch(APP_JS, "if (snap.docs.length) solLoad();", "solLoad();")],
    /with no start document: no load/),
  mutant("sol-M10", "openGroup does not close the Solana part", SOL_APP,
    [patch(APP_JS, "  sol?.close();\n")], /the wallet list watches no Solana document/),
  mutant("sol-M10-switch", "only the list closes the Solana part, not a switch to a mainnet wallet",
    SOL_APP, [patch(APP_JS, "  sol?.close();\n", "  if (!gid) sol?.close();\n")],
    /a mainnet wallet leaves no watch of the last wallet/),
  mutant("sol-cfg-status", "the page takes a URL from an error answer of the server",
    ["node", "web/test/sol-config.mjs"],
    [patch(SOL_SESSION, "    if (res.ok) body", "    body")],
    /a rpcUrl in an error answer/),
  mutant("sol-cfg-store", "the page stores the URL of the server",
    ["node", "web/test/sol-config.mjs"],
    [patch(SOL_SESSION, "  return body.rpcUrl;\n}", `${STORE_URL}  return body.rpcUrl;\n}`)],
    /the URL is not stored/),
  mutant("sol-cfg-cache", "the config answer can be cached", POLICY_TEST,
    [patch(INDEX_JS, 'headers: { "Cache-Control": "no-store" }', "headers: {}")], /no-store/),
  mutant("sol-cfg-method", "the config route answers a POST", POLICY_TEST,
    [patch(INDEX_JS, 'if (req.method !== "GET") return', 'if (false) return')], /405/),
  mutant("sol-cfg-switch", "the config route ignores the switch SOL", POLICY_TEST,
    [patch(INDEX_JS, `${SOL_OFF}${CONFIG_ROUTE}`, `${CONFIG_ROUTE}${SOL_OFF}`)],
    /config with SOL=/),
  mutant("sol-n5b", "stopOf does not read seat 1", SOL_CEREMONY,
    [patch(SOL_SECRETS, "  host\n    .localSeats()\n    .map(",
      "  host\n    .localSeats()\n    .slice(1)\n    .map(")],
    /a stopped wallet shows no /),
  mutant("sol-n11", "shareSeat ignores the stop", SOL_APP,
    [patch(SOL_SESSION, "  stopOf(c) ? undefined : c.host.localSeats()", "  c.host.localSeats()")],
    /a stopped wallet has none/),
  sessions("S-nonces-kept", "the nonces stay after the share is made",
    ["nonces", '      nonces: without(part(c, seat, "nonces"), sid),\n',
      '      nonces: part(c, seat, "nonces"),\n'], /the nonces went before the publish/),
  sessions("S-digest-used", "the digest is not marked used when the share is made",
    ["nonces", 'used: { ...part(c, seat, "used"), [entry.digest]: sid },',
      'used: part(c, seat, "used"),'], /digest used|digest is used|true !== false|false !== true/),
  sessions("S-pending-lost", "a made share is not kept until it is published",
    ["nonces", 'pending: { ...part(c, seat, "pending"), [sid]: { share, digest: entry.digest } },',
      'pending: part(c, seat, "pending"),'], /timeout: a made share that waits/),
  sessions("S-used-refused", "a used digest is approved again",
    ["approve", "if (usedDigest(c, seat, review.digest)) {", "if (false) {"], REJECTION),
  sessions("S-approve-twice", "a seat approves the same proposal twice",
    ["approve", "  " + TWICE_LINE, ""], REJECTION),
  sessions("S-stale-nonce", "the nonce of the chain is not compared at approval",
    ["approve", "  await checkNonce(c, review);\n", ""], REJECTION),
  sessions("S-review-block", "reviewOf ignores a stop",
    ["approve", "  if (block) return { why: block };\n", ""], TRUTH),
  sessions("S-stop-gate", "a stopped wallet may propose",
    ["gate", "  if (stop) return stop;\n", ""], /operator: 'rejects'|expected: false/),
  sessions("S-abort-reason", "an abort document with no reason stops the wallet",
    ["secrets", '.filter(([, d]) => typeof d?.reason === "string")', ".filter(() => true)"],
    /TypeError|AssertionError/),
  sessions("S-abort-flat", "the abort document has no writer rule",
    ["docs", "soldone|solfee|solabort", "soldone|solfee"], /timeout: the document is read/),
  sessions("S-abort-publish", "a stopped seat does not publish its abort document",
    ["main", "      reactAborts(c);\n", ""], /timeout: the abort document/),
  sessions("S-sent-mark", "a sent mark may name another transaction",
    ["sessions", 'if (name === "sent" && !sentMatches(d)) return "no";', ""],
    /a sent mark with another id/),
  sessions("S-part-chain", "a part counts without the part before it",
    ["sessions", "  " + CHAIN_LINE, ""], /expected: 'collecting'/),
  sessions("S-package-differs", "a signer takes a package that differs from the commits",
    ["signing", "  " + PACKAGE_LINE, ""], /package differs from the commits|did not combine/),
  sessions("S-preflight", "the proposal skips the test run on the network",
    ["propose", "  await preflight(worker, fields.message, seat);\n", ""], /one test run/),
  sessions("S-drop-dead", "the nonces of an ended session stay",
    ["signing", "if (ended(sid)) launch(", "if (false) launch("],
    /timeout: the nonces of a stopped wallet go/),
  sessions("S-used-screen", "a seat that signed the bytes gets the Approve button again",
    ["payview", 'digest && usedDigest(c, seat, digest) ? "used" : "open"', '"open"'],
    /no button for seat/),
  sessions("S-intent-length", "an intent of the wrong length has a screen",
    ["intent", " || hex.length !== LENGTHS[tag] * 2", ""], /no screen for|SyntaxError/),
  limits("L-d1-ended", "a session that ended keeps its watches",
    ["main", LIVE_LINE, "    .filter((ss) => SESSION_ID.test(ss.id))\n"],
    /timeout: a session that ended gives its watches back/),
  limits("L-d1-junk", "a document with no valid proposal takes a watch",
    ["main", "    .map((ss) => ss.id);\n",
      "    .map((ss) => ss.id)\n" +
        '    .concat(Object.keys(c.raw[SESSIONS] ?? {}).filter((i) => i[0] === "j"));\n'],
    /a document with no valid proposal is not watched/),
  limits("L-d1-cap", "the live watches have no cap",
    ["main", "    .slice(0, WATCH_MAX)\n", ""], /at most 50 sessions/),
  limits("L-d2-end", "a session on a used nonce does not end",
    ["sessions", "  endSuperseded(out.sessions);\n", ""], /timeout: session \S+ failed/),
  limits("L-d2-signed", "only a collecting session ends when its nonce was used",
    ["sessions", "if (ENDED.has(ss.status) || !usesNonce(ss)",
      'if (ss.status !== "collecting" || !usesNonce(ss)'], /signed ends/),
  limits("L-d2-blockhash", "the nonce account proposal ends like a nonce session",
    ["sessions", "|| !usesNonce(ss) ||", "|| false ||"], /a blockhash lifetime is not a nonce/),
  // The private payment path of P8f: sol-transfer.mjs (wire forms and checker), sol-pay.mjs (the
  // snapshot of a device, the gate and error 7008) and prepare.test.mjs (the prover body).
  payment("P-asset", "the SOL asset field of the prover body is another value",
    ["web/sol/prepare.js", "9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864n",
      "9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64865n"],
    ["node", "solspike/test/prepare.test.mjs"], /only SOL is supported/),
  payment("T-salts", "the snapshot writes a pair as salt then nullifier",
    ["web/sol/intent.js", "salts.map((p) => p.first + p.salt)",
      "salts.map((p) => p.salt + p.first)"],
    ["node", "web/test/sol-transfer.mjs"], /a salt that the device used before/),
  payment("S-found", "a missing input does not stop the snapshot",
    ["web/sol/spend.js", "found.length === 0 || found.some((u) => u === undefined)",
      "found.length === 0"],
    ["node", "web/test/sol-pay.mjs"], /expected: \/every input\//),
  payment("S-pairs", "the pair of the session itself counts as an earlier pair",
    ["web/sol/spend.js", "if (other !== sid) seen.set", "if (true) seen.set"],
    ["node", "web/test/sol-pay.mjs"], /is not an earlier pair/),
  payment("A-reading", "a payment is checked before the device has read its wallet",
    ["web/sol/approve.js",
      'intent.kind === "transfer" && !spend ? { why: READING } : { intent }', "{ intent }"],
    ["node", "web/test/sol-pay.mjs"], /reading your wallet/),
  payment("W-7008", "error 7008 ends the session as an ordinary refusal",
    ["web/sol/signing.js", "STALE_ROOT.test(sim.err) ? PROOF_EXPIRED : refused", "refused"],
    ["node", "web/test/sol-pay.mjs"], /proof expired because the pool moved on/),
  // The four survivors of the P8f verifier (V1, V10, V11, V12).
  limits("L-close", "closing the wallet keeps the watches of its open sessions",
    ["main", "[...c.unsubs, ...c.watching.values()]", "c.unsubs"],
    /no session watch outlives the wallet/),
  payment("T-fee", "the snapshot gives the checker no tree fee",
    ["web/sol/intent.js", "le64(fee) +\n    u8(inputs.length)",
      "le64(0n) +\n    u8(inputs.length)"],
    ["node", "web/test/sol-transfer.mjs"], /the fee of every input/),
  payment("T-amount", "the screen reads seven bytes of the transfer amount",
    ["web/sol/intent.js", "le64Of(h.slice(348, 364))", "le64Of(h.slice(348, 362))"],
    ["node", "web/test/sol-transfer.mjs"], /all eight bytes of the amount are read/),
  payment("A-spend", "the saved approval of a payment keeps no snapshot",
    ["web/sol/approve.js",
      'if (review.intent.kind === "transfer") entry.spend = c.snaps[ss.id];', ""],
    ["node", "web/test/sol-pay.mjs"], /keeps the snapshot of the device/),
  payment("B-settle", "a Solana restore does not wait for the address check of the seat",
    ["web/sol/backup.js", "c.host.seatCheck(f.seat) !== true", "false"],
    ["node", "web/test/sol-app.mjs"], /Seat 1 must show Address checked/),
  // The fee payer (ZOLANA.md 5): each mutant undoes one rule of the fee key, the payer or the
  // order of the signatures, and the test that pins the rule must fail.
  payment("F-sig", "an approver does not check the signature of the payer",
    ["web/sol/approve.js",
      "if (!FEE_SIG.test(ss.feeSig) || !c.W.sol_fee_verify(payer, wasm.message, ss.feeSig)) {",
      "if (false) {"],
    ["node", "web/test/sol-sessions.mjs"], /expected: \/fee signature\//),
  payment("F-payer-by", "the payer is the key of seat 1, not of the proposing seat",
    ["web/sol/fee.js", "publishedFee(c, ss.by)", "publishedFee(c, 1)"],
    ["node", "web/test/sol-sessions.mjs"], /proposed by seat 2: seat 1 accepted/),
  payment("F-txid", "the transaction id is the group signature, not the first signature",
    ["web/sol/signing.js", "txId = base58(ss.feeSig ?? ss.signature);",
      "txId = base58(ss.signature);"],
    ["node", "web/test/sol-sessions.mjs"], /timeout: session sent/),
  payment("F-order", "the wire form puts the group signature before the payer signature",
    ["web/sol/signing.js", "bytesOf(ss.feeSig + ss.signature)",
      "bytesOf(ss.signature + ss.feeSig)"],
    ["node", "web/test/sol-sessions.mjs"], /timeout: session sent/),
  payment("F-pays", "the group key can be the fee payer of a transfer",
    ["web/sol/transfer.js",
      'if (payer === session.owner) throw new Error("the group key cannot pay the fee");', ""],
    ["node", "solspike/test/transfer.test.mjs"],
    /expected: \/the group key cannot pay the fee\//),
  payment("F-signers", "the owner signers of a spend include the payer",
    ["web/sol/transfer.js", "\n    .filter((address) => address !== proofInputs.payer);", ";"],
    ["node", "solspike/test/transfer.test.mjs"], /operator: 'deepStrictEqual'/),
  payment("F-owner-call", "the instruction of a payment lists no owner signer",
    ["web/sol/worker.js", "ownerSigners: signers, ", ""],
    ["node", "solspike/test/worker.test.mjs"], /the group is the owner signer/),
  payment("F-schema", "the Worker takes no payer in prepare",
    ["web/sol/guard.js", "    payer: base58,\n", ""],
    ["node", "solspike/test/worker-schema.test.mjs"], /field "payer" is not allowed/),
  payment("F-no-share", "a seat with no key share has a fee key",
    ["web/sol/fee.js", "  if (!holdsShare(s)) return null;\n", ""],
    SOL_APP, /a seat with no key share has no fee key/),
  payment("F-seat", "every seat derives the fee key of seat 1",
    ["web/sol/fee.js", "const s = solOf(c.host, c.gid, seat);\n  if (!holdsShare(s)) return null;",
      "const s = solOf(c.host, c.gid, 1);\n  if (!holdsShare(s)) return null;"],
    ["node", "web/test/sol-fee.mjs"], /a fee key for each seat/),
  payment("F-restore-text", "a restore does not say that the document shows another key",
    ["web/sol/backup.js", '(feeMismatch(c, f.seat) ? " " + mismatchText(f.seat) : "")', '""'],
    SOL_APP, /does not show the key of this seat/),
  payment("F-ready", "a proposal does not wait for the document of the fee key",
    ["web/sol/fee.js", "if (held === null || shown === undefined) return",
      "if (held === null) return"],
    ["node", "web/test/sol-fee.mjs"], /not published yet/),
  payment("F-doc-path", "the reader knows no solfee path",
    ["web/sol/docs.js", "soldone|solfee|solabort", "soldone|solabort"],
    ["node", "web/test/sol-docs.mjs"], /solfee\/1/),
  // A document with another key than the key share gives (ZOLANA.md 5): an error, no rewrite.
  payment("F-two-keys", "a seat answers a document that shows another key with its own key",
    ["web/sol/fee.js", "feeOf(c, seat) !== null && publishedFee(c, seat) === undefined;",
      "feeOf(c, seat) !== null && publishedFee(c, seat) !== feeOf(c, seat).key;"],
    ["node", "web/test/sol-fee.mjs"], /this page never writes while a valid document stands/),
  payment("F-mismatch", "a proposal goes on while the document shows another key of the seat",
    ["web/sol/fee.js", "return shown === held.key ? { held } : { why: mismatchText(seat) };",
      "return { held };"],
    ["node", "web/test/sol-fee.mjs"], /fee document of seat 1 does not show the key of this seat/),
  payment("F-first-seat", "Propose and Add SOL use the first seat that can sign, ready or not",
    ["web/sol/gate.js", "writerSeats(c).find((i) => feeProblem(c, i) === null)",
      "writerSeats(c).find(() => true)"],
    ["node", "web/test/sol-fee.mjs"], /no seat is ready/),
  payment("F-mismatch-card", "the fund card shows an address that cannot pay",
    ["web/sol/payview.js", "  if (feeMismatch(c, seat)) {", "  if (false) {"],
    ["node", "web/test/sol-fee.mjs"], /no address to fund/),
  payment("F-cluster", "a fee document of another cluster counts as the document of the seat",
    ["web/sol/fee.js", "isKey(doc?.key) && doc.cluster === CLUSTER ?", "isKey(doc?.key) ?"],
    ["node", "web/test/sol-fee.mjs"], /another cluster: one write, then it stops/),
  // The proposals from before the fee keys (ZOLANA.md 5) and the kinds that run as a session.
  payment("F-old-id", "a landed proposal from before the fee keys is looked up by the wrong id",
    ["web/sol/signing.js", "txId = base58(ss.feeSig ?? ss.signature);",
      "txId = base58(ss.feeSig);"],
    ["node", "web/test/sol-fee.mjs"], /timeout: session old-landed sent/),
  payment("F-old-sent", "the sent mark of a proposal from before the fee keys does not count",
    ["web/sol/sessions.js", "const first = beforeFee(d) ? d.signature : d.feeSig;",
      "const first = d.feeSig;"],
    ["node", "web/test/sol-fee.mjs"], /timeout: session old-landed sent/),
  payment("F-old-end", "a proposal from before the fee keys with no signature stays open",
    ["web/sol/signing.js", "if (beforeFee(ss) && !ss.signature) {", "if (false) {"],
    ["node", "web/test/sol-fee.mjs"], /timeout: session old-collecting failed/),
  payment("F-old-land", "a signed proposal from before the fee keys that missed is sent",
    ["web/sol/signing.js",
      "  if (beforeFee(ss)) {\n    await failSession(c, ss, BEFORE_FEE);\n    return null;\n  }\n",
      ""],
    ["node", "web/test/sol-fee.mjs"], /old-missed ends with a clear text/),
  payment("F-kinds", "a session of the intent Add SOL gets an approval screen",
    ["web/sol/approve.js", "  if (!showable(ss)) return { why: NOT_SHOWN };\n", ""],
    ["node", "web/test/sol-fee.mjs"], /Add SOL is no session/),
];
