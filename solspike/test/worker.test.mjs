// Wiring tests of web/sol/worker.js (P8c fix). Usage: node solspike/test/worker.test.mjs
// The real worker.js, guard.js and prepare.js run in Node. /sol/zolana.bundle.js and
// /sol/transfer.js are replaced by worker-sdk-stub.mjs (the real decoders, a fake client, wallet
// and proof input builder), so the test needs no network, no wasm and no key. transfer.js has
// its own test with the real SDK. The steps name the mutants that they kill:
//   U13 the finite-expiry refusal      U14 the expiry read-back from the instruction data
//   U15 the single-origin fetch guard  U16 redact() in answer()   U18 redact.add() in init()
// and the nonce version tag, the order of commands and the prover that the client uses. The fetch
// guard has three more: it refuses a redirect (a fake fetch records the mode, and real loopback
// servers show that no redirect is followed), it checks and fetches every URL, and loopback RPC
// URLs pass only in the test mode of guard.js, which the real mock entry script turns on.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KEY_NAME = "api-key";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SOL = new URL("../../web/sol/", import.meta.url);
const STUB = new URL("./worker-sdk-stub.mjs", import.meta.url).href;
const PROVER_STUB = new URL("./prover-stub.mjs", import.meta.url).href;
const WORKER = new URL("worker.js", WEB_SOL).href;
const ENTRY = new URL("../mock/page/test-worker.js", import.meta.url).href;

// A /sol/ module gets the query of its parent (?load=N), so each load of the Worker has its own
// guard.js and the test mode of one load does not reach the next.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "/sol/zolana.bundle.js") return { url: STUB, shortCircuit: true };
    if (specifier === "/sol/transfer.js") return { url: STUB, shortCircuit: true };
    if (specifier === "/sol/prover/prover.js") return { url: PROVER_STUB, shortCircuit: true };
    if (!specifier.startsWith("/sol/")) return next(specifier, context);
    const { search } = new URL(context.parentURL);
    return { url: new URL(specifier.slice(5), WEB_SOL).href + search, shortCircuit: true };
  },
});

const { control } = await import(STUB);
const { proverControl } = await import(PROVER_STUB);
const { commitmentOf, cutTransact, hex, planFromProve } = await import("../../web/sol/prepare.js");
const sdk = await import(new URL("zolana.bundle.js", WEB_SOL).href);

const step = (name) => console.log(`ok  ${name}`);
const U64_MAX = 0xffff_ffff_ffff_ffffn;
const KEY = "k3y9".repeat(5);
const EXTRA = "extra-param-value-123";
const NULLIFIER = "c1".repeat(31);
const VIEWING = "a7".repeat(32);
const RPC = `https://devnet.helius-rpc.com/?${KEY_NAME}=${KEY}&x=${EXTRA}`;
const ZOLANA = `https://devnet.helius-rpc.com/v1/zolana?${KEY_NAME}=${KEY}&x=${EXTRA}`;
const GROUP_KEY = "e5".repeat(32);
const PDA_NULLIFIER = "c3".repeat(31);
const PDA_HEX = "d4".repeat(32);
const INIT = {
  rpcUrl: RPC,
  nullifierSecret: NULLIFIER,
  pdaNullifierSecret: PDA_NULLIFIER,
  viewingSecret: VIEWING,
  groupKey: GROUP_KEY,
  pda: PDA_HEX,
};
const PDA = "UgrqxxdDh3m4pf1DLYGw6fnzk9NGuWJaUnerUp4Mxqd";
const SYSTEM = "11111111111111111111111111111111";
const NONCE_ACCOUNT = "4kf6Z6LTZC7E7PRvUAoADayFXQfDGppBx8m1AuUvUndE";
const OWNER = "B1o5q9sWLRVY2uk43bd1GLLPcNmhqJQ53CfKKxKzeShD";
const POOL = "sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6";

// ---- the Worker under test: a fresh module instance, a fake self and a fake network ----

const waiting = new Map();
const posted = [];
const fetched = [];
const modes = [];
let ids = 0;
let loads = 0;

const realFetch = globalThis.fetch;
const fakeFetch = async (input, init) => {
  fetched.push(String(input instanceof Request ? input.url : input));
  modes.push(init?.redirect);
  return new Response("{}");
};
globalThis.fetch = fakeFetch;

/**
 * Resets the stub and loads the Worker again, so its session and redactor start empty. With
 * testMode the Worker starts from the entry script of the mock run, as the mock page does.
 */
async function freshWorker({ testMode = false } = {}) {
  Object.assign(control, { options: null, rpc: {}, utxos: [], fail: {} });
  Object.assign(control, { request: null, proved: null, instruction: null, signed: null });
  Object.assign(control, { rebuilt: null, synced: null });
  control.calls.length = 0;
  fetched.length = 0;
  modes.length = 0;
  posted.length = 0;
  Object.assign(proverControl, { made: [], calls: [] });
  proverControl.reply = () => new Response('{"proof":"local"}', { status: 200 });
  gate.answer = { mode: "hosted" };
  gate.asked = 0;
  globalThis.self = {
    location: { href: "https://app.zigs.app/sol/worker.js" },
    postMessage: (message) => {
      posted.push(message);
      if (typeof message.gate === "number") return answerGate(message.gate);
      waiting.get(message.id)?.(message);
    },
  };
  loads += 1;
  await import(`${testMode ? ENTRY : WORKER}?load=${loads}`);
}

