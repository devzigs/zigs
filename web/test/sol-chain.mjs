// A fake chain behind a fake Solana Worker, for sol-sessions.mjs. The page starts its Worker with
// `new Worker(...)` and talks to it by messages, so this installs a Worker class that answers the
// commands of web/sol/guard.js from a small model of Devnet: balances, one nonce account, the
// blockhashes that it issued, and the transactions that landed. The model is strict where the
// real chain is: a lifetime that is not current is refused, a signature that Node's own Ed25519
// does not verify under the key of its signer is refused (the payer signs first, then the group
// key), a payer with no SOL for the fee is refused, and a transaction that the group signed
// advances the nonce when it lands. A transaction that the group does not sign (Add SOL) uses a
// recent blockhash and leaves the nonce alone.
//
// The approvals program (ZOLANA.md 7.2) is modelled too: `create` stores the proposal account at
// the address that its body gives, and `execute` lands only after an Ed25519 instruction whose
// signature Node verifies under the group key over the approval digest of the stored body; it
// closes the account. `reprove` answers from `chain.reproved`, as the prover would.
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { base58 } from "../sol/docs.js";
import { nonceAccountHex } from "../sol/intent.js";
import { proposalFilters } from "../sol/owned.js";
import * as kit from "../sol/zolana.bundle.js";
import { config } from "./sol-rig.mjs";

const POLICY =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; " +
  "connect-src 'self' https://devnet.helius-rpc.com " +
  "https://d3gbdb0egjwcw9.cloudfront.net/proving-keys/3a1c88f90f609eb1/; base-uri 'none'";
export const RPC = config.rpcUrl;
// The deploy slot of the pool that web/sol/localprover.js pins.
export const POOL_SLOT = "512563584";
const SPKI = Buffer.from("302a300506032b6570032100", "hex");
const hex = (bytes) => Buffer.from(bytes).toString("hex");

/** True when Node's Ed25519 verifies `signature` over `message` under the 32 byte key. */
export function verifies(groupKeyHex, message, signature) {
  const der = Buffer.concat([SPKI, Buffer.from(groupKeyHex, "hex")]);
  const key = createPublicKey({ key: der, format: "der", type: "spki" });
  return verify(null, message, key, signature);
}

const FEE = 5000n;
const PROGRAM = "5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL";
const ED25519 = "Ed25519SigVerify111111111111111111111111111";
const GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const keyHex = (address) => hex(kit.getAddressEncoder().encode(address));
const PDA_MARKER = Buffer.from("ProgramDerivedAddress");
const sha256 = (...parts) => {
  const h = createHash("sha256");
  parts.forEach((p) => h.update(p));
  return h.digest();
};

/** The chain view of a group: its keys, its two addresses and its nonce account. */
export async function chainGroup(W, done, solSeed) {
  const roles = JSON.parse(W.sol_roles(solSeed, done.groupKey));
  const pda = JSON.parse(W.sol_pda_roles(solSeed, done.groupKey));
  return {
    key: done.groupKey,
    owner: base58(done.groupKey),
    shielded: roles.address,
    nonceAccount: base58(await nonceAccountHex(done.groupKey)),
    pda: base58(pda.pda),
    pdaShielded: pda.address,
  };
}

/** The instructions of a v1 message: program, account addresses and data (hex). */
function instructionsOf(message) {
  const m = kit.getCompiledTransactionMessageDecoder().decode(message);
  const keys = m.staticAccounts;
  return m.instructionHeaders.map((head, i) => ({
    program: keys[head.programAccountIndex],
    accounts: [...m.instructionPayloads[i].instructionAccountIndices].map((at) => keys[at]),
    data: hex(m.instructionPayloads[i].instructionData),
  }));
}

/**
 * The canonical bump of a proposal address: the bump whose hash is the address. Version 5 seeds:
 * "proposed_transaction", the group key, the commitment and SHA-256(body).
 */
