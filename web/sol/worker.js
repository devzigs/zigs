// The Solana Worker (ZOLANA.md 3.3). It owns all Helius traffic: sync, witness, proof request and
// the RPC calls of a proposal. The page gives it the two role secrets of the group, never the
// FROST share, solSeed or a nonce. The response of this script carries its own CSP (cf/src), so
// the policy binds this file and every module that it imports.
import * as sdk from "/sol/zolana.bundle.js";
import { checkCommand, makeRedactor } from "/sol/guard.js";
import { cutTransact, hex, parseTransact, planFromProve } from "/sol/prepare.js";

// Caps of the P3 template (ZOLANA.md 5): the compute limit of a transact.
const COMPUTE_UNITS = 217_000;
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const U64_MAX = 0xffff_ffff_ffff_ffffn;
const CONFIRM_MS = 60_000;

const redact = makeRedactor();
let session = null;

const bytes = (text) => Uint8Array.from(text.match(/../g) ?? [], (h) => parseInt(h, 16));
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function need() {
  if (session === null) throw new Error("the Worker is not initialised");
  return session;
}

/**
 * All SDK traffic goes through here: one origin only, and the prover body is kept for prepare.
 * Every call checks its own URL and fetches the URL that it checked. A redirect is an error, so
 * no second URL is ever fetched without a check.
 */
function guardedFetch(origin, trace) {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin) throw new Error(`blocked a request to ${url.host}`);
    if (init?.method === "POST" && url.pathname === "/v1/zolana/prove") {
      trace.prove = typeof init.body === "string" ? JSON.parse(init.body) : null;
    }
    return fetch(input instanceof Request ? input : url.href, { ...init, redirect: "error" });
  };
}

function shieldedKeys(args, client) {
  const nullifierSecret = bytes(args.nullifierSecret);
  const viewingSecret = bytes(args.viewingSecret);
  try {
    const viewing = sdk.ViewingKey.fromBytes(viewingSecret);
    const nullifier = sdk.NullifierKey.fromSecret(nullifierSecret);
    const owner = sdk.ShieldedPublicKey.fromEd25519(bytes(args.groupKey));
    const address = sdk.ShieldedAddress.fromPublicKeys(
      owner,
      nullifier.publicKey(),
      viewing.publicKey(),
    );
    const parts = { address, viewingKeys: [viewing], nullifierKey: nullifier };
    return { address, keys: sdk.LocalKeys.fromKeys(parts, client.proofService) };
  } finally {
    nullifierSecret.fill(0);
    viewingSecret.fill(0);
  }
}

async function init(args) {
  const started = performance.now();
  const url = new URL(args.rpcUrl);
  redact.add(args.rpcUrl, url.search, url.searchParams.get("api-key"), args.nullifierSecret);
  redact.add(args.viewingSecret);
  const zolana = new URL(url);
  zolana.pathname = "/v1/zolana";
  const trace = { prove: null };
  const client = await sdk.createZolanaClient({
    solanaRpcUrl: args.rpcUrl,
    indexerUrl: zolana.href,
    proverUrl: zolana.href,
    fetch: guardedFetch(url.origin, trace),
    computeUnitLimit: COMPUTE_UNITS,
  });
  const hasherMs = Math.round(performance.now() - started);
  const { address, keys } = shieldedKeys(args, client);
  const wallet = new sdk.Wallet({ identity: address });
  session = { client, keys, address, wallet, trace, owner: address.solanaAddress() };
  return {
    hasherMs,
    owner: session.owner,
    shielded: hex(address.toBytes()),
    ownerHash: hex(address.ownerHash()),
  };
}

function utxoView(entry) {
  return {
    hash: hex(entry.outputContext.hash),
    mint: entry.utxo.asset,
    amount: entry.utxo.amount.toString(),
    blinding: hex(entry.utxo.blinding),
    tree: entry.outputContext.tree,
    leaf: entry.outputContext.leafIndex.toString(),
  };
}

