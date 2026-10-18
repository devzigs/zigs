// The live Devnet check of SOL-52: a new fee key gets back the rent of its expired proposal with
// the cancel that the checker compiles and signs. Run from the repository root (Node 24):
//   node wasm-sol/tools/rent_live.mjs <funder keypair JSON file> [RPC URL]
// It funds a new fee key of a new test group with 0.003 SOL and creates one proposal that expires
// 60 s later. Before the expiry the network must refuse its cancel (NotAbortAuthority, 6017, a
// simulation without a fee). After the expiry the page filter finds it, the cancel lands, and the
// rent comes back. The rest goes back to the funder, also when a check fails. It spends the fees
// of 4 transactions: 20,000 lamports.
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, randomBytes, sign } from "node:crypto";
import fs from "node:fs";
import { base58 } from "../../web/sol/docs.js";
import {
  bytesOf,
  hexOf,
  intentHex,
  pinsHex,
  snapshotHex,
  wireBase64,
} from "../../web/sol/intent.js";
import { proposalFilters } from "../../web/sol/owned.js";
import { proposalOf, reclaimable } from "../../web/sol/rent.js";
import * as W from "../../web/sol/wasm/sol_wasm.js";
import * as kit from "../../web/sol/zolana.bundle.js";

const [funderFile, RPC = "https://api.devnet.solana.com"] = process.argv.slice(2);
if (!funderFile) throw new Error("usage: node wasm-sol/tools/rent_live.mjs <funder JSON> [RPC]");
const wasm = new URL("../../web/sol/wasm/sol_wasm_bg.wasm", import.meta.url);
W.initSync({ module: fs.readFileSync(wasm) });

const PROGRAM = "5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL";
const SYSTEM = "11111111111111111111111111111111";
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
const FUND = 3_000_000n;
const FEE = 5_000n;
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const le64 = (n) => Buffer.from(new BigUint64Array([BigInt(n)]).buffer).toString("hex");
const keyHex = (address) => hexOf(kit.getAddressEncoder().encode(address));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const log = (...line) => console.log(new Date().toISOString().slice(11, 19), ...line);

async function rpc(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const headers = { "content-type": "application/json" };
  const reply = await (await fetch(RPC, { method: "POST", body, headers })).json();
  if (reply.error) throw new Error(method + ": " + JSON.stringify(reply.error));
  return reply.result;
}

/** An Ed25519 key from its 32-byte seed: the signing key, the seed and the public key (hex). */
function keyOf(seed) {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: "der", type: "pkcs8" });
  const spki = createPublicKey(key).export({ format: "der", type: "spki" });
  return { key, seed: hexOf(seed), public: hexOf(spki.subarray(12)) };
}

const funder = keyOf(Buffer.from(JSON.parse(fs.readFileSync(funderFile, "utf8"))).subarray(0, 32));
const fee = keyOf(randomBytes(32));
const groupKey = keyOf(randomBytes(32)).public;
const solSeed = hexOf(randomBytes(32));
const roles = JSON.parse(W.sol_roles(solSeed, groupKey));
const pda = JSON.parse(W.sol_pda_roles(solSeed, groupKey));
const done = {
  groupKey,
  nullifierPk: roles.nullifier_pk,
  viewingPk: roles.viewing_pk,
  pdaNullifierPk: pda.nullifier_pk,
};
const pins = bytesOf(pinsHex(done, fee.public));
const snapshot = bytesOf(snapshotHex({ ...roles, nullifier_secret: pda.nullifier_secret }));

const compact = (n) => (n < 128 ? [n] : [(n & 0x7f) | 0x80, n >> 7]);

/**
 * A legacy transaction of one instruction, signed by `signer`, the payer. `keys`: [address,
 * signer, writable], the signers first, then the writable accounts, the program last.
 */
function legacyTx(signer, keys, accounts, data, blockhash) {
  const count = (s, w) => keys.filter(([, x, y]) => x === s && y === w).length;
  const message = Buffer.concat([
    Buffer.from([count(true, true) + count(true, false), count(true, false), count(false, false)]),
    Buffer.from(compact(keys.length)),
    ...keys.map(([address]) => Buffer.from(kit.getAddressEncoder().encode(address))),
    Buffer.from(kit.getAddressEncoder().encode(blockhash)),
    Buffer.from([1, keys.length - 1, ...compact(accounts.length), ...accounts]),
    Buffer.from(compact(data.length)),
    data,
  ]);
  const signature = sign(null, message, signer.key);
  return Buffer.concat([Buffer.from([1]), signature, message]).toString("base64");
}

async function land(tx) {
  const options = { encoding: "base64", preflightCommitment: "confirmed" };
  const signature = await rpc("sendTransaction", [tx, options]);
  for (let i = 0; i < 60; i++) {
    const [status] = (await rpc("getSignatureStatuses", [[signature]])).value;
    if (status?.err) throw new Error("failed: " + signature + " " + JSON.stringify(status.err));
    if (["confirmed", "finalized"].includes(status?.confirmationStatus)) return signature;
    await sleep(1000);
  }
  throw new Error("not confirmed: " + signature);
}

