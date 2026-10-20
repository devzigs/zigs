// A browser that cannot read its storage (blocked site data, or a damaged record of the secrets)
// keeps the secrets of this page in memory only. A reload loses them. So a join or a new wallet
// must not write to the group store there, and the page must write nothing to storage: a damaged
// record can still hold key shares. A save still says "saved", because signing in such a tab needs
// it. The page modules load once per process, so this test has its own process.
// Run: node web/test/no-storage.mjs   (Node 24)
import assert from "node:assert/strict";
import { loadRig } from "./sol-rig.mjs";

const writes = [];
localStorage.getItem = () => {
  throw new Error("blocked");
};
localStorage.setItem = (key) => {
  writes.push(key);
};
const rig = await loadRig();
const keystore = await import("../app-keystore.js");
const { t, data, waitFor } = rig;
const JOIN_MEMORY = "This browser does not let the page save data, so Zigs did not join. Allow "
  + "site data for this site and reload.";
const WALLET_MEMORY = "This browser does not let the page save data, so Zigs did not create the "
  + "wallet. Allow site data for this site and reload.";
const refused = (run) => run().then(() => "it joined", (e) => e.message);

assert.equal(keystore.memoryOnly(), true, "a page that reads no storage keeps secrets in memory");
assert.equal(keystore.storageOk, false);

assert.equal(await refused(() => t.createGroup("Blocked", 3, 2, null, "testnet")), WALLET_MEMORY,
  "a wallet is refused in memory-only mode");
assert.deepEqual([...data.keys()], [], "and the group store gets no document");
assert.deepEqual(Object.keys(t.gkeys), [], "and no wallet key stays in memory");

data.set("groups/other", { name: "Other", n: 3, t: 2, network: "testnet", version: 3,
  createdBy: "someone", createdAt: Date.now() });
t.gkeys.other = "k".repeat(43);
t.openGroup("other");
await waitFor("the wallet of someone else", () => t.state.g?.name === "Other");
assert.equal(await refused(() => t.takeSeat(2, 3)), JOIN_MEMORY,
  "a join is refused in memory-only mode");
assert.equal(data.has("groups/other/seats/2"), false, "and writes no seat document");
assert.equal(t.sec("other", 2), undefined, "and keeps no secret in memory");

assert.equal(await keystore.persist(), true, "a save in memory-only mode still says saved");
const secretWrites = writes.filter((key) => /^zf-(secrets|keys|chats|vault)$/.test(key));
assert.deepEqual(secretWrites, [], "and the page writes no secret, key or chat to storage");
assert.equal(keystore.storageOk, false, "and the storage stays marked");

console.log("no-storage: ok");
process.exit(0);