/** The page side of the gate (client.js): it answers each prove call with `gate.answer`. */
const gate = { answer: { mode: "hosted" }, asked: 0 };
function answerGate(id) {
  gate.asked += 1;
  queueMicrotask(() => globalThis.self.onmessage({ data: { gate: id, ...gate.answer } }));
}

/** Sends one command to the Worker. Resolves with its answer { id, ok, result | error }. */
function ask(cmd, args) {
  ids += 1;
  const id = ids;
  const answer = new Promise((ok, bad) => {
    waiting.set(id, ok);
    setTimeout(() => bad(new Error(`no answer to ${cmd}`)), 5000).unref();
  });
  globalThis.self.onmessage({ data: { id, cmd, args } });
  return answer;
}

const refused = async (cmd, args, pattern, why) => {
  const answer = await ask(cmd, args);
  assert.equal(answer.ok, false, `${why}: ${cmd} was accepted`);
  assert.match(answer.error, pattern, why);
  return answer;
};

// ---- fixtures ----

const message = (name) => Uint8Array.from(readFileSync(join(HERE, "fixtures", name)));
const hexField = (n) => `0x${BigInt(n).toString(16)}`;
// The asset field of SOL in a prover body (see web/sol/prepare.js).
const SOL_FIELD = "0x2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864";
const slot = (owner, amount, blinding, dummy = false) => ({
  utxo: { asset: SOL_FIELD, amount: hexField(amount), blinding: hexField(blinding) },
  isDummy: dummy ? "0x1" : "0x0",
  ownerPkHash: owner,
});

/** A prover body with 1 real input and 2 outputs, like the landed message chain-p6a.msg. */
function proveBody(extraOutputs = 0) {
  const outputs = [slot("0xbbbb", 40, 0x33), slot("0xaaaa", 60, 0x44)];
  for (let i = 0; i < extraOutputs; i += 1) outputs.push(slot("0x0", 0, 0x55 + i, true));
  return {
    blindingSeed: hexField(0xabcdef),
    inputs: [slot("0xaaaa", 100, 0x11), slot("0x0", 0, 0x22, true)],
    outputs,
  };
}

const bytes32 = (last) => Uint8Array.from({ length: 32 }, (_v, i) => (i === 31 ? last : 0));
const syncedInput = () => ({
  spent: false,
  utxo: { asset: 1n, amount: 100n, blinding: bytes32(0x11) },
  outputContext: { hash: bytes32(0xaa), tree: "TREE", leafIndex: 7n },
});

/** The 80 bytes of a nonce account: version tag, state, authority, nonce, lamports per sign. */
function nonceData({ version = 1, state = 1, length = 80 } = {}) {
  const data = Buffer.alloc(length);
  data.writeUInt32LE(version, 0);
  data.writeUInt32LE(state, 4);
  data.fill(7, 8, 40);
  data.fill(9, 40, 72);
  return data;
}

const account = (data, owner = SYSTEM) => ({
  value: { owner, lamports: 1_056_640n, data: [data.toString("base64"), "base64"] },
});

// The payer is the fee key of a seat, not the group: the instruction names it first and lists the
// group as an owner signer.
const PAYER = "5TeWSsjg2gbxCyWVniXeCmwM7UtHTCK7svzJr5xYJzHf";
const PREPARE = {
  avoid: [],
  kind: "migrate",
  recipient: "01ab",
  amount: "40000000",
  expiry: "1792048408",
  payer: PAYER,
};

/** Proof inputs of the fake builder: they carry the expiry that was asked for. */
const inputsFor = (request) => ({ proofInputs: { expiry: request.expiry }, tree: "TREE" });

/** A client.proveTransact that posts the prover body through the Worker's own fetch. */
const prover =
  (body, data = { proved: true }) =>
  async () => {
    if (body !== null) {
      const init = { method: "POST", body: JSON.stringify(body) };
      const url = `https://devnet.helius-rpc.com/v1/zolana/prove?${KEY_NAME}=k`;
      await control.options.fetch(url, init);
    }
    return data;
  };

/** The transact data of a landed message: its expiry is PREPARE.expiry. */
const landedData = () => {
  const decoded = sdk.getCompiledTransactionMessageDecoder().decode(message("chain-p6a.msg"));
  return cutTransact(decoded, sdk.SHIELDED_POOL_PROGRAM_ID);
};

function giveProof(body, data = landedData()) {
  control.inputs = inputsFor;
  control.prove = prover(body);
  control.instructionData = data;
}

async function initialised() {
  await freshWorker();
  const answer = await ask("init", INIT);
  assert.equal(answer.ok, true, "init failed");
  control.rpc.getSlot = async () => 5n;
  control.calls.length = 0;
  fetched.length = 0;
}

// ---- steps ----

async function refusalsBeforeInit() {
  await freshWorker();
  await refused("sync", {}, /the Worker is not initialised/, "a command before init");
  await refused("nope", {}, /unknown command/, "an unknown command");
  await refused("sync", { x: 1 }, /field "x" is not allowed/, "an extra field");
  const seed = { ...INIT, solSeed: "00".repeat(32) };
  const answer = await refused("init", seed, /field "solSeed" is not allowed/, "solSeed in init");
  assert.equal(answer.error.includes("0000"), false, "the error echoes a value");
  const before = posted.length;
  globalThis.self.onmessage({ data: { id: "text", cmd: "sync", args: {} } });
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(posted.length, before, "a message without a numeric id was answered");
  assert.deepEqual(control.calls, [], "a refused command reached the SDK");
  step("a refused command never reaches the SDK; a message without a numeric id is ignored");
}

