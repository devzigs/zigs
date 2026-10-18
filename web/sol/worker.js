// The Solana Worker (ZOLANA.md 3.3). It owns all Helius traffic: sync, witness, proof request and
// the RPC calls of a proposal. The page gives it the role secrets of the group, never the FROST
// share, solSeed or a nonce. The group has two shielded identities: the PDA of the approvals
// program, which owns the funds (ZOLANA.md 7.2), and the group key, which owned the funds of the
// beta until they move to the PDA. The response of this script carries its own CSP (cf/src), so
// the policy binds this file and every module that it imports.
import * as sdk from "/sol/zolana.bundle.js";
import { checkCommand, makeRedactor } from "/sol/guard.js";
import { proposalFilters } from "/sol/owned.js";
import {
  commitmentOf,
  cutTransact,
  hex,
  parsePlan,
  parseTransact,
  planFromProve,
} from "/sol/prepare.js";
import {
  buildProofInputs,
  ownerSigners,
  rebuildProofInputs,
  spendableSum,
} from "/sol/transfer.js";

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

/** One identity: its address, its keys, its synced wallet and the owner that never pays. */
function identityOf(client, address, nullifierSecret, viewingSecret, groupOwner) {
  const viewing = sdk.ViewingKey.fromBytes(viewingSecret);
  const nullifierKey = sdk.NullifierKey.fromSecret(nullifierSecret);
  const full = address(nullifierKey.publicKey(), viewing.publicKey());
  const parts = { address: full, viewingKeys: [viewing], nullifierKey };
  return {
    address: full,
    viewing,
    keys: sdk.LocalKeys.fromKeys(parts, client.proofService),
    wallet: new sdk.Wallet({ identity: full }),
    owner: full.solanaAddress(),
    groupOwner,
  };
}

/** The two identities of the group: `old` (the group key) and `pda` (the approvals program). */
function shieldedKeys(args, client) {
  const secrets = [args.nullifierSecret, args.pdaNullifierSecret, args.viewingSecret].map(bytes);
  const [oldSecret, pdaSecret, viewingSecret] = secrets;
  try {
    const group = sdk.ShieldedPublicKey.fromEd25519(bytes(args.groupKey));
    const groupOwner = sdk.getAddressDecoder().decode(bytes(args.groupKey));
    const old = identityOf(
      client,
      (nullifierPk, viewingPk) => sdk.ShieldedAddress.fromPublicKeys(group, nullifierPk, viewingPk),
      oldSecret,
      Uint8Array.from(viewingSecret),
      groupOwner,
    );
    const pda = identityOf(
      client,
      (nullifierPublicKey, viewingPublicKey) =>
        sdk.ShieldedAddress.forPda({ pda: bytes(args.pda), nullifierPublicKey, viewingPublicKey }),
      pdaSecret,
      Uint8Array.from(viewingSecret),
      groupOwner,
    );
    return { old, pda };
  } finally {
    secrets.forEach((secret) => secret.fill(0));
  }
}

