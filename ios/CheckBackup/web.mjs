// Web side of ios/check-backup.sh. `make <dir>` seals a web-shaped backup. `verify <dir>` opens
// the file that the Swift side made, with the same passphrase.
import fs from "node:fs";
import assert from "node:assert/strict";
import { initSync, backupSeal, backupOpen, boxKeypair } from "../../web/pkg/zec_frost_wasm.js";
import { newSignKey } from "../../web/chat.js";
import { slowCall } from "../../web/util.js";

const wasm = new URL("../../web/pkg/zec_frost_wasm_bg.wasm", import.meta.url);
initSync({ module: fs.readFileSync(wasm) });
const Z = { backupSeal, backupOpen };
const [mode, dir] = process.argv.slice(2);
// Not ASCII, and typed with split letters (NFD): both apps must normalize it to the same bytes.
const pass = "correct horse é \u{1F600} battery";

if (mode === "make") {
  // Real key pairs: the Swift side must find that each secret key makes its public key.
  const box = JSON.parse(boxKeypair()), sign = await newSignKey();
  const id = "02" + "0".repeat(62);
  const plain = JSON.stringify({
    kind: "zec-frost-key-share", group: "0123456789abcdef0123", groupName: "Team treasury",
    seat: 2, threshold: 2, of: 3, key: "A".repeat(43),
    wallet: { address: "utest1x", birthday: 123 },
    secret: {
      keyPackage: { identifier: id, verifying_share: "abc" },
      publicKeyPackage: { verifying_key: "gk", verifying_shares: { [id]: "abc" } }, groupKey: "gk",
      vaultSk: "vsk", uid: "web-uid", boxSk: box.sk, boxPk: box.pk, ...sign, version: 2,
      room: { id: "fedcba9876543210fedc", key: "B".repeat(43) },
      checkedWallet: "wk", aborted: "x", nonces: { s1: "n" },
    },
  });
  fs.writeFileSync(`${dir}/pass.txt`, pass);
  fs.writeFileSync(`${dir}/web-made.zigsbackup`, slowCall(Z, "backupSeal", [pass, plain]));
} else {
  const made = fs.readFileSync(`${dir}/swift-made.zigsbackup`, "utf8");
  const opened = JSON.parse(slowCall(Z, "backupOpen", [pass, made]));
  assert.equal(opened.kind, "zec-frost-key-share");
  assert.equal(opened.groupName, "From iPhone");
  assert.equal(opened.secret.checkedWallet, "wk");
}