async function initWiring() {
  await freshWorker();
  const { ok, result } = await ask("init", INIT);
  assert.equal(ok, true);
  assert.deepEqual(
    [result.owner, result.shielded, result.ownerHash, typeof result.hasherMs],
    [OWNER, "01020304", "f1f2f3f4", "number"],
  );
  assert.deepEqual(
    [result.pda, result.pdaShielded, result.pdaOwnerHash],
    [PDA, "090a0b0c", "f9fafbfc"],
    "init names the PDA identity",
  );
  const options = control.options;
  assert.equal(options.solanaRpcUrl, RPC);
  assert.equal(options.indexerUrl, ZOLANA);
  assert.equal(options.proverUrl, ZOLANA);
  assert.equal(options.computeUnitLimit, 217_000);
  assert.equal(options.proverTee, false, "the attested enclave prover is not turned off");
  step("init gives the SDK the RPC URL, the /v1/zolana URLs, the CU limit and no enclave prover");
}

async function fetchGuard() {
  await initialised();
  const { fetch: guarded } = control.options;
  const blocked = [
    "https://evil.example/v1/zolana/x",
    "https://devnet.helius-rpc.com:8443/",
    "http://devnet.helius-rpc.com/",
    "https://mainnet.helius-rpc.com/",
    "https://lwd.zigs.app/",
    // The attested enclave prover that the newest SDK uses by default (TICKETS.md SOL-4).
    "https://d55y5ksdsm1vw.cloudfront.net/v1/zolana/prove",
  ];
  for (const url of blocked) {
    await assert.rejects(async () => guarded(url), /blocked a request to/, url);
    await assert.rejects(async () => guarded(new Request(url)), /blocked a request to/, url);
  }
  assert.deepEqual(fetched, [], "a blocked request reached the network");
  await guarded(`https://devnet.helius-rpc.com/v1/zolana/getEncryptedUtxosByTags?${KEY_NAME}=k`);
  await guarded(new Request("https://devnet.helius-rpc.com/"));
  assert.equal(fetched.length, 2, "a request to the RPC origin was blocked");
  step("U15 the Worker's fetch passes the RPC origin only, also as a Request, and nothing else");
}

/** Every call checks its own URL and fetches the URL that it checked, never one that it did not. */
async function everyUrlIsChecked() {
  await initialised();
  const { fetch: guarded } = control.options;
  const good = `https://devnet.helius-rpc.com/v1/zolana/getEncryptedUtxosByTags?${KEY_NAME}=k`;
  const evil = "https://evil.example/v1/zolana/x";
  await guarded(good);
  await assert.rejects(guarded(evil), /blocked a request to evil.example/);
  await guarded(new URL(good));
  await assert.rejects(guarded(new URL(evil)), /blocked a request to/);
  await assert.rejects(guarded("/v1/zolana/x"), /Invalid URL/, "a relative URL");
  await assert.rejects(guarded(undefined), /Invalid URL/, "no URL");
  await guarded(good);
  assert.deepEqual(fetched, [good, good, good], "a blocked URL or an unchecked URL was fetched");
  let reads = 0;
  const shifty = { toString: () => (reads++ === 0 ? good : evil) };
  await guarded(shifty);
  assert.equal(fetched.at(-1), good, "the guard fetched another URL than the one it checked");
  step("every fetch checks its URL and fetches that URL, also for a Request or a shifty input");
}

/** The fake fetch records the redirect mode that the guard passes on. */
async function redirectMode() {
  await initialised();
  const { fetch: guarded } = control.options;
  const url = "https://devnet.helius-rpc.com/";
  const follow = { redirect: "follow" };
  await guarded(url);
  await guarded(url, { method: "POST", body: "{}" });
  await guarded(url, follow);
  await guarded(url, { redirect: "manual" });
  await guarded(new Request(url));
  await guarded(new Request(url, { redirect: "manual" }));
  await guarded(new Request(url), follow);
  assert.deepEqual(modes, Array(7).fill("error"), "a fetch did not set redirect to error");
  step("the guarded fetch sets redirect to error, also over the redirect of an SDK init");
}

const serve = (answer) => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.url);
    const [status, location] = answer(req.url);
    res.writeHead(status, location ? { location } : {});
    res.end("{}");
  });
  const port = new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server.address().port)));
  const close = () => {
    server.closeAllConnections();
    server.close();
  };
  return { seen, port, close };
};

/** The real fetch and two loopback servers: a redirect, to any origin, is an error. */
async function redirectIsRefused() {
  const other = serve(() => [200]);
  const otherPort = await other.port;
  const away = `http://127.0.0.1:${otherPort}/landed`;
  const answers = { "/same": [302, "/landed"], "/away": [307, away] };
  const rpc = serve((path) => answers[path] ?? [200]);
  globalThis.fetch = realFetch;
  try {
    await freshWorker({ testMode: true });
    const origin = `http://127.0.0.1:${await rpc.port}`;
    const started = await ask("init", { ...INIT, rpcUrl: `${origin}/?${KEY_NAME}=${KEY}` });
    assert.equal(started.ok, true, started.error);
    const { fetch: guarded } = control.options;
    assert.equal((await guarded(`${origin}/ok`)).status, 200, "the guard blocked its own origin");
    for (const path of ["/same", "/away"]) {
      await assert.rejects(async () => guarded(`${origin}${path}`), path);
    }
    assert.deepEqual(rpc.seen, ["/ok", "/same", "/away"], "a redirect to the same origin ran");
    assert.deepEqual(other.seen, [], "a redirect reached another origin");
  } finally {
    globalThis.fetch = fakeFetch;
    other.close();
    rpc.close();
  }
  step("a redirect is an error: the real fetch does not follow it, to any origin");
}

