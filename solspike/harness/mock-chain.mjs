// The chain of a mock run (--mock): the fake chain of the web tests (web/test/sol-chain.mjs) behind
// the Solana Worker of every page of the rig. Each page gets a Worker class that keeps the engine
// Worker and fakes only /sol/worker.js: it sends each command to this process through a CDP
// binding, and the answer goes back by Runtime.evaluate. The seats share one model: the fee
// balances that the funding sets, the issued blockhashes, and the transactions that land after
// their lifetime, fee and signature checks. A landed Add SOL deposit becomes a note of the group,
// with the amount of its own bytes. The model has no SDK payment for a new group, so prepare
// refuses: a payment is live only. This module loads the rig of the web tests, which sets the
// globals of a stub page, so only a mock run imports it.
import { randomBytes } from "node:crypto";
import { base58, keyOfBase58 } from "../../web/sol/docs.js";
import * as W from "../../web/sol/wasm/sol_wasm.js";
import { answersOf, chainGroup, makeChain } from "../../web/test/sol-chain.mjs";
import { run } from "./page.mjs";

const BINDING = "__zsSol";
const SOL_MINT = "1".repeat(32);
const PROGRAM = "5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL";
// Runs before every script of the page: the real Worker class, but /sol/worker.js is the fake.
const WORKER = `(() => {
  const Real = self.Worker;
  const fakes = new Map();
  let last = 0;
  self.__zsSolAnswer = (id, data) => fakes.get(id)?.onmessage?.({ data });
  self.Worker = function (url, options) {
    if (new URL(String(url), location.href).pathname !== "/sol/worker.js") {
      return new Real(url, options);
    }
    const id = ++last;
    const fake = {
      onmessage: null,
      onerror: null,
      postMessage: (msg) => self.${BINDING}(JSON.stringify({ id, msg })),
      terminate: () => fakes.delete(id),
    };
    fakes.set(id, fake);
    return fake;
  };
})();`;

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const keysOf = (message) =>
  Array.from({ length: parseInt(message.slice(82, 84), 16) }, (_, n) =>
    message.slice(84 + 64 * n, 148 + 64 * n),
  );

/** The solSeed of the group `groupKey`, as the page keeps it (a test group of a mock run). */
const solSeedOf = (page, groupKey) =>
  run(
    page,
    (key) => {
      const all = JSON.parse(localStorage.getItem("zf-secrets") || "{}");
      return Object.values(all).find((s) => s.sol?.groupKey === key)?.sol.solSeed ?? null;
    },
    groupKey,
  );

/**
 * The lamports of an Add SOL deposit, or null: a message that the payer signs alone, with no
 * account of the approvals program, and an entry of the pool layout (wasm-sol/src/fixed.rs):
 * the view tag (the PDA), the owner hash, then the amount (u64 LE).
 */
function depositOf(chain, landed) {
  if (landed.sigs.length !== 1) return null;
  if (keysOf(landed.message).includes(keyOfBase58(PROGRAM))) return null;
  const at = landed.message.lastIndexOf(keyOfBase58(chain.group.pda));
  if (at < 0 || at % 2) return null;
  const amount = Buffer.from(landed.message.slice(at + 128, at + 144), "hex");
  return amount.length === 8 ? amount.readBigUInt64LE(0) : null;
}

/** The answers of the fake Worker: those of the web tests, and init, sync and send of a run. */
function answersFor(chain) {
  const base = answersOf(chain);
  const init = async (args, page) => {
    const seed = chain.group ? null : await solSeedOf(page, args.groupKey);
    chain.group ??= await chainGroup(W, { groupKey: args.groupKey }, seed);
    if (chain.group.key !== args.groupKey) throw new Error("the mock chain holds another group");
    return base.init();
  };
  const sync = () => {
    const balance = chain.utxos.reduce((sum, u) => sum + BigInt(u.amount), 0n);
    return { ...base.sync(), balance: String(balance) };
  };
  const send = (args) => {
    const sent = base.send(args);
    const landed = chain.landed.find((x) => x.signature === sent.signature);
    const amount = landed ? depositOf(chain, landed) : null;
    if (amount !== null) {
      const note = { hash: hex(randomBytes(32)), mint: SOL_MINT, amount: String(amount) };
      chain.utxos.push({ ...note, blinding: hex(randomBytes(31)), tree: "TREE1", leaf: "0" });
    }
    return sent;
  };
  return { ...base, init, sync, send };
}

async function answer(page, answers, payload) {
  const { id, msg } = JSON.parse(payload);
  let data;
  try {
    const result = await answers[msg.cmd](msg.args ?? {}, page);
    data = JSON.stringify({ id: msg.id, ok: true, result });
  } catch (err) {
    data = JSON.stringify({ id: msg.id, ok: false, error: String(err?.message ?? err) });
  }
  // A page that navigated away has no fake of this id: the answer is dropped there.
  await page.send("Runtime.evaluate", { expression: `self.__zsSolAnswer(${id}, ${data})` });
}

/**
 * Puts the fake chain behind the Solana Worker of every page that the rig opens from now on.
 * Returns the tools of a scenario that read or move SOL: { chain, fund, confirmed, payerOf, elf }.
 */
export function mockTools(rig) {
  const chain = makeChain();
  const answers = answersFor(chain);
  rig.onPage(async (page) => {
    page.onBinding = (p) => {
      if (p.name !== BINDING) return;
      answer(page, answers, p.payload).catch((err) => console.error("mock chain:", err.message));
    };
    await page.send("Runtime.addBinding", { name: BINDING });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: WORKER });
  });
  const landed = (signature) => chain.landed.find((x) => x.signature === signature);
  return {
    chain,
    fund: async ({ to, lamports }) => {
      chain.balances.set(to, (chain.balances.get(to) ?? 0n) + lamports);
      return { signature: `mock-fund-${to}` };
    },
    confirmed: async (signature) => {
      if (!landed(signature)) throw new Error("not on the mock chain: " + signature);
    },
    payerOf: async (signature) => base58(keysOf(landed(signature).message)[0]),
    elf: async () => ({ mock: "the fake chain runs no program" }),
  };
}