function bumpOf(address, body) {
  const seeds = [Buffer.from("proposed_transaction"), Buffer.from(body.slice(64, 128), "hex")];
  seeds.push(Buffer.from(body.slice(0, 64), "hex"), sha256(Buffer.from(body, "hex")));
  const program = Buffer.from(keyHex(PROGRAM), "hex");
  for (let bump = 255; bump >= 0; bump--) {
    const made = sha256(...seeds, Buffer.from([bump]), program, PDA_MARKER);
    if (made.toString("hex") === keyHex(address)) return bump;
  }
  return null;
}

// The SOL interface of the Devnet pool (`["sol_interface", 0]`): the first settlement account of
// a withdrawal.
const SOL_INTERFACE = "2iAazE9tAWcUJhNhfscRzX17Gb32Km9jJYZLGy1AnkVP";

/** A cursor over `data` from `at`: each read moves it first, so a skip uses the value read. */
function reader(data, at) {
  return {
    u8: () => data[at++],
    u16: () => {
      at += 2;
      return data.readUInt16LE(at - 2);
    },
    skip: (n) => {
      at += n;
    },
    at: () => at,
  };
}

/** The outputs of a transact: hash, owner tag (inline 32 bytes or an index) and data. */
function skipOutputs(r) {
  for (let n = r.u8(); n > 0; n--) {
    r.skip(32);
    r.skip(r.u8() === 0 ? 32 : 1);
    r.skip(r.u8() === 1 ? r.u16() : 0);
  }
}

/**
 * The pool `transact` data of an execute (tag 1, then the bytes after the tag 16), read as the
 * pool reads it: the number of legs, the bytes that the external-data hash covers and
 * private_tx_hash. Its own reader, so a defect of the page parser does not hide here.
 */
function executeTransact(dataHex) {
  const data = Buffer.concat([Buffer.from([16]), Buffer.from(dataHex.slice(2), "hex")]);
  const r = reader(data, 1 + 8 + 33 + 16);
  const legs = r.u8();
  for (let n = legs; n > 0; n--) r.skip(r.u8() >= 2 ? 9 : 8);
  for (let i = 0; i < 2; i++) r.skip(r.u8() === 1 ? 32 : 0);
  skipOutputs(r);
  for (let n = r.u8(); n > 0; n--) {
    r.skip(32);
    r.skip(r.u16());
  }
  const at = r.at();
  return { legs, prefix: data.subarray(0, at), privateTxHash: data.subarray(at, at + 32) };
}

/**
 * The accounts after the owner PDA must be one (SOL interface, recipient) pair per leg (6016),
 * and the commitment of the data with them must be the one of the stored body (6014).
 */
function settlementRefusal(ix, body) {
  const owner = ix.accounts[2];
  const after = ix.accounts.slice(ix.accounts.lastIndexOf(owner) + 1);
  const tx = executeTransact(ix.data);
  const pairs = after.every((key, n) => n % 2 === 1 || key === SOL_INTERFACE);
  if (after.length !== 2 * tx.legs || !pairs) return "Custom 6016";
  const external = sha256(tx.prefix, ...after.map((key) => Buffer.from(keyHex(key), "hex")));
  external[0] = 0;
  const commitment = sha256(tx.privateTxHash, external).toString("hex");
  return commitment === body.slice(0, 64) ? null : "Custom 6014";
}

const CLOCK = "SysvarC1ock11111111111111111111111111111111";
const le64 = (n) => Buffer.from(new BigUint64Array([BigInt(n)]).buffer).toString("hex");
const expiryOf = (stored) => Buffer.from(stored.data.slice(132, 148), "hex").readBigUInt64LE(0);

/**
 * `cancel` (SOL-52) of an open proposal. The message of the page carries no abort authority, so
 * the program refuses it before the expiry (NotAbortAuthority).
 */