/** The product Worker refuses a loopback RPC URL. Only the entry of the mock run accepts one. */
async function loopbackNeedsTestMode() {
  const loopback = { ...INIT, rpcUrl: `http://127.0.0.1:9/?${KEY_NAME}=${KEY}` };
  const bad = /init: field rpcUrl is missing or malformed/;
  await freshWorker();
  await refused("init", loopback, bad, "a loopback URL in the product Worker");
  await refused("init", { ...INIT, testMode: true }, /field "testMode" is not allowed/, "a flag");
  assert.deepEqual(control.calls, [], "a refused init reached the SDK");
  await freshWorker({ testMode: true });
  assert.equal((await ask("init", loopback)).ok, true, "the test entry refused a loopback URL");
  await refused("init", { ...INIT, rpcUrl: "https://evil.example/" }, bad, "another host");
  await freshWorker();
  await refused("init", loopback, bad, "the test mode of one load reached the next");
  step("a loopback RPC URL needs the test mode that only the mock entry script turns on");
}

const LEAKS = [RPC, `?${KEY_NAME}=${KEY}&x=${EXTRA}`, KEY, EXTRA, VIEWING, NULLIFIER];

async function errorsAreRedacted() {
  await initialised();
  const texts = [
    `fetch failed ${RPC}`,
    `bad search ?${KEY_NAME}=${KEY}&x=${EXTRA}`,
    `the key ${KEY} was refused`,
    `viewing ${VIEWING} nullifier ${NULLIFIER}`,
  ];
  for (const text of texts) {
    control.rpc.getSlot = async () => {
      throw new Error(text);
    };
    const answer = await ask("sync");
    assert.equal(answer.ok, false);
    assert.match(answer.error, /^Error: /, "the error name is lost");
    for (const secret of LEAKS) {
      assert.equal(answer.error.includes(secret), false, `a secret survived in "${text}"`);
    }
  }
  assert.match((await ask("sync")).error, /\[redacted\]/);
  step("U16 U18 an error text never carries the RPC URL, its key or search, or a role secret");
}

async function nonceVersion() {
  await initialised();
  const read = (data, owner) => {
    control.rpc.getAccountInfo = async () => account(data, owner);
    return ask("readNonce", { account: NONCE_ACCOUNT });
  };
  const good = await read(nonceData());
  assert.equal(good.ok, true);
  assert.equal(good.result.nonceHex, "09".repeat(32));
  assert.equal(good.result.lamports, "1056640");
  const wrong = { version: 0, state: 1 };
  const shape = [wrong, { version: 2 }, { state: 0 }, { state: 2 }, { length: 79 }, { length: 81 }];
  for (const change of shape) {
    const bad = await read(nonceData(change));
    assert.equal(bad.ok, false, `readNonce accepted ${JSON.stringify(change)}`);
    assert.match(bad.error, /not an initialised nonce account with version 1/);
  }
  const owned = await read(nonceData(), POOL);
  assert.match(owned.error, /not owned by System/);
  control.rpc.getAccountInfo = async () => ({ value: null });
  await refused("readNonce", { account: NONCE_ACCOUNT }, /does not exist/, "no account");
  step("readNonce needs System, 80 bytes, version tag 1 and state 1 (a Legacy tag is refused)");
}

async function finiteExpiry() {
  await initialised();
  for (const expiry of ["0", `${U64_MAX}`, `${U64_MAX + 1n}`]) {
    await refused("prepare", { ...PREPARE, expiry }, /the expiry must be finite/, expiry);
  }
  assert.deepEqual(control.calls, [], "a refused expiry reached the SDK");
  assert.equal(control.request, null, "a refused expiry reached the builder");
  step("U13 prepare refuses expiry 0, u64::MAX and more before any sync or proof");
}

async function expiryReadBack() {
  await initialised();
  const body = proveBody();
  control.utxos = [syncedInput()];
  giveProof(body);
  const done = await ask("prepare", PREPARE);
  assert.equal(done.ok, true, done.error);
  const data = landedData();
  const plan = planFromProve(body);
  assert.equal(done.result.expiry, "1792048408");
  assert.equal(done.result.data, hex(data));
  assert.equal(done.result.salt, "4ea913073c961b60db4b5c2efcb2e3ea");
  assert.deepEqual(done.result.outputs, plan.outputs);
  const spent = [{ id: hex(bytes32(0xaa)), tree: "TREE", ...plan.inputs[0] }];
  assert.deepEqual(done.result.inputs, spent);
  const order = ["rpc:getSlot", "syncWallet", "buildProofInputs", "proveTransact"];
  assert.deepEqual(control.calls.slice(0, 4), order, "prepare syncs a fresh wallet, then proves");
  assert.deepEqual(control.calls.slice(4, 6), ["ownerSigners", "transactInstruction"]);
  assert.equal(control.request.expiry, 1792048408n, "the builder got another expiry");
  assert.equal(control.request.amount, 40_000_000n);
  assert.equal(control.proved.proofInputs.expiry, 1792048408n, "the proof got other inputs");
  assert.equal(control.instruction.data.proved, true, "the data of the proof was not used");
  assert.deepEqual(
    [control.instruction.payer, control.instruction.inputTree, control.instruction.outputTree],
    [PAYER, "TREE", "TREE"],
  );
  assert.equal(control.request.payer, PAYER, "the builder got the payer of the request");
  assert.notEqual(control.instruction.payer, OWNER, "the group does not pay");
  assert.deepEqual(control.instruction.ownerSigners, [OWNER], "the group is the owner signer");
  assert.equal(
    control.signed,
    control.proved.proofInputs,
    "the signers come from the proof inputs",
  );
  assert.equal(control.request.identity.owner, OWNER, "the move spends the group key");
  const mismatch = { ...PREPARE, expiry: "1792048409" };
  const differs = /the expiry in the data differs from the request/;
  await refused("prepare", mismatch, differs, "the expiry read-back");
  step("U14 prepare reads the expiry back from the instruction data and refuses a different one");
}

