// fund.mjs refuses before it reads a key or calls a network (P8e). The refusals are the ones that
// the brief names: an address that the app does not show, an amount over the cap, a funder that
// funds itself is checked later and needs the key, so it is not here. Nothing is sent.
// Usage: node solspike/test/fund.test.mjs
import assert from "node:assert/strict";
import { MAX_LAMPORTS, fund } from "../tools/fund.mjs";

const A = "B1o5q9sWLRVY2uk43bd1GLLPcNmhqJQ53CfKKxKzeShD";
const B = "7pT1foE6hKiDtLZR8WJLJ61KMeDCaB6QFJR6qsdh269B";
const refused = (request, pattern, why) => assert.rejects(() => fund(request), pattern, why);

assert.equal(MAX_LAMPORTS, 50_000_000n, "0.05 SOL at most per call");
await refused(
  { to: A, shown: B, lamports: 1n },
  /differs from the one that the app shows/,
  "shown",
);
await refused({ to: A, shown: undefined, lamports: 1n }, /differs/, "no shown address");
await refused({ to: undefined, shown: undefined, lamports: 1n }, /differs/, "no address");
await refused({ to: "not an address", shown: "not an address", lamports: 1n }, /.+/, "bad text");
for (const lamports of [0n, -1n, MAX_LAMPORTS + 1n, 50_000_000, "50000000", undefined]) {
  await refused(
    { to: A, shown: A, lamports },
    /the amount must be 1 to 50000000 lamports/,
    String(lamports),
  );
}
console.log("fund: ok, the refusals come before any key or network");
process.exit(0);