function cancelRefusal(chain, ix) {
  const stored = chain.accounts.get(ix.accounts[1]);
  if (!stored?.data.startsWith("01")) return "Custom 6006";
  return chain.now > expiryOf(stored) || ix.accounts.length > 5 ? null : "Custom 6017";
}

/** Why the program refuses one instruction (`ixs[i]`), or null. */
function refusalOf(chain, ixs, i) {
  const ix = ixs[i],
    proposal = ix.accounts[1];
  if (ix.data === "02") return cancelRefusal(chain, ix);
  if (ix.data.startsWith("00")) {
    // System error 0 in the create CPI, as the Worker gives it: the account is in use.
    if (chain.accounts.has(proposal)) return `{"InstructionError":[${i},{"Custom":0}]}`;
    return bumpOf(proposal, ix.data.slice(2)) === null ? "Custom 6005" : null;
  }
  if (!ix.data.startsWith("01")) return "InvalidInstructionData";
  const stored = chain.accounts.get(proposal);
  if (!stored) return "Custom 6001";
  const body = stored.data.slice(4);
  if (!approves(chain, ixs[i - 1], proposal, body)) return "Custom 6012";
  return settlementRefusal(ix, body);
}

/** Why the approvals program would refuse the message, or null (the effects come in `land`). */
function programRefusal(chain, ixs) {
  for (const [i, ix] of ixs.entries()) {
    const refusal = ix.program === PROGRAM ? refusalOf(chain, ixs, i) : null;
    if (refusal) return refusal;
  }
  return null;
}

/** The instruction before `execute` verifies the group signature over the approval digest. */
function approves(chain, approval, proposal, body) {
  if (!approval || approval.program !== ED25519 || approval.data.length !== 288) return false;
  const d = approval.data;
  const [key, sig, digest] = [d.slice(32, 96), d.slice(96, 224), d.slice(224)];
  const want = sha256(
    Buffer.from("Zigs_SolApproval_v1"),
    Buffer.from(keyHex(GENESIS), "hex"),
    Buffer.from(keyHex(PROGRAM), "hex"),
    Buffer.from(keyHex(proposal), "hex"),
    Buffer.from(body, "hex"),
  ).toString("hex");
  const group = body.slice(64, 128);
  const signed = verifies(group, Buffer.from(want, "hex"), Buffer.from(sig, "hex"));
  return key === group && digest === want && signed;
}

/** True when the account data (hex) holds the bytes of an RPC `memcmp` filter at its offset. */
function held(data, { offset, bytes, encoding }) {
  const part = Buffer.from(bytes, encoding).toString("hex");
  return data.slice(2 * offset, 2 * offset + part.length) === part;
}

/** `cancel` closes the proposal and pays its rent to the rent recipient of its body. */
function cancelLanded(chain, proposal) {
  const stored = chain.accounts.get(proposal);
  const to = base58(stored.data.slice(148, 212));
  chain.balances.set(to, (chain.balances.get(to) ?? 0n) + BigInt(stored.lamports ?? "1356360"));
  chain.accounts.delete(proposal);
}

/** The effects of a landed message on the approvals program, and the history of its accounts. */
function programLanded(chain, ixs, signature) {
  for (const ix of ixs.filter((x) => x.program === PROGRAM)) {
    const proposal = ix.accounts[1];
    const seen = chain.history.get(proposal) ?? [];
    chain.history.set(proposal, [{ signature, failed: false, slot: "11" }, ...seen]);
    if (ix.data === "02") cancelLanded(chain, proposal);
    else if (ix.data.startsWith("00")) {
      const body = ix.data.slice(2);
      const bump = bumpOf(proposal, body).toString(16).padStart(2, "0");
      chain.accounts.set(proposal, { owner: keyHex(PROGRAM), data: "01" + bump + body });
    } else chain.accounts.delete(proposal);
  }
}
// A v1 transaction: the message, then one signature per required signer (byte 1 of the message).
// The keys of the message start at byte 42.
const wire = (tx) => {
  const bytes = Buffer.from(tx, "base64");
  const signers = bytes[1];
  const cut = bytes.length - 64 * signers;
  const sigs = Array.from({ length: signers }, (_, i) =>
    bytes.subarray(cut + 64 * i, cut + 64 * (i + 1)),
  );
  const message = bytes.subarray(0, cut);
  const keys = Array.from({ length: message[41] }, (_, i) =>
    hex(message.subarray(42 + 32 * i, 74 + 32 * i)),
  );
  return { message, sigs, keys };
};
const ran = (err) => ({ err, unitsConsumed: "1", logs: [] });
const groupSigns = (chain, { keys }) => keys.includes(chain.group.key);