/** A payment spends the PDA identity and lists no owner signer: the program signs for the PDA. */
async function payPreparesThePda() {
  await initialised();
  control.utxos = [syncedInput()];
  giveProof(proveBody());
  const done = await ask("prepare", { ...PREPARE, kind: "pay", avoid: ["ab".repeat(32)] });
  assert.equal(done.ok, true, done.error);
  assert.equal(control.request.identity.owner, PDA, "a payment spends the PDA identity");
  assert.deepEqual(control.request.avoid, ["ab".repeat(32)], "the inputs of open payments");
  const groupOwner = sdk.getAddressDecoder().decode(Buffer.from(GROUP_KEY, "hex"));
  assert.equal(control.request.identity.groupOwner, groupOwner, "the group key never pays");
  assert.deepEqual(control.instruction.ownerSigners, [], "no owner signer for the PDA");
  assert.equal(control.calls.includes("ownerSigners"), false, "no owner signer is asked for");
  assert.equal(control.synced.solanaAddress(), PDA, "the sync of a payment is of the PDA");
  step("prepare of a payment spends the PDA identity and lists no owner signer");
}

/** sync reads the PDA identity, syncOld the group key; account, rent and history read the RPC. */
async function identitiesAndReads() {
  await initialised();
  control.rpc.getSlot = async () => 5n;
  assert.equal((await ask("sync", {})).ok, true);
  assert.equal(control.synced.solanaAddress(), PDA);
  control.movable = 77n;
  const old = await ask("syncOld", {});
  assert.equal(old.ok, true, old.error);
  assert.equal(old.result.movable, "77", "the SOL that a move can take, from transfer.js");
  assert.equal(control.synced.solanaAddress(), OWNER);
  const data = Buffer.from([1, 2, 3]);
  control.rpc.getAccountInfo = async () => ({
    value: { owner: PDA, lamports: 9n, data: [data.toString("base64"), "base64"] },
  });
  const found = await ask("account", { account: PDA });
  assert.equal(found.ok, true, found.error);
  assert.deepEqual(found.result, {
    exists: true,
    owner: hex(sdk.getAddressEncoder().encode(PDA)),
    lamports: "9",
    data: "010203",
  });
  let options = null;
  control.rpc.getAccountInfo = async (_address, given) => {
    options = given;
    return { value: { owner: PDA, lamports: 9n, executable: true, data: ["", "base64"] } };
  };
  const program = await ask("recipientAccount", { account: PDA });
  assert.equal(program.ok, true, program.error);
  const owner = hex(sdk.getAddressEncoder().encode(PDA));
  const read = { exists: true, owner, lamports: "9", executable: true };
  assert.deepEqual(program.result, read, "the executable flag of a program account");
  assert.deepEqual(options.dataSlice, { offset: 0, length: 0 }, "a recipient read takes no data");
  control.rpc.getAccountInfo = async () => ({ value: null });
  assert.deepEqual((await ask("account", { account: PDA })).result, { exists: false });
  control.rpc.getMinimumBalanceForRentExemption = async (space) => 5080n * (128n + space);
  assert.deepEqual((await ask("rent", { space: "139" })).result, { lamports: "1356360" });
  let limit = 0;
  control.rpc.getSignaturesForAddress = async (_address, options) => {
    limit = options.limit;
    return [
      { signature: "5".repeat(88), err: null, slot: 7n },
      { signature: "4".repeat(88), err: { x: 1 }, slot: 6n },
    ];
  };
  assert.deepEqual((await ask("history", { account: PDA })).result, [
    { signature: "5".repeat(88), failed: false, slot: "7" },
    { signature: "4".repeat(88), failed: true, slot: "6" },
  ]);
  assert.equal(limit, 1000, "one page of history reaches far back to the create");
  const asked = [];
  control.rpc.getTransaction = async (signature, options) => {
    asked.push(options);
    return signature === "5".repeat(88)
      ? { meta: { err: null }, transaction: ["AQID", "base64"] }
      : null;
  };
  assert.deepEqual((await ask("transaction", { signature: "5".repeat(88) })).result, {
    found: true,
    failed: false,
    tx: "AQID",
  });
  const none = (await ask("transaction", { signature: "4".repeat(88) })).result;
  assert.deepEqual(none, { found: false, failed: false, tx: "" });
  assert.equal(asked[0].maxSupportedTransactionVersion, 1, "a v1 execute is read too");
  step("sync reads the PDA, syncOld the group key; account, rent, history and transaction read");
}

