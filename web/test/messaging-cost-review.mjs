import assert from "node:assert/strict";
import { messagingCostReview } from "../messaging-cost-review.js";

const review = messagingCostReview(), account = {}, replacement = {};
const contact = { index: 1, address: "shielded-contact-address" };
const one = { parts: 1, fee: 10000, error: "" }, two = { parts: 2, fee: 15000, error: "" };
const needs = (plan = one, who = contact, net = "testnet", source = account) =>
  review.needs(source, who, net, plan);
assert.equal(needs(), true, "the first message needs review");
review.remember(account, contact, "testnet", one);
assert.equal(needs(), false, "same recipient and cost reuse the review in this tab");
assert.equal(needs(two), true, "a changed part count and fee need review");
review.remember(account, contact, "testnet", two);
assert.equal(needs(one), true, "a lower cost is a change too");
assert.equal(needs(two, { ...contact, address: "different-address" }), true);
assert.equal(needs(two, { ...contact, index: 2 }), true);
assert.equal(needs(two, contact, "mainnet"), true);
assert.equal(needs(two, contact, "testnet", replacement), true, "replacing the account resets review");
assert.equal(needs({ ...two, error: "Cannot send" }), true);
assert.equal(needs({ ...two, fee: NaN }), true);
review.clear();
assert.equal(needs(two), true, "locking or clearing resets every acknowledgement");
console.log("messaging-cost-review: ok");