// Why the network would refuse this transaction now, or null. A message is current when its
// lifetime is a blockhash that was issued (before the nonce account, and for a transaction that
// the group does not sign) or the nonce (after).
function lifetimeRefusal(chain, parts) {
  const life = hex(parts.message.subarray(8, 40));
  const onNonce = groupSigns(chain, parts) && chain.nonce !== null;
  const known = onNonce ? life === chain.nonce : chain.blockhashes.has(life);
  return known ? null : "BlockhashNotFound";
}

// The payer, the first key, must hold the fee of every signature.
function feeRefusal(chain, { sigs, keys }) {
  const held = chain.balances.get(base58(keys[0])) ?? 0n;
  if (held >= FEE * BigInt(sigs.length)) return null;
  return held === 0n ? "AccountNotFound" : "InsufficientFundsForFee";
}

// Every signature must verify under the key of its signer.
function signatureRefusal({ message, sigs, keys }) {
  const bad = sigs.findIndex((sig, i) => !verifies(keys[i], message, sig));
  return bad >= 0 ? "SignatureFailure" : null;
}

function refusal(chain, parts, strict) {
  if (chain.refuse) return chain.refuse;
  const found = lifetimeRefusal(chain, parts) ?? feeRefusal(chain, parts);
  const signed = found ?? (strict ? signatureRefusal(parts) : null);
  return signed ?? programRefusal(chain, instructionsOf(parts.message));
}

function land(chain, parts) {
  const signature = base58(hex(parts.sigs[0]));
  if (chain.landed.some((x) => x.signature === signature)) throw new Error("already processed");
  const [payer] = parts.keys;
  const paid = chain.balances.get(base58(payer)) ?? 0n;
  chain.balances.set(base58(payer), paid - FEE * BigInt(parts.sigs.length));
  const sigs = parts.sigs.map(hex);
  chain.landed.push({ signature, message: hex(parts.message), sigs, sig: sigs.at(-1) });
  // The nonce account is created or advanced by a transaction that the group signs.
  if (groupSigns(chain, parts)) chain.nonce = hex(randomBytes(32));
  programLanded(chain, instructionsOf(parts.message), signature);
  return { signature };
}

/** The answer of each command of web/sol/guard.js that the page uses, from the model. */
/** SOL-4: the device check and the deploy slot of the pool (`chain.poolSlot`). */
const proveAnswers = (chain) => ({
  selftest: () => chain.selftest(),
  poolSlot: () => {
    const moved = chain.poolSlot !== POOL_SLOT;
    const text = moved ? "Helius changed the pool." : null;
    return { slot: chain.poolSlot, pinned: POOL_SLOT, text };
  },
});

