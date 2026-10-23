// Mainnet is off for this release (M1 of docs/hackathon-release.md), and the testnet faucet is the
// Valar faucet (M2). The network picker of a new wallet and of the personal account shows Testnet
// only and no tick, a chat reads testnet requests only, and the page texts name Zcash testnet and
// Solana Devnet in metadata. Run: node web/test/mainnet-off.mjs   (Node 26)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadRig } from "./sol-rig.mjs";

const rig = await loadRig();
const { t } = rig;
const { MAINNET_ON, NETWORKS } = await import("../app-chain.js");
const { networkPick } = await import("../app-dom.js");
assert.equal(MAINNET_ON, false, "mainnet is off in this release");

// The picker, drawn with a recorder in place of the document.
class Rec extends globalThis.Node {
  constructor(tag) { super(); Object.assign(this, { tag, kids: [], attrs: {}, style: {} }); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener() {}
  append(...nodes) { this.kids.push(...nodes); }
}
const draw = (sel) => {
  const real = globalThis.document;
  globalThis.document = {
    createElement: (tag) => new Rec(tag), createTextNode: (text) => ({ text }),
  };
  try { return networkPick(sel); } finally { globalThis.document = real; }
};
const all = (node, ok) => typeof node !== "object" || node === null ? []
  : [...(ok(node) ? [node] : []), ...(node.kids ?? []).flatMap((k) => all(k, ok))];
const textOf = (node) => node?.text ?? (node?.kids ?? []).map(textOf).join("");
const inputs = (node) => all(node, (x) => x.tag === "input");

for (const sel of [{ net: "testnet", ack: false }, { net: "mainnet", ack: true }, {}]) {
  const shown = JSON.stringify(sel);
  const pick = draw(sel);
  const boxes = inputs(pick);
  assert.equal(boxes.length, 1, "one input for " + shown);
  assert.equal(boxes[0].attrs.type, "radio", "a radio, no tick, for " + shown);
  assert.equal(boxes[0].attrs.value, "testnet");
  assert.equal(boxes[0].attrs.checked, "", "and it is chosen");
  assert.equal(sel.net, "testnet", "the choice is testnet for " + shown);
  assert.doesNotMatch(textOf(pick), /Mainnet|Real ZEC|not audited/, "no mainnet text");
}
// The create dialog and the personal account start on testnet.
assert.deepEqual([t.ui.net, t.ui.personal.net], ["testnet", "testnet"]);
console.log("ok  the picker shows Testnet only, with no tick");

// A chat reads testnet requests only. A mainnet request is no mainnet card.
const testAddr = "utest1m6h0x5p0ryej3e4raszk99rz3k3gxzj35j7ypw3mm98uxmxt3x7mnmu22cprpl7rls4cc5k"
  + "xzvhqxju6pp4rxsw6ajnkm0d4egf4yrjx";
const mainAddr = "u1ljgj2vz0uzz5ku88wq07pqwepyyaw6azem5rnl56xu0wfjkxpkd84e40y36wy6da7f"
  + "vcd845jwl09pg9uwc5zlx0cead3xsz7vuqm5z2";
const testReq = t.requestOf(`zcash:${testAddr}?amount=1`, true);
assert.ok(testReq && testReq.payees.length === 1, "a testnet request reads in a chat");
assert.equal(testReq.net, "test", "as a testnet request");
const mainReq = t.requestOf(`zcash:${mainAddr}?amount=1`, true);
assert.notEqual(mainReq?.net, "main", "a chat reads no mainnet request");
// A mainnet wallet or account made before this release still reads its own requests (D3). A
// testnet account reads none of mainnet.
const account = (network) => t.requestOf(`zcash:${mainAddr}?amount=1`, false, network);
assert.equal(account("mainnet")?.net, "main", "a mainnet account reads its own requests");
assert.notEqual(account("testnet")?.net, "main", "a testnet account reads no mainnet request");
const open = t.state.g;
t.state.g = { ...open, network: "mainnet" };
const room = t.requestOf(`zcash:${mainAddr}?amount=2`, false);
t.state.g = open;
assert.equal(room?.net, "main", "the room of a mainnet wallet reads its own requests");
console.log("ok  a chat reads testnet requests only; a mainnet wallet reads its own");

// The faucet is the Valar testnet faucet. Mainnet stays readable for wallets made before.
assert.equal(NETWORKS.testnet.faucet, "https://faucet.testnet.valargroup.dev/");
assert.ok(NETWORKS.mainnet && NETWORKS.mainnet.servers.length > 0, "mainnet wallets still open");
console.log("ok  the faucet is the Valar testnet faucet");

// Metadata names the actual networks; visible navigation omits repeated release boilerplate.
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\s+/g, " ");
assert.doesNotMatch(html, /mainnet|0\.5 ZEC/i, "index.html has no mainnet text");
assert.equal(html.match(/Zcash testnet and Solana Devnet/g)?.length, 1,
  "the description keeps the actual networks without repeated navigation boilerplate");
assert.doesNotMatch(html, /Beta:|>Beta<|Not audited\./,
  "visible navigation omits repeated release warnings");
assert.match(html, /A private Solana payment hides its amount, but its payee is public\./,
  "the description says that a private Solana payment hides its amount");
assert.equal(html.match(/hides its amount/g)?.length, 1, "and no other line makes the claim");
assert.doesNotMatch(html, /A Solana payment hides/, "a Solana deposit shows its amount");
console.log("ok  the page texts name Zcash testnet and Solana Devnet");
console.log("mainnet-off: ok");
process.exit(0);