async function init(args) {
  const started = performance.now();
  const url = new URL(args.rpcUrl);
  redact.add(args.rpcUrl, url.search, url.searchParams.get("api-key"), args.nullifierSecret);
  redact.add(args.viewingSecret, args.pdaNullifierSecret);
  const zolana = new URL(url);
  zolana.pathname = "/v1/zolana";
  const trace = { prove: null };
  const client = await sdk.createZolanaClient({
    solanaRpcUrl: args.rpcUrl,
    indexerUrl: zolana.href,
    proverUrl: zolana.href,
    // The Helius gateway proves, as before. The SDK default is an attested enclave behind
    // another host, which this Worker neither reaches nor trusts yet (TICKETS.md SOL-4).
    proverTee: false,
    fetch: guardedFetch(url.origin, trace),
    computeUnitLimit: COMPUTE_UNITS,
  });
  const hasherMs = Math.round(performance.now() - started);
  const { old, pda } = shieldedKeys(args, client);
  session = { client, trace, old, pda };
  return {
    hasherMs,
    owner: old.owner,
    shielded: hex(old.address.toBytes()),
    ownerHash: hex(old.address.ownerHash()),
    pda: pda.owner,
    pdaShielded: hex(pda.address.toBytes()),
    pdaOwnerHash: hex(pda.address.ownerHash()),
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

async function syncOnce(s, identity, wallet = identity.wallet) {
  const { client } = s;
  const { keys } = identity;
  const slot = await client.solanaRpc.getSlot({ commitment: "confirmed" }).send();
  const report = await sdk.syncWallet({ client, wallet, keys });
  return {
    slot: slot.toString(),
    balance: wallet.balance(sdk.SOL_MINT).amount.toString(),
    movable: spendableSum(sdk, wallet, client.tree).toString(),
    storedUtxos: report.storedUtxos,
    undecryptable: report.undecryptableCandidates,
    utxos: wallet
      .utxos()
      .filter((u) => !u.spent)
      .map(utxoView),
  };
}

/** The sync of the funds of the group: the PDA identity. */
const sync = () => syncOnce(need(), need().pda);
/** The sync of the beta funds that the group key still holds, before their move to the PDA. */
const syncOld = () => syncOnce(need(), need().old);

async function accountData(address) {
  const { solanaRpc } = need().client;
  const options = { encoding: "base64", commitment: "confirmed" };
  const reply = await solanaRpc.getAccountInfo(address, options).send();
  if (reply.value === null) throw new Error("the account does not exist");
  const { owner, lamports, data } = reply.value;
  return { owner, lamports, data: fromBase64(data[0]) };
}

/** An account as the page checks it (a proposal account): owner, lamports and data, or none. */
async function account({ account: address }) {
  const { solanaRpc } = need().client;
  const options = { encoding: "base64", commitment: "confirmed" };
  const { value } = await solanaRpc.getAccountInfo(address, options).send();
  if (value === null) return { exists: false };
  const owner = hex(sdk.getAddressEncoder().encode(value.owner));
  const data = hex(fromBase64(value.data[0]));
  return { exists: true, owner, lamports: value.lamports.toString(), data };
}

/**
 * The recipient account of a withdrawal: owner, lamports and the executable flag, or none. It
 * reads no data, so a recipient with a large data area costs the device nothing.
 */
async function recipientAccount({ account: address }) {
  const { solanaRpc } = need().client;
  const dataSlice = { offset: 0, length: 0 };
  const options = { encoding: "base64", commitment: "confirmed", dataSlice };
  const { value } = await solanaRpc.getAccountInfo(address, options).send();
  if (value === null) return { exists: false };
  const owner = hex(sdk.getAddressEncoder().encode(value.owner));
  const executable = value.executable === true;
  return { exists: true, owner, lamports: value.lamports.toString(), executable };
}

/** The rent of an account of `space` bytes: what a proposal account holds until it closes. */
async function rent({ space }) {
  const { solanaRpc } = need().client;
  const lamports = await solanaRpc.getMinimumBalanceForRentExemption(BigInt(space)).send();
  return { lamports: lamports.toString() };
}

/** The latest transactions that name `account`: how a page finds the execute of a proposal. */
async function history({ account: address }) {
  const { solanaRpc } = need().client;
  // ponytail: one page of 1,000. More later transactions on a gone address read as "not
  // complete" until the expiry (ZOLANA.md 5.1). Upgrade path: page back with `before`.
  const options = { limit: 1000, commitment: "confirmed" };
  const found = await solanaRpc.getSignaturesForAddress(address, options).send();
  return found.map((x) => ({ signature: x.signature, failed: x.err !== null, slot: `${x.slot}` }));
}

const PROGRAM = "5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL";

/** The open proposals of `group` that pay the fee key `fee` (both hex), SOL-52 (owned.js). */
async function owned({ fee, group }) {
  const { solanaRpc } = need().client;
  const filters = proposalFilters(group, fee).map(({ memcmp }) => ({
    memcmp: { ...memcmp, offset: BigInt(memcmp.offset) },
  }));
  const options = { encoding: "base64", commitment: "confirmed", filters };
  const found = await solanaRpc.getProgramAccounts(PROGRAM, options).send();
  return found.map((x) => ({
    address: x.pubkey,
    lamports: x.account.lamports.toString(),
    data: hex(fromBase64(x.account.data[0])),
  }));
}

/** One landed transaction as its wire bytes (base64): the page looks for the approval in it. */
async function transaction({ signature }) {
  const { solanaRpc } = need().client;
  const options = { encoding: "base64", commitment: "confirmed" };
  const all = { ...options, maxSupportedTransactionVersion: 1 };
  const got = await solanaRpc.getTransaction(signature, all).send();
  if (!got) return { found: false, failed: false, tx: "" };
  return { found: true, failed: got.meta?.err != null, tx: got.transaction[0] };
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

/** What the page keeps of a proved transfer: the transact data, the plan and the spent inputs. */
function describePrepared(data, wallet, prove, expiry) {
  if (prove === null) throw new Error("the prover call was not seen");
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

/** The salt and the first nullifier of the transact data of a message (base64): the page compares
 * them with the pairs of the other proposals, so no pair is used twice (rule SaltReused). */
function inspect({ tx }) {
  const message = sdk.getCompiledTransactionMessageDecoder().decode(fromBase64(tx));
  const parsed = parseTransact(cutTransact(message, sdk.SHIELDED_POOL_PROGRAM_ID));
  return { salt: hex(parsed.salt), firstNullifier: parsed.firstNullifier };
}

/**
 * The payee of a payment from the bytes (hex) that the page gives: a ShieldedAddress, or for a
 * withdrawal the base58 address of the 32 byte key of the public recipient.
 */
function payeeOf(recipient, withdraw) {
  if (!withdraw) return { recipient: sdk.ShieldedAddress.fromBytes(bytes(recipient)) };
  if (recipient.length !== 64) throw new Error("the recipient of a withdrawal is not a key");
  return { withdrawTo: sdk.getAddressDecoder().decode(bytes(recipient)) };
}

/**
 * Syncs a fresh wallet of an identity, builds the proof inputs with the expiry bound and `payer`
 * as the fee payer (transfer.js), proves them and keeps the transact instruction data. `kind` is
 * "pay" or "withdraw" (a payment of the PDA identity to a shielded or a public address: the
 * approvals program signs for the PDA, so the instruction lists no owner signer) or "migrate" (the
 * move of the beta funds: whole UTXOs, at most `amount`; the group key is the owner signer, after
 * the nullifier accounts). One command runs at a time: the prover body of the call is kept in the
 * session for the plan.
 */
async function prepare({ kind, recipient, amount, expiry, payer, avoid }) {
  const s = need();
  const until = BigInt(expiry);
  if (until === 0n || until >= U64_MAX) throw new Error("the expiry must be finite");
  const migrate = kind === "migrate";
  const identity = migrate ? s.old : s.pda;
  const wallet = new sdk.Wallet({ identity: identity.address });
  await syncOnce(s, identity, wallet);
  s.trace.prove = null;
  const to = payeeOf(recipient, kind === "withdraw");
  const request = { ...to, amount: BigInt(amount), expiry: until, payer, whole: migrate, avoid };
  const { proofInputs, tree } = buildProofInputs(sdk, s.client, identity, wallet, request);
  const data = await s.client.proveTransact(proofInputs, identity.keys);
  const signers = migrate ? ownerSigners(sdk, proofInputs) : [];
  const call = { payer, ownerSigners: signers, inputTree: tree, outputTree: s.client.tree, data };
  const instruction = await sdk.transactInstruction(call);
  return describePrepared(instruction.data, wallet, s.trace.prove, until);
}

/**
 * A new proof of an approved payment (ZOLANA.md 7.2), paid by `payer`: the plan, the input ids and
 * the data of the first proof give the same proof inputs (transfer.js). `withdraw` is "0" for a
 * private payment to `recipient` (a shielded address), else the SOL that a withdrawal moves to the
 * public key `recipient`. The commitment of the first proof, of the rebuilt inputs and of the new
 * data must each be `commitment`, the value that the group approved, or nothing is proved or
 * returned.
 */
async function reprove({ recipient, withdraw, payer, plan, inputIds, transact, commitment }) {
  const s = need();
  const to = payeeOf(recipient, withdraw !== "0");
  const settled = to.withdrawTo ? recipient : null;
  const firstData = bytes(transact);
  if ((await commitmentOf(firstData, settled)) !== commitment) {
    throw new Error("the first proof does not give the approved commitment");
  }
  const wallet = new sdk.Wallet({ identity: s.pda.address });
  await syncOnce(s, s.pda, wallet);
  const leg = to.withdrawTo ? { to: to.withdrawTo, amount: BigInt(withdraw) } : null;
  const request = {
    recipient: to.recipient,
    withdraw: leg,
    payer,
    plan: parsePlan(plan),
    inputIds,
    first: parseTransact(firstData),
  };
  const proofInputs = rebuildProofInputs(sdk, s.client, s.pda, wallet, request);
  if (hex(proofInputs.messageHash()) !== commitment) {
    throw new Error("the rebuilt payment does not give the approved commitment");
  }
  const data = await s.client.proveTransact(proofInputs, s.pda.keys);
  const tree = s.client.tree;
  const call = { payer, ownerSigners: [], inputTree: tree, outputTree: tree, data };
  const instruction = await sdk.transactInstruction(call);
  if ((await commitmentOf(instruction.data, settled)) !== commitment) {
    throw new Error("the new proof does not give the approved commitment");
  }
  return { data: hex(instruction.data) };
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
  syncOld,
  account,
  recipientAccount,
  rent,
  history,
  transaction,
  owned,
  reprove,
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

// One command at a time, in order: prepare keeps the prover body of its call in the session.
let queue = Promise.resolve();
self.onmessage = (event) => {
  if (typeof event.data?.id !== "number") return;
  queue = queue.then(() => answer(event.data));
};