export function answersOf(chain) {
  const answers = {
    init: () => ({
      hasherMs: 1,
      ownerHash: "00",
      pdaOwnerHash: "00",
      ...pick(chain.group, ["owner", "shielded", "pda", "pdaShielded"]),
    }),
    sync: () => ({ slot: "9", balance: "0", utxos: chain.utxos, storedUtxos: 0, undecryptable: 0 }),
    syncOld: () => ({
      slot: "9",
      balance: String(chain.oldUtxos.reduce((sum, u) => sum + BigInt(u.amount), 0n)),
      // A note that a move cannot take (not plain, another tree) has `movable: false`.
      movable: String(
        chain.oldUtxos
          .filter((u) => u.movable !== false)
          .reduce((sum, u) => sum + BigInt(u.amount), 0n),
      ),
      utxos: chain.oldUtxos,
      storedUtxos: 0,
      undecryptable: 0,
    }),
    account: ({ account }) => {
      // The Clock sysvar: unix_timestamp at byte 32. `chain.rpcNow` is a false answer of the RPC.
      const shown = chain.rpcNow ?? chain.now;
      if (account === CLOCK) return { exists: true, data: "00".repeat(32) + le64(shown) };
      const found = chain.accounts.get(account);
      return found ? { exists: true, lamports: "1356360", ...found } : { exists: false };
    },
    // The open proposals of `group` that pay `fee` (SOL-52): the RPC filters of the Worker.
    owned: ({ fee, group }) =>
      [...chain.accounts]
        .filter(([, a]) => a.owner === keyHex(PROGRAM))
        .filter(([, a]) => proposalFilters(group, fee).every(({ memcmp }) => held(a.data, memcmp)))
        .map(([address, a]) => ({ address, lamports: a.lamports ?? "1356360", data: a.data })),
    recipientAccount: ({ account }) => {
      const found = chain.accounts.get(account);
      if (!found) return { exists: false };
      const { owner, lamports = "1356360", executable = false } = found;
      return { exists: true, owner, lamports, executable };
    },
    // `chain.rentFor(space)` may give another rent minimum (a test of the recipient read).
    rent: ({ space }) => ({
      lamports: chain.rentFor?.(space) ?? String(5080n * (128n + BigInt(space))),
    }),
    history: ({ account }) => chain.history.get(account) ?? [],
    reprove: (args) => chain.reproved(args),
    ...proveAnswers(chain),
    treeFees: () => ({
      feePerNullifier: chain.fee,
      appendReimbursement: "0",
      closeReimbursement: "0",
      feeBalance: "0",
    }),
    inspect: (args) =>
      typeof chain.inspected === "function" ? chain.inspected(args) : chain.inspected,
    prepare: (args) => chain.prepared(args),
    blockhash: () => {
      const value = hex(randomBytes(32));
      chain.blockhashes.add(value);
      return { blockhash: base58(value), blockhashHex: value, lastValidBlockHeight: "1" };
    },
    balance: ({ account }) => {
      const isNonce = account === chain.group.nonceAccount;
      const held = isNonce ? (chain.nonce === null ? 0n : 1056640n) : chain.balances.get(account);
      return { lamports: String(held ?? 0n) };
    },
    readNonce: ({ account }) => {
      if (account !== chain.group.nonceAccount || chain.nonce === null) {
        throw new Error("the account does not exist");
      }
      const nonce = chain.nonce;
      return { authority: chain.group.owner, nonce: base58(nonce), nonceHex: nonce, lamports: "1" };
    },
    preflight: ({ tx }) => ran(refusal(chain, wire(tx), false)),
    simulate: ({ tx }) => {
      const parts = wire(tx);
      if (chain.frontRun && chain.frontRun !== "send") frontRun(chain, parts);
      return ran(refusal(chain, parts, true));
    },
    send: ({ tx }) => {
      const parts = wire(tx),
        err = refusal(chain, parts, true);
      if (err) throw new Error("Transaction simulation failed: " + err);
      const raced = chain.frontRun === "send" ? frontRun(chain, parts) : null;
      if (raced) return lostRace(chain, parts, raced);
      return SENDS[chain.sendMode ?? "land"](chain, parts);
    },
    status: ({ signature }) => statusOf(chain, signature, "pending"),
    confirm: ({ signature }) => statusOf(chain, signature, "unknown"),
    transaction: ({ signature }) => {
      const found = chain.landed.find((x) => x.signature === signature);
      if (found) return { found: true, failed: false, tx: wireOf(found) };
      return chain.txs.get(signature) ?? { found: false, failed: false, tx: "" };
    },
  };
  return answers;
}

