// Checks the payment list parser. Run: node web/test/payees.mjs
import assert from "node:assert/strict";
import { parsePayeeList, toZat, zatText } from "../payees.js";

assert.equal(toZat("1.5"), 150000000);
assert.equal(toZat("0.29"), 29000000);
assert.equal(toZat("0.00000001"), 1);
assert.equal(toZat(" 2 "), 200000000);
assert.equal(toZat("1,5"), 150000000);
assert.equal(toZat("21000000"), 21e14);
assert.equal(toZat("21000000.00000001"), null);
for (const bad of ["0", "0.0", "", "1.123456789", "-1", "1e3", "1.5.1", "123456789", "abc", ".5", undefined]) assert.equal(toZat(bad), null, String(bad));
assert.equal(zatText(150000000), "1.5");
assert.equal(zatText(200000000), "2");
assert.equal(zatText(1), "0.00000001");

const sheet = "Address\tAmount\nu1aaa\t0.5\r\nu1bbb\t1\n\n  u1ccc , 0.25 \nu1ddd; 2\nu1eee 3";
assert.deepEqual(parsePayeeList(sheet), { rows: [
  { to: "u1aaa", amount: 50000000 }, { to: "u1bbb", amount: 100000000 }, { to: "u1ccc", amount: 25000000 },
  { to: "u1ddd", amount: 200000000 }, { to: "u1eee", amount: 300000000 }], errors: [] });

const r = parsePayeeList("u1aaa, 0.5\nAlice, u1bbb, 1\nu1ccc\nu1ddd, 0\nu1eee, 1,");
assert.deepEqual(r.rows, [{ to: "u1aaa", amount: 50000000 }, { to: "u1eee", amount: 100000000 }]);
assert.deepEqual(r.errors.map((e) => e.split(":")[0]), ["Line 2", "Line 3", "Line 4"]);
assert.deepEqual(parsePayeeList("address is here, 1"), { rows: [], errors: [] }, "a first line naming address is a header");
assert.deepEqual(parsePayeeList("\n Address,Amount\ru1aaa,1\ru1bbb\u00a02").rows, [{ to: "u1aaa", amount: 100000000 }, { to: "u1bbb", amount: 200000000 }], "lone CR, NBSP and a header after a blank line");
console.log("payees.js ok");