/** reprove proves only a payment whose first proof, rebuild and new data give the commitment. */
async function reproveChecksTheCommitment() {
  await initialised();
  control.utxos = [syncedInput()];
  const first = landedData();
  const commitment = await commitmentOf(first, null);
  const args = {
    recipient: "01ab",
    withdraw: "0",
    payer: PAYER,
    plan: "ab".repeat(32) + "00",
    inputIds: [hex(bytes32(0xaa))],
    transact: hex(first),
    commitment,
  };
  const rebuiltWith = (value) => () => ({ messageHash: () => Buffer.from(value, "hex") });
  control.rebuild = rebuiltWith(commitment);
  control.prove = prover(null);
  control.instructionData = first;
  const done = await ask("reprove", args);
  assert.equal(done.ok, true, done.error);
  assert.equal(done.result.data, hex(first));
  assert.equal(control.rebuilt.identity.owner, PDA, "the rebuild is of the PDA identity");
  assert.equal(control.rebuilt.payer, PAYER);
  assert.deepEqual(control.rebuilt.inputIds, args.inputIds);
  assert.deepEqual(control.instruction.ownerSigners, []);
  const other = "00".repeat(32);
  const wrong = { ...args, commitment: other };
  await refused("reprove", wrong, /first proof does not give/, "commitment");
  control.rebuild = rebuiltWith(other);
  await refused("reprove", args, /rebuilt payment does not give/, "a rebuild of other inputs");
  control.rebuild = rebuiltWith(commitment);
  const moved = Uint8Array.from(first);
  moved[20] ^= 1; // a byte of tx_viewing_pk: the data parses, the commitment changes
  control.instructionData = moved;
  await refused("reprove", args, /new proof does not give/, "new data of another payment");
  step("reprove proves and returns only data whose commitment is the approved one");
  await reproveOfAWithdrawal(first, args);
}

/** The reprove of a withdrawal binds the leg: the settlement accounts are in every commitment. */
async function reproveOfAWithdrawal(first, payment) {
  const to = hex(bytes32(0x66));
  const commitment = await commitmentOf(first, to);
  const args = { ...payment, recipient: to, withdraw: "2000000", commitment };
  control.rebuild = () => ({ messageHash: () => Buffer.from(commitment, "hex") });
  control.instructionData = first;
  const done = await ask("reprove", args);
  assert.equal(done.ok, true, done.error);
  const leg = { to: sdk.getAddressDecoder().decode(bytes32(0x66)), amount: 2_000_000n };
  assert.deepEqual(control.rebuilt.withdraw, leg, "the leg goes back into the rebuild");
  assert.equal(control.rebuilt.recipient, undefined, "a withdrawal has no shielded payee");
  const plain = { ...args, commitment: payment.commitment };
  await refused("reprove", plain, /first proof does not give/, "the commitment of no leg");
  await refused("reprove", { ...args, recipient: "01ab" }, /not a key/, "a short recipient");
  step("reprove of a withdrawal puts the leg back and binds its settlement accounts");
}

async function prepareRefusals() {
  await initialised();
  control.utxos = [syncedInput()];
  giveProof(proveBody());
  assert.equal((await ask("prepare", PREPARE)).ok, true);
  control.prove = prover(null);
  await refused("prepare", PREPARE, /the prover call was not seen/, "a stale prover body");
  control.prove = prover(proveBody(1));
  const counts = /has 1 real inputs and 3 outputs but the instruction has 1 inputs and 2 outputs/;
  await refused("prepare", PREPARE, counts, "the output count");
  control.prove = prover(proveBody());
  control.utxos = [];
  await refused("prepare", PREPARE, /not in the synced wallet/, "an unknown input");
  control.utxos = [syncedInput()];
  control.prove = async () => {
    throw new Error("the prover failed");
  };
  await refused("prepare", PREPARE, /the prover failed/, "a prover error");
  control.inputs = () => {
    throw new Error("the synced balance does not cover the amount");
  };
  await refused("prepare", PREPARE, /does not cover the amount/, "a builder error");
  step("prepare refuses a stale or missing prover body, a count mismatch and an unknown input");
}

async function commandOrder() {
  await initialised();
  let first = true;
  control.rpc.getSlot = async () => {
    if (first) await new Promise((done) => setTimeout(done, 40));
    first = false;
    return 5n;
  };
  control.rpc.getLatestBlockhash = async () => ({
    value: { blockhash: OWNER, lastValidBlockHeight: 1n },
  });
  posted.length = 0;
  const all = await Promise.all([ask("sync"), ask("blockhash"), ask("blockhash")]);
  assert.deepEqual(
    posted.map((m) => m.id),
    all.map((a) => a.id),
    "the answers came out of order",
  );
  step("commands run one at a time, in the order sent");
}

