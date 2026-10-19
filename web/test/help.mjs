// The Help words and the diagnostics text (web/help-model.js): the answers hold no link and use
// the word device, and the diagnostics never show a secret, a key, an invite link, an address or
// an id, whole or in the 12-character part that a log line keeps.
// Run: node web/test/help.mjs   (Node 24)
import assert from "node:assert/strict";
import { HELP, diagnosticsText, redact } from "../help-model.js";

assert.ok(HELP.length >= 5, "Help has its answers");
for (const [question, answer] of HELP) {
  assert.ok(question.endsWith("?") && answer.length > 40, "a question and a real answer");
  assert.doesNotMatch(answer, /https?:|www\.|\.com|\.app/, "an answer needs no network: no link");
  assert.doesNotMatch(question + answer, /\bseats?\b|signers?|passkey/i,
    "an answer says device, and Zigs has no passkey");
  assert.ok(answer.split(/(?<=\.) /).every((s) => s.split(" ").length <= 30),
    "short sentences: " + question);
}
console.log("ok  the answers");

// The values that a real page could put in a log line.
const secret = "wKq3-9sT7uVx_2LmZp0aBcD4eFgHiJkLmNoPqRsTuVw";
const key = "e06e796954ffdb261969131e11129abdeea70c99b6cf132b5be7284cf3bc8031";
const link = "https://zigs.example/#a1b2c3d4e5f6a7b8c9d0." + secret;
const address = "utest1qxz8m4k2v7nrw0e5h3s9pjd6ycl8ta4g2f0xq7u5y3w1z";
const solana = "EvHCyEZUDBzWuuUDwSmXWrJ2vdtgVSr8ikduQfUAVr3r";
const gid = "a1b2c3d4e5f6a7b8c9d0";
const fragment = "e06e796954ff";
const prefix = address.slice(0, 24);

const events = [
  "10:41:07  seat 1: key share ready, wallet key " + fragment + "…",
  "10:41:08  wallet created: " + prefix + "…",
  "10:41:09  transaction broadcast: " + key,
  "10:41:10  ✗ react: bad link " + link + " for " + address,
  "10:41:11  Solana sync: account " + solana + " not found",
  "10:41:12  ignored data without a valid signature (wallet a1b2c3): groups/" + gid + "/seats/1",
  "10:41:13  could not read the memo of ab12cd34: secret=" + secret,
];
const text = diagnosticsText([["Devices joined", 3]], events);
for (const [what, value] of [["secret", secret], ["key", key], ["invite link", link],
  ["address", address], ["Solana address", solana], ["wallet id", gid],
  ["part of a key", fragment], ["start of an address", prefix]]) {
  assert.ok(!text.includes(value), "the diagnostics hide a " + what);
  assert.ok(!text.includes(value.slice(0, 20)), "the diagnostics hide the start of a " + what);
}
assert.match(text, /seat 1: key share ready, wallet key \[hidden\]/,
  "a hidden token leaves the line");
assert.match(text, /10:41:13 {2}could not read the memo of ab12cd34: \[hidden\]/,
  "a short token stays: an id of 8 characters");
console.log("ok  the diagnostics hide what is secret");

assert.equal(redact("The wallet synchronizes transactions"), "The wallet synchronizes transactions",
  "plain words stay");
assert.equal(redact("synced to 4500100, spendable 0.5 ZEC"), "synced to 4500100, spendable 0.5 ZEC",
  "numbers stay");
assert.equal(redact("s" + "t".repeat(18)), "s" + "t".repeat(18), "19 characters stay");
assert.equal(redact("s" + "t".repeat(19)), "[hidden]", "20 characters go");
assert.equal(redact("x 0123456789ab… y"), "x [hidden] y", "12 hex digits in a row go");
assert.equal(redact("x 0123456789a… y"), "x 0123456789a… y", "11 hex digits stay");
assert.equal(redact("one\ttwo  three"), "one\ttwo  three", "the spaces stay");
console.log("ok  redact");

const facts = [["Browser online", true], ["Devices joined", 3]];
assert.equal(diagnosticsText(facts, []),
  "Zigs diagnostics\nMade in this browser. Zigs sends nothing.\n\nBrowser online: true\n"
  + "Devices joined: 3\n\nNo recent events.", "no events");
const many = Array.from({ length: 30 }, (_, i) => "line " + i);
const lines = diagnosticsText([], many).split("\n").filter((l) => l.startsWith("  line"));
assert.deepEqual([lines.length, lines[0], lines.at(-1)], [20, "  line 0", "  line 19"],
  "the newest 20 events show");
console.log("ok  the text");