async function syncOnce(s, wallet) {
  const { client, keys } = s;
  const slot = await client.solanaRpc.getSlot({ commitment: "confirmed" }).send();
  const report = await sdk.syncWallet({ client, wallet, keys });
  return {
    slot: slot.toString(),
    balance: wallet.balance(sdk.SOL_MINT).amount.toString(),
    storedUtxos: report.storedUtxos,
    undecryptable: report.undecryptableCandidates,
    utxos: wallet
      .utxos()
      .filter((u) => !u.spent)
      .map(utxoView),
  };
}

const sync = () => syncOnce(need(), need().wallet);

async function accountData(address) {
  const { solanaRpc } = need().client;
  const reply = await solanaRpc.getAccountInfo(address, { encoding: "base64" }).send();
  if (reply.value === null) throw new Error("the account does not exist");
  const { owner, lamports, data } = reply.value;
  return { owner, lamports, data: fromBase64(data[0]) };
}

async function blockhash() {
  const { value } = await need().client.solanaRpc.getLatestBlockhash().send();
  const key = sdk.getAddressEncoder().encode(value.blockhash);
  return {
    blockhash: value.blockhash,
    blockhashHex: hex(key),
    lastValidBlockHeight: value.lastValidBlockHeight.toString(),
  };
}

async function readNonce({ account }) {
  const info = await accountData(account);
  if (info.owner !== SYSTEM_PROGRAM) throw new Error("the account is not owned by System");
  const view = new DataView(info.data.buffer, info.data.byteOffset, info.data.byteLength);
  // Version tag at 0 (0 is Legacy: its blockhash is not the durable nonce; 1 is Current).
  const { length } = info.data;
  const current = length === 80 && view.getUint32(0, true) === 1 && view.getUint32(4, true) === 1;
  if (!current) throw new Error("the account is not an initialised nonce account with version 1");
  const decoder = sdk.getAddressDecoder();
  const nonce = info.data.subarray(40, 72);
  return {
    authority: decoder.decode(info.data.subarray(8, 40)),
    nonce: decoder.decode(nonce),
    nonceHex: hex(nonce),
    lamports: info.lamports.toString(),
  };
}

async function treeFees({ tree }) {
  const info = await accountData(tree);
  if (info.owner !== sdk.SHIELDED_POOL_PROGRAM_ID) {
    throw new Error("the tree is not a pool account");
  }
  const { fees, feeBalance } = sdk.decodeTreeFees(info.data);
  return {
    feePerNullifier: fees.feePerNullifier.toString(),
    appendReimbursement: fees.appendReimbursement.toString(),
    closeReimbursement: fees.closeReimbursement.toString(),
    feeBalance: feeBalance.toString(),
  };
}

/** The synced UTXO of each input of the prover body, found by its blinding. */
function inputsWithIds(plan, wallet) {
  const byBlinding = new Map(wallet.utxos().map((u) => [hex(u.utxo.blinding), u]));
  return plan.inputs.map((input) => {
    const found = byBlinding.get(input.blinding);
    if (found === undefined) throw new Error("an input of the proof is not in the synced wallet");
    return { id: hex(found.outputContext.hash), tree: found.outputContext.tree, ...input };
  });
}

function describePrepared(tx, wallet, prove, expiry) {
  if (prove === null) throw new Error("the prover call was not seen");
  const message = sdk.getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  const data = cutTransact(message, sdk.SHIELDED_POOL_PROGRAM_ID);
  const parsed = parseTransact(data);
  if (parsed.expiry !== expiry) throw new Error("the expiry in the data differs from the request");
  const plan = planFromProve(prove);
  if (plan.outputs.length !== parsed.outputs || plan.inputs.length !== parsed.inputs) {
    const inPlan = `${plan.inputs.length} real inputs and ${plan.outputs.length} outputs`;
    const inData = `${parsed.inputs} inputs and ${parsed.outputs} outputs`;
    throw new Error(`the proof has ${inPlan} but the instruction has ${inData}`);
  }
  return {
    data: hex(data),
    expiry: parsed.expiry.toString(),
    salt: hex(parsed.salt),
    blindingSeed: plan.blindingSeed,
    outputs: plan.outputs,
    inputs: inputsWithIds(plan, wallet),
  };
}

/** The salt and the first nullifier of the transact data of a message (base64): the page keeps
 * the pairs of the proposals that it approved, so no pair is used twice (rule SaltReused). */