const signatureOf = (parts) => base58(hex(parts.sigs[0]));

// Someone else lands the same create first (`chain.frontRun`, once), after a create of theirs that
// failed, and then sends lamports to the account: the create of the page meets an account in use.
// "other" stores another body there; "send" lands it after the test run of the page passed.
// Returns the proposal address, or null.
function frontRun(chain, parts) {
  const ixs = instructionsOf(parts.message);
  const create = ixs.find((ix) => ix.program === PROGRAM && ix.data.startsWith("00"));
  if (!create) return null;
  const other = chain.frontRun === "other";
  chain.frontRun = false;
  const proposal = create.accounts[1];
  chain.history.set(proposal, [{ signature: FRONT_RUN_FAILED, failed: true, slot: "9" }]);
  chain.txs.set(FRONT_RUN_FAILED, { ...txOf(parts), failed: true });
  chain.txs.set(FRONT_RUN, txOf(parts));
  programLanded(chain, ixs, FRONT_RUN);
  chain.history.get(proposal).unshift({ signature: FRONT_RUN_TRANSFER, failed: false, slot: "11" });
  chain.txs.set(FRONT_RUN_TRANSFER, { ...txOf(parts), tx: randomBytes(200).toString("base64") });
  if (other) chain.accounts.get(proposal).data += "00";
  return proposal;
}

// The create of the page lands after the other one: it fails on chain, in the account's history.
function lostRace(chain, parts, proposal) {
  const signature = signatureOf(parts);
  chain.failed.add(signature);
  chain.history.get(proposal).unshift({ signature, failed: true, slot: "12" });
  chain.txs.set(signature, { ...txOf(parts), failed: true });
  return { signature };
}

// The answer of `transaction` for a transaction with the bytes of `parts`.
const txOf = (parts) => ({
  found: true,
  failed: false,
  tx: Buffer.concat([parts.message, ...parts.sigs]).toString("base64"),
});
export const FRONT_RUN = "9".repeat(87) + "8";
const FRONT_RUN_FAILED = "9".repeat(87) + "7";
const FRONT_RUN_TRANSFER = "9".repeat(87) + "6";
// How a sent transaction ends: it lands now, it fails on chain (the simulation passed), or it
// lands later, when the test calls `chain.release()`.
const SENDS = {
  land,
  fail: (chain, parts) => {
    chain.failed.add(signatureOf(parts));
    return { signature: signatureOf(parts) };
  },
  late: (chain, parts) => {
    chain.late.push(parts);
    return { signature: signatureOf(parts) };
  },
};

function statusOf(chain, signature, notYet) {
  if (chain.failed.has(signature)) return { status: "failed", slot: "10" };
  const pending = chain.late.some((parts) => signatureOf(parts) === signature);
  if (pending) return { status: notYet, slot: "" };
  const found = chain.landed.find((x) => x.signature === signature);
  return found ? { status: "confirmed", slot: "10" } : { status: "none", slot: "" };
}

// The wire bytes of a landed transaction (base64): the message, then its signatures.
const wireOf = (landed) => {
  const parts = [landed.message, ...landed.sigs].map((text) => Buffer.from(text, "hex"));
  return Buffer.concat(parts).toString("base64");
};

const pick = (object, names) => Object.fromEntries(names.map((name) => [name, object[name]]));

// The commands that prove. Before each, the Worker asks the page how the group proves (SOL-4):
// the answer goes to `chain.gates`, and a refusal fails the command with its text.
const GATED = new Set(["prepare", "reprove"]);
function gated(chain, answer) {
  chain.gates.push(answer.mode ?? "refuse");
  if (answer.mode !== "local" && answer.mode !== "hosted") throw new Error(answer.refuse);
}