const read = (method, address) =>
  rpc(method, [address, { encoding: "base64", commitment: "confirmed" }]);
const blockhash = async () => (await rpc("getLatestBlockhash", [{}])).value.blockhash;
const balance = async (hex) => BigInt((await read("getBalance", base58(hex))).value);
const exists = async (address) => (await read("getAccountInfo", address)).value !== null;
async function chainNow() {
  const { value } = await read("getAccountInfo", CLOCK);
  return Buffer.from(value.data[0], "base64").readBigInt64LE(32);
}

function transfer(from, to, lamports, hash) {
  const keys = [
    [base58(from.public), true, true],
    [base58(to), false, true],
    [SYSTEM, false, false],
  ];
  const data = Buffer.from("02000000" + le64(lamports), "hex");
  return legacyTx(from, keys, [0, 1], data, hash);
}

/** The cancel that the checker compiles for the fee key, signed through the check, as a tx. */
function cancelTx(p, hash) {
  const fields = { commitment: p.commitment, expiry: p.expiry, blockhash: keyHex(hash) };
  const intent = bytesOf(intentHex("cancelProposal", fields));
  const message = W.compile_message(intent, pins, new Uint8Array(0));
  const round = JSON.stringify({ now: Math.floor(Date.now() / 1000), secret: fee.seed });
  const signature = W.sol_fee_sign(message, intent, pins, snapshot, round);
  return { message, tx: wireBase64(message, bytesOf(signature)) };
}

/** The account addresses of the approvals program instruction of a v1 message. */
function programAccounts(message) {
  const m = kit.getCompiledTransactionMessageDecoder().decode(message);
  const i = m.instructionHeaders.findIndex(
    (head) => m.staticAccounts[head.programAccountIndex] === PROGRAM,
  );
  return [...m.instructionPayloads[i].instructionAccountIndices].map((x) => m.staticAccounts[x]);
}

/** The `create` of a proposal whose body names the fee key alone, as the beta writes it. */
async function create(expiry) {
  const commitment = hexOf(randomBytes(32));
  const proposal = programAccounts(cancelTx({ commitment, expiry }, SYSTEM).message)[1];
  const body = commitment + groupKey + le64(expiry) + fee.public + "01" + fee.public;
  const keys = [
    [base58(fee.public), true, true],
    [proposal, false, true],
    [SYSTEM, false, false],
    [PROGRAM, false, false],
  ];
  const data = Buffer.from("00" + body, "hex");
  await land(legacyTx(fee, keys, [0, 1, 2], data, await blockhash()));
  return { commitment, expiry, proposal };
}

/** What the page offers now: the Worker filter (owned.js), then `reclaimable`. */
async function offer() {
  const filters = proposalFilters(groupKey, fee.public);
  const options = { encoding: "base64", commitment: "confirmed", filters };
  const found = await rpc("getProgramAccounts", [PROGRAM, options]);
  const proposals = found.map((x) =>
    proposalOf({
      address: x.pubkey,
      lamports: String(x.account.lamports),
      data: Buffer.from(x.account.data[0], "base64").toString("hex"),
    }),
  );
  return reclaimable(proposals, { group: groupKey, fee: fee.public, now: await chainNow() });
}

async function check() {
  const p = await create((await chainNow()) + 60n);
  log("created", p.proposal);
  assert.deepEqual(await offer(), [], "nothing before the expiry");
  const early = await rpc("simulateTransaction", [
    cancelTx(p, await blockhash()).tx,
    { encoding: "base64", sigVerify: true, commitment: "confirmed" },
  ]);
  assert.match(JSON.stringify(early.value.err), /"Custom":6017/, "refused before the expiry");
  log("the network refuses the cancel before the expiry:", JSON.stringify(early.value.err));
  while ((await chainNow()) <= p.expiry) await sleep(5000);
  assert.deepEqual((await offer()).map((x) => x.address), [p.proposal]);
  log("cancel after the expiry", await land(cancelTx(p, await blockhash()).tx));
  assert.equal(await exists(p.proposal), false);
  assert.deepEqual(await offer(), []);
  assert.equal(await balance(fee.public), FUND - 2n * FEE, "the rent came back: 2 fees are gone");
}

log("fee key", base58(fee.public), "test group", base58(groupKey), "RPC", new URL(RPC).host);
log("fund", await land(transfer(funder, fee.public, FUND, await blockhash())));
try {
  await check();
  log("passed: 4 transactions, 20,000 lamports of fees");
} finally {
  const left = await balance(fee.public);
  const back = left > FEE && transfer(fee, funder.public, left - FEE, await blockhash());
  if (back) log("return", await land(back));
}