// The P8e commands: a balance, a status of one signature, and the two simulations. The real
// worker.js runs over the fake RPC of the stub. preflight must not ask for the signatures to be
// checked and simulate must.
async function readCommands() {
  await initialised();
  const asked = [];
  control.rpc.getBalance = async (account, options) => {
    asked.push(["getBalance", account, options.commitment]);
    return { value: 1_056_640n };
  };
  const balance = await ask("balance", { account: NONCE_ACCOUNT });
  assert.deepEqual(balance.result, { lamports: "1056640" });
  assert.deepEqual(asked, [["getBalance", NONCE_ACCOUNT, "confirmed"]]);
  const SIGNATURE = "5".repeat(88);
  const seen = {
    none: null,
    failed: { slot: 7n, err: { InstructionError: [0, "x"] }, confirmationStatus: "confirmed" },
    processed: { slot: 8n, err: null, confirmationStatus: "processed" },
    confirmed: { slot: 9n, err: null, confirmationStatus: "confirmed" },
    finalized: { slot: 10n, err: null, confirmationStatus: "finalized" },
  };
  const want = {
    none: { status: "none", slot: "" },
    failed: { status: "failed", slot: "7" },
    processed: { status: "pending", slot: "8" },
    confirmed: { status: "confirmed", slot: "9" },
    finalized: { status: "finalized", slot: "10" },
  };
  for (const [name, entry] of Object.entries(seen)) {
    control.rpc.getSignatureStatuses = async () => ({ value: [entry] });
    const answer = await ask("status", { signature: SIGNATURE });
    assert.deepEqual(answer.result, want[name], name);
  }
  const options = [];
  control.rpc.simulateTransaction = async (tx, option) => {
    options.push(option.sigVerify);
    return { value: { err: { InstructionError: [1, { Custom: 7008n }] }, logs: ["a", "b"] } };
  };
  const checked = await ask("simulate", { tx: "AQID" });
  const unchecked = await ask("preflight", { tx: "AQID" });
  assert.deepEqual(options, [true, false], "simulate checks the signatures, preflight does not");
  for (const answer of [checked, unchecked]) {
    assert.equal(answer.result.err, '{"InstructionError":[1,{"Custom":7008}]}');
    assert.deepEqual(answer.result.logs, ["a", "b"]);
  }
  control.rpc.simulateTransaction = async () => ({ value: { err: null, unitsConsumed: 5n } });
  assert.deepEqual((await ask("preflight", { tx: "AQID" })).result, {
    err: null,
    unitsConsumed: "5",
    logs: [],
  });
  step("balance, status, simulate and preflight answer from the RPC, preflight skips the check");
}

// The salt and the first nullifier of the transact data of a landed message. The nullifier sits
// before the last 6 bytes of the data (its tree index, a count of 1 and a 4 byte context root).
async function inspectCommand() {
  await initialised();
  const bytes = message("chain-p6a.msg");
  const tx = Buffer.from(bytes).toString("base64");
  const done = await ask("inspect", { tx });
  assert.equal(done.ok, true, done.error);
  const decoded = sdk.getCompiledTransactionMessageDecoder().decode(bytes);
  const data = cutTransact(decoded, sdk.SHIELDED_POOL_PROGRAM_ID);
  assert.equal(done.result.salt, "4ea913073c961b60db4b5c2efcb2e3ea");
  assert.equal(done.result.firstNullifier, hex(data.subarray(data.length - 38, data.length - 6)));
  assert.match(done.result.firstNullifier, /^[0-9a-f]{64}$/);
  const short = /version 1|ends inside|decode|not a/i;
  await refused("inspect", { tx: "AQID" }, short, "a short message");
  await refused("inspect", { tx, extra: "x" }, /field "extra" is not allowed/, "an extra field");
  step("inspect gives the salt and the first nullifier of the transact data of a message");
}

// ---- SOL-4: local proving behind the switch of the group ----

const PROVE_URL = "https://devnet.helius-rpc.com/v1/zolana/prove";
const KEYS = "https://d3gbdb0egjwcw9.cloudfront.net/proving-keys/3a1c88f90f609eb1/";
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const toHelius = () => fetched.filter((url) => url.startsWith(PROVE_URL));

/** The ProgramData of the pool as the RPC gives it (a slice of 8 bytes: the deploy slot). */
function poolData(slot, owner = LOADER) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(slot));
  control.rpc.getAccountInfo = async () => ({
    value: { owner, data: [bytes.toString("base64"), "base64"] },
  });
}

async function payWith(answer) {
  gate.answer = answer;
  control.utxos = [syncedInput()];
  giveProof(proveBody());
  const posts = control.prove;
  // As the SDK does: a prover reply that is not ok fails the proof (CLIENT_PROVER_HTTP).
  control.prove = async (inputs) => {
    const sent = control.options.fetch;
    control.options.fetch = async (...args) => {
      const reply = await sent(...args);
      if (!reply.ok) throw new Error("WalletError: CLIENT_PROVER_HTTP");
      return reply;
    };
    try {
      return await posts(inputs);
    } finally {
      control.options.fetch = sent;
    }
  };
  return ask("prepare", { ...PREPARE, kind: "pay", avoid: [] });
}

/** Off: the page answers "hosted", and the prove call goes to Helius after one gate. */
async function hostedAfterTheGate() {
  await initialised();
  const done = await payWith({ mode: "hosted" });
  assert.equal(done.ok, true, done.error);
  assert.equal(gate.asked, 1, "the Worker proved without asking the page");
  assert.equal(toHelius().length, 1, "the hosted prover did not get the call");
  assert.deepEqual(proverControl.made, [], "a local prover was made for a hosted group");
  step("SOL-4 off: one gate per proof, then the hosted prover");
}

