// Exercise the real presentation wrapper: opening/cancelling or refreshing a cost review must
// preserve the draft and must never reach signing or transaction construction.
import assert from "node:assert/strict";
import { loadRig } from "./sol-rig.mjs";

const { t, Z } = await loadRig();
const view = await import("../app-account-view.js");
const account = JSON.parse(Z.accountNew("testnet"));
const target = JSON.parse(Z.accountNew("testnet"));
let builds = 0, signs = 0;
t.setZ({ ...Z, accountSign() { signs++; throw new Error("Unexpected signing"); } });
t.personal = { ...account, network: "testnet", backedUp: true, contacts: [
  { index: 1, name: "Sample contact", address: target.address },
], sent: [] };
const liveAccount = {
  account: true, ufvk: account.ufvk, address: account.address, addrs: new Map(),
  cw: { async createMessage() { builds++; throw new Error("Synthetic message build failure"); } },
  bal: { height: 4500000, spendable: 100000, pending: 0 },
  sent: new Set(), received: [], progress: "", live: "", net: { label: "Testnet" },
};
t.setAcct(liveAccount);
t.state.contact = 1;
const originalDocument = globalThis.document;
class Rec extends Node {
  constructor(tag) { super(); Object.assign(this, { tag, attrs: {}, kids: [], on: {}, style: {} }); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener(type, fn) { this.on[type] = fn; }
  append(...nodes) { this.kids.push(...nodes); }
  blur() {}
}
const all = (node, predicate) => !node?.kids ? []
  : [...(predicate(node) ? [node] : []), ...node.kids.flatMap((kid) => all(kid, predicate))];
const textOf = (node) => node?.text ?? (node?.kids ?? []).map(textOf).join("");
const ids = new Map();
ids.set("banner", new Rec("div"));
ids.set("banner-text", new Rec("span"));
globalThis.document = {
  activeElement: { dataset: { key: "sample-send" } },
  createElement: (tag) => new Rec(tag), createElementNS: (_, tag) => new Rec(tag),
  createTextNode: (text) => ({ text }), getElementById: (id) => ids.get(id),
};
try {
  view.clearMessagingCostReview();
  const page = view.contactView();
  const form = all(page, (node) => node.tag === "form").at(-1);
  const box = all(form, (node) => node.tag === "textarea")[0];
  box.id = box.attrs.id;
  box.value = "Hello from this tab";
  form.elements = { text: box };
  ids.set(box.id, box);
  await form.on.submit({ preventDefault() {}, currentTarget: form, target: form });
  assert.equal(view.hasMessagingCostReview(), true, "first send opens review");
  assert.equal(box.value, "Hello from this tab", "opening review keeps the draft");
  let dialog = view.messagingCostReviewDialog();
  assert.match(textOf(dialog), /Recipient receives0 ZEC/);
  assert.match(textOf(dialog), /Network fee0\.0001 ZEC/);
  assert.deepEqual([builds, signs], [0, 0], "reviewing does not build or sign");
  view.closeMessagingCostReview();
  assert.equal(view.hasMessagingCostReview(), false);
  assert.equal(box.value, "Hello from this tab", "cancelling keeps the draft");

  await form.on.submit({ preventDefault() {}, currentTarget: form, target: form });
  dialog = view.messagingCostReviewDialog();
  box.value = "a".repeat(513);
  await dialog.on.submit({ preventDefault() {}, currentTarget: dialog, target: dialog });
  assert.equal(view.hasMessagingCostReview(), true, "a changed plan stays in review");
  assert.match(textOf(view.messagingCostReviewDialog()), /Network fee0\.00015 ZEC/);
  assert.match(textOf(view.messagingCostReviewDialog()), /The message changed/);
  assert.equal(box.value.length, 513);
  assert.deepEqual([builds, signs], [0, 0], "changed cost requires another explicit confirmation");

  dialog = view.messagingCostReviewDialog();
  await dialog.on.submit({ preventDefault() {}, currentTarget: dialog, target: dialog });
  assert.deepEqual([builds, signs], [1, 0], "only explicit confirmation starts the existing send");
  assert.equal(box.value.length, 513, "a failed send keeps the draft");
  assert.equal(view.hasMessagingCostReview(), false);
  assert.match(t.banner.text, /Synthetic message build failure/, "the existing banner reports send failure");
  await form.on.submit({ preventDefault() {}, currentTarget: form, target: form });
  assert.equal(view.hasMessagingCostReview(), true, "a failed first send does not remember review");

  t.setAcct({ ...liveAccount });
  assert.equal(view.hasMessagingCostReview(), false, "replacing the account drops its review");
  assert.deepEqual([builds, signs], [1, 0]);
} finally {
  view.clearMessagingCostReview();
  globalThis.document = originalDocument;
}
console.log("messaging-account-view: ok");
process.exit(0);
