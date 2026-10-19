// The Help words and the diagnostics text (web/help-model.js): the answers hold no link, use the
// word device and name what each server sees, and the diagnostics text holds the facts that the
// page gives and nothing else.
// Run: node web/test/help.mjs   (Node 24)
import assert from "node:assert/strict";
import { HELP, diagnosticsText } from "../help-model.js";

assert.ok(HELP.length >= 5, "Help has its answers");
for (const [question, answer] of HELP) {
  assert.ok(question.endsWith("?") && answer.length > 40, "a question and a real answer");
  assert.doesNotMatch(answer, /https?:|www\.|\.com|\.app/, "an answer needs no network: no link");
  assert.doesNotMatch(question + answer, /\bseats?\b|signers?|passkey/i,
    "an answer says device, and Zigs has no passkey");
  assert.ok(answer.split(/(?<=\.) /).every((s) => s.split(" ").length <= 30),
    "short sentences: " + question);
}
const servers = HELP.find(([question]) => /servers see/.test(question))[1];
assert.match(servers, /hosted prover of Helius also sees each Solana payment/,
  "the servers answer names the hosted prover");
assert.match(servers, /Unless local proving is on/, "and says when it sees them");
assert.match(servers, /public keys of this wallet/, "Helius sees public keys");
assert.match(servers, /never sees a secret key/, "no server sees a secret key");
assert.doesNotMatch(servers, /never a key|the keys of this wallet/, "no loose word key");
console.log("ok  the answers");

assert.equal(diagnosticsText([["Browser online", true], ["Devices joined", 3]]),
  "Zigs diagnostics\nMade in this browser. Zigs sends nothing.\n\nBrowser online: true\n"
  + "Devices joined: 3", "a fact is a name and its value");
assert.equal(diagnosticsText([]), "Zigs diagnostics\nMade in this browser. Zigs sends nothing.\n",
  "no fact");
console.log("ok  the text");