/** On: the web prover answers on the device; Helius gets nothing of the proof, ever after. */
async function localStaysOnTheDevice() {
  await initialised();
  const done = await payWith({ mode: "local" });
  assert.equal(done.ok, true, done.error);
  assert.deepEqual(toHelius(), [], "a local proof reached Helius");
  assert.equal(proverControl.calls.length, 1, "the web prover did not get the prove call");
  assert.match(proverControl.calls[0].url, /\/v1\/zolana\/prove\?/);
  const [made] = proverControl.made;
  assert.deepEqual([made.threads, made.proverUrl], [0, ZOLANA], "Go only, on the SDK prover URL");
  assert.equal(made.wasmUrl, "https://app.zigs.app/sol/prover/zolana-prover.wasm");
  assert.equal(done.result.expiry, "1792048408", "prepare did not read the traced body");
  const again = await payWith({ mode: "hosted" });
  assert.equal(again.ok, false, "a hosted proof after a local one");
  assert.match(again.error, /proved on the device before/);
  const { fetch: sdkFetch } = control.options;
  await assert.rejects(sdkFetch(`${PROVE_URL}/status?${KEY_NAME}=k`), /blocked a hosted proof/);
  assert.deepEqual(toHelius(), [], "the latch let a prove path through");
  step("SOL-4 on: the web prover answers here, and the Worker never proves hosted after it");
}

/** A refusal of the page proves nothing and sends nothing. */
async function refusedProvesNothing() {
  await initialised();
  const done = await payWith({ refuse: "Could not read the proving setting." });
  assert.equal(done.ok, false);
  assert.match(done.error, /^Could not read the proving setting\.$/);
  assert.deepEqual([toHelius(), proverControl.calls], [[], []], "a refused proof was made");
  const silent = await payWith({});
  assert.match(silent.error, /did not say how this group proves/, "an empty answer");
  assert.deepEqual(toHelius(), [], "an empty answer sent the proof to Helius");
  step("SOL-4 a refused or empty gate answer proves nothing, here or at Helius");
}

/** A failed local proof says why; when the pool moved, it says that first. */
async function localFailureTexts() {
  await initialised();
  proverControl.reply = () =>
    new Response('{"code":"wasm_key_download_failed"}', { status: 500 });
  poolData("508538476");
  const down = await payWith({ mode: "local" });
  assert.equal(down.ok, false);
  assert.match(down.error, /could not load the proving key.*Nothing was sent to Helius\.$/);
  poolData("508538477");
  const moved = await payWith({ mode: "local" });
  assert.match(moved.error, /^This group makes its proofs on its devices.*Helius changed the pool/);
  assert.deepEqual(toHelius(), [], "a failed local proof went to Helius");
  step("SOL-4 a failed local proof names its cause, and a moved pool first");
}

/** The guard lets GET of a key of our circuits pass, in the pinned folder only. */
async function keyFetchGuard() {
  await initialised();
  const { fetch: sdkFetch } = control.options;
  await sdkFetch(`${KEYS}transfer_confidential_1_2.key`);
  await sdkFetch(`${KEYS}transfer_confidential_8_2.key`, { method: "GET" });
  assert.equal(fetched.length, 2, "a key download was blocked");
  const blocked = [
    [`${KEYS}transfer_confidential_1_2.key`, { method: "POST", body: "x" }],
    [`${KEYS}transfer_confidential_1_4.key`],
    [`${KEYS}merge_8_1.key`],
    [`${KEYS}transfer_confidential_1_2.key?x=1`],
    [`${KEYS}sub/transfer_confidential_1_2.key`],
    ["https://d3gbdb0egjwcw9.cloudfront.net/proving-keys/other/transfer_confidential_1_2.key"],
    ["https://d3gbdb0egjwcw9.cloudfront.net/v1/zolana/prove"],
  ];
  for (const [url, init] of blocked) {
    await assert.rejects(async () => sdkFetch(url, init), /blocked a request to/, url);
  }
  assert.equal(fetched.length, 2, "a blocked request reached the network");
  step("SOL-4 the guard passes GET of a pinned N x 2 key and nothing else of that host");
}

/** selftest proves the pinned test request here; poolSlot reads the deploy slot of the pool. */
async function deviceCheckAndPool() {
  await initialised();
  const done = await ask("selftest", {});
  assert.equal(done.ok, true, done.error);
  assert.equal(typeof done.result.ms, "number");
  assert.equal(proverControl.calls[0].selftest, "{}", "the test request did not reach the prover");
  assert.deepEqual(toHelius(), []);
  proverControl.proveRequest = async () => {
    throw Object.assign(new Error("Prover worker failed"), { code: "wasm_worker_failed" });
  };
  const failed = await ask("selftest", {});
  assert.match(failed.error, /could not start the local prover.*Nothing was sent/);
  proverControl.proveRequest = async () => ({ proof: "{}" });
  poolData("508538476");
  const same = await ask("poolSlot", {});
  assert.deepEqual(same.result, { slot: "508538476", pinned: "508538476", text: null });
  poolData("600000000");
  assert.match((await ask("poolSlot", {})).result.text, /Helius changed the pool/);
  poolData("508538476", SYSTEM);
  assert.match((await ask("poolSlot", {})).error, /pool program data is missing/);
  step("SOL-4 selftest proves on the device; poolSlot reads the deploy slot of the pool");
}

await refusalsBeforeInit();
await initWiring();
await fetchGuard();
await everyUrlIsChecked();
await redirectMode();
await redirectIsRefused();
await loopbackNeedsTestMode();
await errorsAreRedacted();
await nonceVersion();
await finiteExpiry();
await expiryReadBack();
await payPreparesThePda();
await identitiesAndReads();
await reproveChecksTheCommitment();
await prepareRefusals();
await commandOrder();
await readCommands();
await inspectCommand();
await hostedAfterTheGate();
await localStaysOnTheDevice();
await refusedProvesNothing();
await localFailureTexts();
await keyFetchGuard();
await deviceCheckAndPool();
console.log("worker tests passed");
