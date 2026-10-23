// Final review preserves Solana setup intent during a service outage, without bypassing
// existing formation gates. Run: node web/test/guided-create.mjs (Node 26).
import assert from "node:assert/strict";
import { config, loadRig } from "./sol-rig.mjs";
import { fakePasskey } from "./passkey-fixture.mjs";

const { t, data, waitFor } = await loadRig();
const { createDialog, protectThisDevice } = await import("../app-shell.js");
const { SOL_DISCLOSURE, solRetry } = await import("../app-sol.js");
const { descriptionOf } = await import("../wallet-description.js");
const { ui } = await import("../app-state.js");
const { lockWithPasskey, passkeyProtected } = await import("../app-keystore.js");
Object.defineProperty(globalThis, "navigator", { configurable: true, value: fakePasskey() });
t.setIdb(async () => null);
class Rec extends Node {
  constructor() { super(); Object.assign(this, { kids: [], attrs: {}, on: {}, style: {} }); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, v) { this.on[k] = v; }
  append(...kids) { this.kids.push(...kids); }
}
const text = (n) => n.attrs?.hidden === "" ? "" : n.text ?? n.kids.map(text).join("");
const find = (n, id) => n.attrs?.id === id ? n
  : (n.kids ?? []).map((k) => find(k, id)).find(Boolean);
const summaryOf = (n) => n.className === "setup-review-summary" ? n
  : (n.kids ?? []).map(summaryOf).find(Boolean);
const continueOf = (n) => n.attrs?.["data-key"] === "create-continue" ? n
  : (n.kids ?? []).map(continueOf).find(Boolean);
const beforeDocument = globalThis.document;
function reviewTree() {
  globalThis.document = { createElement: () => new Rec(), createElementNS: () => new Rec(),
    createTextNode: (value) => ({ text: value }) };
  try { return createDialog(); } finally { globalThis.document = beforeDocument; }
}
Object.assign(ui, { create: true, createStep: 0, net: "testnet", createDraft: { n: 3, t: 2 } });
const unprotected = reviewTree();
assert.equal(continueOf(unprotected).attrs.disabled, "");
unprotected.on.submit({ preventDefault() {}, target: {} });
assert.equal(ui.createStep, 0,
  "submitting a stale form cannot bypass an explicit protection choice");
assert.match(ui.createError, /Protect this browser with a passkey/);
assert.equal(data.size, 0, "blocked setup creates no group or signing seat");
navigator.credentials.create = () => { throw new DOMException("Cancelled", "NotAllowedError"); };
assert.equal(await protectThisDevice(), false);
assert.equal(passkeyProtected(), false, "cancellation never unlocks the setup flow");
assert.equal(continueOf(reviewTree()).attrs.disabled, "");
Object.defineProperty(globalThis, "navigator", { configurable: true, value: fakePasskey() });
await lockWithPasskey();
assert.equal(passkeyProtected(), true, "the review uses an actually saved and checked empty vault");
assert.equal("disabled" in continueOf(reviewTree()).attrs, false);
for (const served of [true, false, null]) {
  for (const choice of [undefined, true, false]) {
    Object.assign(ui, { createStep: 2, net: "testnet", sol: choice, solServed: served,
      createDraft: { n: 3, t: 2 } });
    const namesForm = reviewTree();
    const fields = { "g-name": { value: "Review check" }, "my-name": { value: "This device" },
      "g-description": { value: "A private note" }, "g-sol": null };
    globalThis.document = new Proxy(beforeDocument, { get: (o, key) => key === "getElementById"
      ? (id) => Object.hasOwn(fields, id) ? fields[id] : o.getElementById(id) : o[key] });
    try { namesForm.on.submit({ preventDefault() {}, target: {} }); }
    finally { globalThis.document = beforeDocument; }
    assert.equal(ui.createStep, 3, "the real names-step submit opens the final review");
    assert.equal(ui.createDraft.sol, choice !== false,
      "an absent names-step checkbox preserves the default or existing opt-out");
    const reviewed = reviewTree(), included = choice !== false;
    assert.equal("checked" in find(reviewed, "g-sol").attrs, included);
    const summary = text(summaryOf(reviewed));
    assert.equal(summary.includes("Zcash only"), !included,
      "the summary matches the preserved setup choice regardless of availability");
    if (included) assert.ok(summary.includes("Solana Devnet"));
  }
}
config.down = true;
Object.assign(ui, { create: true, createStep: 3, net: "testnet", sol: true, solServed: false,
  createDraft: { name: "Service waiting", label: "Everyday device", description: "Home expenses",
    n: 3, t: 2, sol: true, solExpected: true } });
const form = reviewTree();
assert.ok(!text(form).includes(SOL_DISCLOSURE), "the review omits the Solana disclosure");
assert.doesNotMatch(text(form),
  /Create wallet confirms these service disclosures|Network options|Solana setup is waiting/);
const hiddenChoice = form.kids.flatMap((kid) => kid.kids ?? [])
  .find((kid) => kid.attrs?.hidden === "" && find(kid, "g-sol"));
assert.ok(hiddenChoice, "the existing setup control stays hidden in the review");
assert.ok("checked" in find(form, "g-sol").attrs,
  "the hidden control preserves setup intent even while service is unavailable");
const checkbox = { checked: true };
globalThis.document = new Proxy(beforeDocument, { get: (o, key) => key === "getElementById"
  ? (id) => id === "g-sol" ? checkbox : o.getElementById(id) : o[key] });
try { await form.on.submit({ preventDefault() {}, target: {} }); }
finally { globalThis.document = beforeDocument; }
const gid = t.state.gid;
await waitFor("seat 1", () => t.state.seats[1]);
assert.equal(data.get("groups/" + gid).solana, true, "the final review records the existing hint");
assert.equal(t.sec(gid, 1).solAuto, true, "the final review records existing local consent");
assert.equal(descriptionOf(gid).text, "Home expenses", "the note is private to this browser");
assert.equal(data.get("groups/" + gid).description, undefined,
  "no description goes to the group");
await waitFor("the unavailable controller load", () => t.solLoading !== null);
await t.solLoading;
assert.equal(t.sol, null, "the outage loads no Solana controller");
assert.match(t.solError, /not available on this server/);
for (const seat of [2, 3]) await t.takeSeat(seat, 3);
await waitFor("the existing Zcash address checks",
  () => Object.keys(t.state.verify).length === 3
  && t.state.wallet);
assert.equal(data.has(`groups/${gid}/solstart/1`), false, "no Solana start during the outage");
assert.equal(t.sec(gid, 1).sol?.keyPackage, undefined, "no Solana share was prepared");
config.down = false;
solRetry();
await waitFor("the restored service", () => !!t.sol);
await waitFor("automatic signed start", () => data.has(`groups/${gid}/solstart/1`));
await waitFor("the existing automatic ceremony", () => [1, 2, 3]
  .every((seat) => data.has(`groups/${gid}/soldone/${seat}`)), 60000);
assert.equal(t.sec(gid, 1).solAuto, true, "restoring service requires no additional activation");
console.log("guided-create: ok (preserved outage intent, private description, "
  + "guarded auto-resume)");
process.exit(0);
