// Checks web/qr.js against libqrencode: for each input, one of our 8 masked matrices must equal
// qrencode's output module for module. Run: node web/test/qr.mjs (needs the qrencode CLI).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { qrMatrix } from "../qr.js";

function reference(text) {
  const out = execFileSync("qrencode", ["-8", "-l", "M", "-m", "0", "-t", "ASCII", "-o", "-", text], { encoding: "utf8" });
  // Keep trailing spaces: they are light modules of the last row.
  const rows = out.replace(/\n$/, "").split("\n"), width = rows[0].length / 2;
  return rows.map((line) => Array.from({ length: width }, (_, i) => line[2 * i] === "#"));
}

const inputs = [
  "hi",
  "https://app.zigs.app/#ac8406fe2b594963ae0f.kHrQt9IVYsHadKqvNY9-eRm5hl4eHBClmOx7Afoy_IA",
  "utest1d9re9qdkh4qrkv8q67rppuzd3ekjvexat87caj2rhdl868pc4tx798ye625nca2jfy2jqtga0a2daugjwflq57n7s5jvfzp02guxcjs5",
  "x".repeat(300),
  "zcash:" + "u".repeat(600),
];
for (const text of inputs) {
  const want = reference(text);
  const masks = [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => JSON.stringify(qrMatrix(text, k)) === JSON.stringify(want));
  assert.equal(masks.length, 1, "no mask reproduces qrencode for a " + text.length + "-byte input (size " + want.length + ")");
  console.log("ok", text.length, "bytes, size", want.length, "mask", masks[0], "auto mask", qrMatrix(text).length === want.length);
}
assert.throws(() => qrMatrix("x".repeat(700)), /too long/);
console.log("qr.js matches libqrencode");
