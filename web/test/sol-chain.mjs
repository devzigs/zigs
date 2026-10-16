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
import * as kit from "../sol/zolana.bundle.js";
import { config } from "./sol-rig.mjs";

const POLICY =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; " +
  "connect-src 'self' https://devnet.helius-rpc.com; base-uri 'none'";
export const RPC = config.rpcUrl;
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

/** The canonical bump of a proposal address: the bump whose hash is the address. */
function bumpOf(address, body) {
  const seeds = [Buffer.from("proposed_transaction"), Buffer.from(body.slice(64, 128), "hex")];
  seeds.push(Buffer.from(body.slice(0, 64), "hex"));
  const program = Buffer.from(keyHex(PROGRAM), "hex");
  for (let bump = 255; bump >= 0; bump--) {
    const made = sha256(...seeds, Buffer.from([bump]), program, PDA_MARKER);
    if (made.toString("hex") === keyHex(address)) return bump;
  }
  return null;
}

/** Why the program refuses one instruction (`ixs[i]`), or null. */
function refusalOf(chain, ixs, i) {
  const ix = ixs[i],
    proposal = ix.accounts[1];
  if (ix.data.startsWith("00")) {
    if (chain.accounts.has(proposal)) return "AccountAlreadyInUse";
    return bumpOf(proposal, ix.data.slice(2)) === null ? "Custom 6005" : null;
  }
  if (!ix.data.startsWith("01")) return "InvalidInstructionData";
  const stored = chain.accounts.get(proposal);
  if (!stored) return "Custom 6001";
  return approves(chain, ixs[i - 1], proposal, stored.data.slice(4)) ? null : "Custom 6012";
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

/** The effects of a landed message on the approvals program, and the history of its accounts. */
function programLanded(chain, ixs, signature) {
  for (const ix of ixs.filter((x) => x.program === PROGRAM)) {
    const proposal = ix.accounts[1];
    const seen = chain.history.get(proposal) ?? [];
    chain.history.set(proposal, [{ signature, failed: false, slot: "11" }, ...seen]);
    if (ix.data.startsWith("00")) {
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
function answersOf(chain) {
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
      const found = chain.accounts.get(account);
      return found ? { exists: true, lamports: "1356360", ...found } : { exists: false };
    },
    rent: ({ space }) => ({ lamports: String(5080n * (128n + BigInt(space))) }),
    history: ({ account }) => chain.history.get(account) ?? [],
    reprove: (args) => chain.reproved(args),
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
    simulate: ({ tx }) => ran(refusal(chain, wire(tx), true)),
    send: ({ tx }) => {
      const parts = wire(tx),
        err = refusal(chain, parts, true);
      if (err) throw new Error("Transaction simulation failed: " + err);
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

// The Worker class of the page. Only the Solana Worker is faked: the page starts the engine
// Worker of the Zcash part on its own, and falls back to the main thread when that start throws.
function workerClass(chain, answers) {
  return class {
    constructor(url) {
      if (String(url) !== "/sol/worker.js") throw new Error("no other Worker in this test");
    }
    postMessage(msg) {
      chain.commands.push(msg);
      if (chain.drop === msg.cmd) return;
      const reply = (ok, body) => this.onmessage({ data: { id: msg.id, ok, ...body } });
      queueMicrotask(() => {
        try {
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
    history: new Map(), // per proposal address: the transactions that touched it, newest first
    nonce: null, // the current nonce value (hex) once the account exists
    blockhashes: new Set(),
    landed: [], // { signature, message, sig }
    commands: [], // every message that the page posted to the Worker
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
