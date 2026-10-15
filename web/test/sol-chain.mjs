// A fake chain behind a fake Solana Worker, for sol-sessions.mjs. The page starts its Worker with
// `new Worker(...)` and talks to it by messages, so this installs a Worker class that answers the
// commands of web/sol/guard.js from a small model of Devnet: balances, one nonce account, the
// blockhashes that it issued, and the transactions that landed. The model is strict where the
// real chain is: a lifetime that is not current is refused, a signature that Node's own Ed25519
// does not verify under the group key is refused, and a landed transaction advances the nonce.
import { createPublicKey, randomBytes, verify } from "node:crypto";
import { base58 } from "../sol/docs.js";
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

const wire = (tx) => {
  const bytes = Buffer.from(tx, "base64");
  return { message: bytes.subarray(0, bytes.length - 64), sig: bytes.subarray(bytes.length - 64) };
};
const ran = (err) => ({ err, unitsConsumed: "1", logs: [] });

// Why the network would refuse this transaction now, or null. A message is current when its
// lifetime is a blockhash that was issued (before the nonce account) or the nonce (after).
function refusal(chain, { message, sig }, strict) {
  if (chain.refuse) return chain.refuse;
  const life = hex(message.subarray(8, 40));
  const known = chain.nonce === null ? chain.blockhashes.has(life) : life === chain.nonce;
  if (!known) return "BlockhashNotFound";
  if (strict && !verifies(chain.group.key, message, sig)) return "SignatureFailure";
  return null;
}

function land(chain, parts) {
  const signature = base58(hex(parts.sig));
  if (chain.landed.some((x) => x.signature === signature)) throw new Error("already processed");
  chain.landed.push({ signature, message: hex(parts.message), sig: hex(parts.sig) });
  chain.nonce = hex(randomBytes(32));
  return { signature };
}

/** The answer of each command of web/sol/guard.js that the page uses, from the model. */
function answersOf(chain) {
  const answers = {
    init: () => ({ hasherMs: 1, ownerHash: "00", ...pick(chain.group, ["owner", "shielded"]) }),
    sync: () => ({ slot: "9", balance: "0", utxos: chain.utxos, storedUtxos: 0, undecryptable: 0 }),
    treeFees: () => ({
      feePerNullifier: chain.fee,
      appendReimbursement: "0",
      closeReimbursement: "0",
      feeBalance: "0",
    }),
    inspect: () => chain.inspected,
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
      return land(chain, parts);
    },
    status: ({ signature }) => {
      const found = chain.landed.find((x) => x.signature === signature);
      return found ? { status: "confirmed", slot: "10" } : { status: "none", slot: "" };
    },
  };
  return { ...answers, confirm: answers.status };
}

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
    nonce: null, // the current nonce value (hex) once the account exists
    blockhashes: new Set(),
    landed: [], // { signature, message, sig }
    commands: [], // every message that the page posted to the Worker
    refuse: null, // a text: the next preflight, simulation or send fails with it
    drop: null, // a command name: the Worker never answers it (a crash)
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