function inspect({ tx }) {
  const message = sdk.getCompiledTransactionMessageDecoder().decode(fromBase64(tx));
  const parsed = parseTransact(cutTransact(message, sdk.SHIELDED_POOL_PROGRAM_ID));
  return { salt: hex(parsed.salt), firstNullifier: parsed.firstNullifier };
}

/** One proof at a time: the expiry is a module variable of the SDK. Syncs a fresh wallet first. */
async function prepare({ recipient, amount, expiry }) {
  const s = need();
  const until = BigInt(expiry);
  if (until === 0n || until >= U64_MAX) throw new Error("the expiry must be finite");
  const wallet = new sdk.Wallet({ identity: s.address });
  await syncOnce(s, wallet);
  s.trace.prove = null;
  sdk.setProofExpiry(until);
  try {
    const tx = await sdk.buildTransferTransaction({
      client: s.client,
      wallet,
      keys: s.keys,
      feePayer: s.owner,
      recipient: sdk.ShieldedAddress.fromBytes(bytes(recipient)),
      amount: BigInt(amount),
    });
    return describePrepared(tx, wallet, s.trace.prove, until);
  } finally {
    sdk.setProofExpiry(U64_MAX);
  }
}

// A simulation error such as {"InstructionError":[1,{"Custom":7008}]}: u64 numbers may arrive
// as bigint, and JSON.stringify refuses those. Small ones go back as numbers.
const plain = (_key, value) => {
  if (typeof value !== "bigint") return value;
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : `${value}`;
};

async function runSimulation(tx, sigVerify) {
  const options = { encoding: "base64", sigVerify, commitment: "confirmed" };
  const { value } = await need().client.solanaRpc.simulateTransaction(tx, options).send();
  return {
    err: value.err === null ? null : JSON.stringify(value.err, plain),
    unitsConsumed: String(value.unitsConsumed ?? ""),
    logs: (value.logs ?? []).slice(-6),
  };
}

/** A signed transaction, with its signatures checked. */
const simulate = ({ tx }) => runSimulation(tx, true);
/** A message with a zero signature: the signatures are not checked, so no signer is needed yet. */
const preflight = ({ tx }) => runSimulation(tx, false);

async function balance({ account }) {
  const { solanaRpc } = need().client;
  const { value } = await solanaRpc.getBalance(account, { commitment: "confirmed" }).send();
  return { lamports: value.toString() };
}

/** One look at a signature: none, pending (seen, not confirmed), confirmed, finalized, failed. */
async function status({ signature }) {
  const { value } = await need().client.solanaRpc.getSignatureStatuses([signature]).send();
  const seen = value[0];
  if (!seen) return { status: "none", slot: "" };
  const slot = seen.slot.toString();
  if (seen.err) return { status: "failed", slot };
  const confirmed = ["confirmed", "finalized"].includes(seen.confirmationStatus);
  return { status: confirmed ? seen.confirmationStatus : "pending", slot };
}

async function send({ tx }) {
  const options = { encoding: "base64", preflightCommitment: "confirmed" };
  return { signature: await need().client.solanaRpc.sendTransaction(tx, options).send() };
}

async function confirm({ signature }) {
  const { solanaRpc } = need().client;
  const end = Date.now() + CONFIRM_MS;
  while (Date.now() < end) {
    const { value } = await solanaRpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) return { status: "failed", slot: status.slot.toString() };
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return { status: status.confirmationStatus, slot: status.slot.toString() };
    }
    await sleep(1500);
  }
  return { status: "unknown", slot: "" };
}

const HANDLERS = {
  init,
  sync,
  blockhash,
  readNonce,
  treeFees,
  prepare,
  inspect,
  balance,
  simulate,
  preflight,
  send,
  status,
  confirm,
};

async function answer({ id, cmd, args }) {
  try {
    const input = args ?? {};
    checkCommand(cmd, input);
    const result = await HANDLERS[cmd](input);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: redact(`${err?.name ?? "Error"}: ${err?.message}`) });
  }
}

// One command at a time, in order: prepare changes a module variable of the SDK.
let queue = Promise.resolve();
self.onmessage = (event) => {
  if (typeof event.data?.id !== "number") return;
  queue = queue.then(() => answer(event.data));
};
