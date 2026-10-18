// The unified setup (release item M3) against the real page modules (see sol-rig.mjs): one setup
// for Zcash testnet and Solana Devnet. The group document carries `solana: true` as a hint only.
// It changes the texts: the join card, the invite message, the safety card and the progress note
// say that the wallet has a Zcash part and a Solana part, and that every signer keeps the page
// open through both key ceremonies.
// Run: node web/test/unified-setup.mjs   (Node 24)
import assert from "node:assert/strict";
import { loadRig } from "./sol-rig.mjs";

const rig = await loadRig();
// The page modules need the stub page of the rig, so they load after it.
const { SOL_DISCLOSURE, solPlanned } = await import("../app-sol.js");
const { inviteMessage, joinText } = await import("../app-setup.js");
const { t, data, waitFor } = rig;
const groupPath = (gid) => `groups/${gid}`;
const BOTH_OPEN = /Every signer keeps this wallet open until the Zcash and the Solana parts/;

// The text of the open wallet page, with a recorder in place of the document.
class Rec extends Node {
  constructor() {
    super();
    Object.assign(this, { kids: [], style: {} });
  }
  setAttribute() {}
  addEventListener() {}
  append(...nodes) {
    this.kids.push(...nodes);
  }
}
const textOf = (node) => node.text ?? node.kids.map(textOf).join("");
function pageText() {
  const real = globalThis.document;
  globalThis.document = { createElement: () => new Rec(), createTextNode: (text) => ({ text }) };
  try {
    return textOf(t.groupView());
  } finally {
    globalThis.document = real;
  }
}

// ── The hint: version 3 testnet wallets only ──
const g = { solana: true, network: "testnet", version: 3 };
assert.equal(solPlanned(g), true);
assert.equal(solPlanned({ ...g, network: undefined }), true, "a wallet with no network is testnet");
assert.equal(solPlanned({ ...g, network: "mainnet" }), false, "never on mainnet");
assert.equal(solPlanned({ ...g, version: 2 }), false, "version 3 only");
assert.equal(solPlanned({ ...g, solana: "yes" }), false, "only the value true");
assert.equal(solPlanned({ network: "testnet", version: 3 }), false, "no hint, no Solana");
assert.equal(solPlanned(null), false);

// ── The texts of a wallet in setup, with and without the hint ──
await t.createGroup("Both", 3, 2, null, "testnet");
const gid = t.state.gid;
await waitFor("seat 1", () => t.state.seats[1]);
const link = "https://example.test/#" + gid;
const plain = { text: pageText(), join: joinText(), invite: inviteMessage(link) };
assert.match(plain.text, /Every signer must keep Zigs open until setup finishes/);
assert.doesNotMatch(plain.join + plain.invite, /Solana/, "no hint: Zcash only");
data.set(groupPath(gid), { ...data.get(groupPath(gid)), solana: true });
rig.notify();
await waitFor("the hint", () => t.state.g.solana === true);
assert.equal(solPlanned(), true);
assert.match(pageText(), BOTH_OPEN, "the progress card names both parts");
assert.match(joinText(), /shielded Zcash testnet and for Solana Devnet/);
assert.match(joinText(), /one for Zcash and one for Solana/);
assert.match(joinText(), BOTH_OPEN);
assert.match(inviteMessage(link), /shielded Zcash testnet and Solana Devnet\./);
assert.match(inviteMessage(link), /until the Zcash and the Solana parts are ready/);
assert.ok(inviteMessage(link).includes(link), "the invite still carries the link");
assert.match(SOL_DISCLOSURE, /public program address.*fee address.*Helius.*no audit/);

console.log("unified-setup: ok");
process.exit(0);