// The Worker class of the page. Only the Solana Worker is faked: the page starts the engine
// Worker of the Zcash part on its own, and falls back to the main thread when that start throws.
function workerClass(chain, answers) {
  return class {
    gates = new Map();
    asked = 0;
    constructor(url) {
      if (String(url) !== "/sol/worker.js") throw new Error("no other Worker in this test");
    }
    /** Asks the page how the group proves, as web/sol/worker.js does before a prove call. */
    gate() {
      const id = (this.asked += 1);
      return new Promise((done) => {
        this.gates.set(id, done);
        this.onmessage({ data: { gate: id } });
      });
    }
    postMessage(msg) {
      if (typeof msg.gate === "number") return this.gates.get(msg.gate)?.(msg);
      chain.commands.push(msg);
      if (chain.drop === msg.cmd) return;
      const reply = (ok, body) => this.onmessage({ data: { id: msg.id, ok, ...body } });
      queueMicrotask(async () => {
        try {
          if (GATED.has(msg.cmd)) gated(chain, await this.gate());
          reply(true, { result: answers[msg.cmd](msg.args) });
        } catch (e) {
          reply(false, { error: String(e.message) });
        }
      });
    }
    terminate() {}
  };
}

/** The chain model and the installers. `chain.group` is set once the key is known. */
export function makeChain() {
  const chain = {
    group: null, // { key, owner, shielded, nonceAccount }
    balances: new Map(),
    utxos: [], // what the sync of the wallet returns: { hash, mint, amount, blinding, tree, leaf }
    fee: "162", // the insertion fee per nullifier of the tree
    inspected: { salt: "ab".repeat(16), firstNullifier: "cd".repeat(32) }, // answer of inspect
    prepared: () => {
      // answer of prepare: (args) => the prepared payment
      throw new Error("no payment is prepared");
    },
    reproved: () => {
      // answer of reprove: (args) => { data }, the transact data of a new proof
      throw new Error("no payment is proved again");
    },
    oldUtxos: [], // what the sync of the group key returns: the beta funds before the move
    accounts: new Map(), // the proposal accounts of the approvals program, by address
    now: 0n, // the unix_timestamp of the Clock sysvar, which the program uses
    rpcNow: null, // a false unix_timestamp that the RPC answers instead
    history: new Map(), // per proposal address: the transactions that touched it, newest first
    nonce: null, // the current nonce value (hex) once the account exists
    blockhashes: new Set(),
    landed: [], // { signature, message, sig }
    commands: [], // every message that the page posted to the Worker
    gates: [], // per proof, how the page said the group proves: "local", "hosted" or "refuse"
    selftest: () => ({ ms: 3100 }), // answer of the device check
    poolSlot: POOL_SLOT, // the deploy slot of the pool that the RPC shows
    refuse: null, // a text: the next preflight, simulation or send fails with it
    sendMode: null, // "fail" or "late": how a send ends (see SENDS); null lands it
    failed: new Set(), // the signatures of sends that failed on chain
    late: [], // the sends that land when the test calls chain.release()
    txs: new Map(), // answers of `transaction` for signatures that did not land here
    drop: null, // a command name: the Worker never answers it (a crash)
  };
  // The late sends land now, in order.
  chain.release = () => {
    for (const parts of chain.late.splice(0)) land(chain, parts);
  };
  let installed = null;
  chain.install = () => {
    installed = { Worker: globalThis.Worker, fetch: globalThis.fetch };
    globalThis.fetch = async () =>
      new Response("export {}", { headers: { "content-security-policy": POLICY } });
    globalThis.Worker = workerClass(chain, answersOf(chain));
  };
  chain.uninstall = () => {
    if (installed.Worker) globalThis.Worker = installed.Worker;
    else delete globalThis.Worker;
    globalThis.fetch = installed.fetch;
  };
  return chain;
}
