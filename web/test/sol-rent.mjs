// The rent of expired proposals (web/sol/rent.js, SOL-52) with the real page modules and the real
// wasm checker, against the fake chain (sol-chain.mjs):
//  - which proposals a fee key may cancel: those of its group that name it alone, after their
//    expiry by the clock of the chain;
//  - the Worker command `owned` and the fake chain select accounts with the same RPC filters
//    (owned.js), on account data in the layout of the program;
//  - the cancel carries no abort authority, so the program refuses it before the expiry; the
//    expired proposal closes and its rent comes back to the fee address.
// Run: node web/test/sol-rent.mjs   (Node 24)
import assert from "node:assert/strict";
import { feeOf } from "../sol/fee.js";
import { bytesOf, intentHex, pinsHex } from "../sol/intent.js";
import { proposalFilters } from "../sol/owned.js";
import { heldOf, proposalOf, reclaimRent, reclaimable, scanRent } from "../sol/rent.js";
import { solView } from "../sol/view.js";
import * as kit from "../sol/zolana.bundle.js";
import { W, c, chain, done, feeAddress } from "./sol-setup.mjs";

const PROGRAM = "5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL";
const DAY = 86_400n;
const RENT = 1_356_360n;
const FEE = 5_000n;
const le64 = (n) => Buffer.from(new BigUint64Array([BigInt(n)]).buffer).toString("hex");
const owner = Buffer.from(kit.getAddressEncoder().encode(PROGRAM)).toString("hex");

// ---- Which proposals a fee key may cancel ---------------------------------------------------

{
  const [group, fee, other] = ["aa", "bb", "cc"].map((b) => b.repeat(32));
  const now = 1_000_000n;
  const p = (address, over) => ({
    address,
    lamports: RENT,
    commitment: "11".repeat(32),
    group,
    expiry: now - 1n,
    rentRecipient: fee,
    authorities: "01" + fee,
    ...over,
  });
  const proposals = [
    p("expired"),
    p("at-expiry", { expiry: now }),
    p("live", { expiry: now + DAY }),
    p("other-group", { group: other }),
    p("other-recipient", { rentRecipient: other }),
    p("other-authority", { authorities: "01" + other }),
    p("two-authorities", { authorities: "02" + fee + other }),
  ];
  const got = reclaimable(proposals, { group, fee, now });
  assert.deepEqual(got.map((x) => x.address), ["expired"], "only after the expiry");

  // The RPC filters of the Worker match where the program writes (sol-program state.rs).
  const body = "11".repeat(32) + group + le64(now) + fee + "01" + fee;
  const matches = (data, filters) =>
    filters.every(({ memcmp: { offset, bytes, encoding } }) => {
      const part = Buffer.from(bytes, encoding).toString("hex");
      return data.slice(2 * offset, 2 * offset + part.length) === part;
    });
  assert.ok(matches("01ff" + body, proposalFilters(group, fee)));
  assert.ok(!matches("02ff" + body, proposalFilters(group, fee)), "another kind");
  assert.ok(!matches("01ff" + body, proposalFilters(other, fee)), "another group");
  assert.ok(!matches("01ff" + body, proposalFilters(group, other)), "another rent recipient");
  assert.deepEqual(proposalOf({ address: "x", lamports: "1", data: "01ff" + body }).expiry, now);
}

// ---- The cancel against the fake chain -------------------------------------------------------

const seat = 1;
const fee = feeOf(c, seat).key;

/** The account addresses of the approvals program instruction of a v1 message. */
function programAccounts(message) {
  const m = kit.getCompiledTransactionMessageDecoder().decode(message);
  const i = m.instructionHeaders.findIndex(
    (head) => m.staticAccounts[head.programAccountIndex] === PROGRAM,
  );
  return [...m.instructionPayloads[i].instructionAccountIndices].map((x) => m.staticAccounts[x]);
}

/** The cancel message that the checker compiles for a body of this seat. */
function cancelMessage(commitment, expiry) {
  const fields = { commitment, expiry, blockhash: "00".repeat(32) };
  const intent = bytesOf(intentHex("cancelProposal", fields));
  return W.compile_message(intent, bytesOf(pinsHex(done, fee)), new Uint8Array(0));
}

/** Puts an open proposal of this seat on the fake chain, at the address of the checker. */
function openProposal(commitment, expiry) {
  const address = programAccounts(cancelMessage(commitment, expiry))[1];
  const body = commitment + done.groupKey + le64(expiry) + fee + "01" + fee;
  chain.accounts.set(address, { owner, lamports: String(RENT), data: "01ff" + body });
  return address;
}

const now = 1_800_000_000n;
chain.now = now;
const expired = openProposal("01".repeat(32), now - 10n);
const live = openProposal("02".repeat(32), now + 23n * 3600n);

const accounts = programAccounts(cancelMessage("02".repeat(32), now + 23n * 3600n));
assert.equal(accounts.length, 5, "no abort authority: the program refuses it before the expiry");
assert.equal(accounts[0], feeAddress(seat), "the fee key pays");
assert.equal(accounts[3], feeAddress(seat), "the rent goes back to the fee key");

await scanRent(c);
assert.deepEqual(c.rent.found[seat].map((p) => p.address), [expired], "not the live proposal");
assert.equal(heldOf(c, seat), RENT);

const before = chain.balances.get(feeAddress(seat));
await reclaimRent(c, seat);
assert.equal(chain.accounts.has(expired), false);
assert.equal(chain.accounts.has(live), true, "the live proposal stays");
assert.equal(chain.balances.get(feeAddress(seat)), before + RENT - FEE);
assert.equal(heldOf(c, seat), 0n);

// A false clock of the RPC makes the page try the live proposal: the program refuses the cancel.
chain.rpcNow = now + DAY;
await assert.rejects(reclaimRent(c, seat), /network refused the cancel: Custom 6017/);
chain.rpcNow = null;
assert.equal(chain.accounts.has(live), true, "a cancel before the expiry never lands");

// After its expiry the card offers it, and the cancel returns its rent.
chain.now = now + DAY;
await scanRent(c);
const node = (tag, attrs = {}, ...kids) => ({ tag, attrs, kids: kids.flat(Infinity) });
const textOf = (n) => (n && typeof n === "object" ? n.kids.map(textOf).join(" ") : String(n ?? ""));
const findAll = (n, pick) =>
  n && typeof n === "object"
    ? [...(pick(n) ? [n] : []), ...n.kids.flatMap((k) => findAll(k, pick))]
    : [];
const view = solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {});
const [row] = findAll(view, (n) => n.attrs["data-sol"] === "rent-" + seat);
assert.match(textOf(row), /Seat 1: 0\.00135636 SOL/);
const held = chain.balances.get(feeAddress(seat));
await reclaimRent(c, seat);
assert.equal(chain.accounts.has(live), false);
assert.equal(chain.balances.get(feeAddress(seat)), held + RENT - FEE);

console.log("sol-rent: all checks passed");
process.exit(0);
