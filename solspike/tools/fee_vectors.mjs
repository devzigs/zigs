// Writes wasm-sol/vectors/fee_keys.json: the fee keys of test seats (ZOLANA.md 5). tests/fee_key.rs
// compares the Rust keys with them.
//
//   node solspike/tools/fee_vectors.mjs [out file]
//
// The key is derived here in JavaScript, independent of the Rust code: HKDF-SHA256 of node:crypto
// with an empty salt, the signing share as the input key material, and the info
// `zigs-sol/fee-key/v1 || group key || seat` (the seat as 2 bytes, little endian). The public key
// is the Ed25519 public key of the 32-byte output that node:crypto makes. The inputs are test
// values: bytes written in this file, and the three key packages of web/test/sol-group.json.
import { createPrivateKey, createPublicKey, hkdfSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? path.join(here, "../../wasm-sol/vectors/fee_keys.json");
const group = JSON.parse(readFileSync(path.join(here, "../../web/test/sol-group.json"), "utf8"));

const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const hex = (bytes) => Buffer.from(bytes).toString("hex");

function feeKey(share, groupKey, seat) {
  const label = Buffer.from("zigs-sol/fee-key/v1");
  const info = Buffer.concat([label, groupKey, Buffer.from([seat & 255, seat >> 8])]);
  const secret = Buffer.from(hkdfSync("sha256", share, Buffer.alloc(0), info, 32));
  const der = Buffer.concat([PKCS8, secret]);
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const spki = createPublicKey(key).export({ format: "der", type: "spki" });
  return { secret: hex(secret), public: hex(spki.subarray(-32)) };
}

const fill = (byte) => Buffer.alloc(32, byte);
const RAW = [
  ["share-11-group-22-seat-1", fill(0x11), fill(0x22), 1],
  ["seat-2", fill(0x11), fill(0x22), 2],
  ["seat-7", fill(0x11), fill(0x22), 7],
  ["share-12", fill(0x12), fill(0x22), 1],
  ["group-23", fill(0x11), fill(0x23), 1],
  ["zeros", fill(0x00), fill(0x00), 1],
  ["ones", fill(0xff), fill(0xff), 7],
].map(([name, share, groupKey, seat]) => ({
  name,
  signingShare: hex(share),
  groupKey: hex(groupKey),
  seat,
  ...feeKey(share, groupKey, seat),
}));

const packages = Object.entries(group.seats).map(([seat, { keyPackage }]) => ({
  name: `seat-${seat}`,
  keyPackage,
  ...feeKey(
    Buffer.from(keyPackage.signing_share, "hex"),
    Buffer.from(keyPackage.verifying_key, "hex"),
    Number(seat),
  ),
}));

const note = "Test keys made by solspike/tools/fee_vectors.mjs. Never fund them.";
writeFileSync(out, JSON.stringify({ note, raw: RAW, packages }, null, 1) + "\n");
console.log(`${RAW.length} raw vectors, ${packages.length} key packages -> ${out}`);
