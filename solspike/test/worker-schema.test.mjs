// Schema tests of the Solana Worker (P8c). Usage: node solspike/test/worker-schema.test.mjs
// init takes the role secrets (the viewing key and the nullifier secrets of the group key and of
// the PDA identity), the group key, the PDA and the RPC URL, and nothing else. A FROST key
// package, solSeed, a nonce or any other field is refused by name. Errors never carry a value.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { allowLoopbackForTests, checkCommand, makeRedactor, SCHEMA } from "../../web/sol/guard.js";

const KEY_NAME = "api-key";

const step = (name) => console.log(`ok  ${name}`);
const SECRET = "ab".repeat(32);
const KEY = "k".repeat(24);
const init = () => ({
  rpcUrl: `https://devnet.helius-rpc.com/?${KEY_NAME}=${KEY}`,
  nullifierSecret: "cd".repeat(31),
  pdaNullifierSecret: "ce".repeat(31),
  viewingSecret: SECRET,
  groupKey: "ef".repeat(32),
  pda: "e0".repeat(32),
});
const LOOPBACK_URLS = [
  "http://127.0.0.1:9/",
  `http://localhost:8795/?${KEY_NAME}=x`,
  "http://[::1]:1/",
  "https://127.0.0.1:9/",
  "https://localhost/",
];
const text = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.message;
  }
  return null;
};

function initFields() {
  checkCommand("init", init());
  for (const field of ["keyPackage", "solSeed", "nonces", "signingShare", "extra"]) {
    const message = text(() => checkCommand("init", { ...init(), [field]: "00".repeat(32) }));
    assert.match(message, new RegExp(`field "${field}" is not allowed`));
    assert.equal(message.includes("0000"), false, "the error echoes a value");
  }
  for (const field of Object.keys(init())) {
    const rest = init();
    delete rest[field];
    assert.match(
      text(() => checkCommand("init", rest)),
      /missing or malformed/,
    );
  }
  step("init takes exactly the six fields; keyPackage, solSeed and nonces are refused by name");
}

function initValues() {
  const bad = {
    nullifierSecret: ["", "cd".repeat(32), "CD".repeat(31), `${"cd".repeat(30)}zz`, 5],
    pdaNullifierSecret: ["", "ce".repeat(32), "CE".repeat(31)],
    viewingSecret: ["ab".repeat(31), `${SECRET}00`, null],
    groupKey: ["ef".repeat(31), "0x" + "ef".repeat(31)],
    pda: ["e0".repeat(31), "E0".repeat(32), 1],
    rpcUrl: [
      `http://devnet.helius-rpc.com/?${KEY_NAME}=x`,
      `https://evil.example/?${KEY_NAME}=x`,
      "https://devnet.helius-rpc.com.evil.example/",
      "https://user:pass@devnet.helius-rpc.com/",
      `https://mainnet.helius-rpc.com/?${KEY_NAME}=x`,
      `https://beta.helius-rpc.com/?${KEY_NAME}=x`,
      `https://a.devnet.helius-rpc.com/?${KEY_NAME}=x`,
      `https://xdevnet.helius-rpc.com/?${KEY_NAME}=x`,
      `https://devnet.helius-rpc.com./?${KEY_NAME}=x`,
      `https://devnet.helius-rpc.com:8443/?${KEY_NAME}=x`,
      `https://helius-rpc.com/?${KEY_NAME}=x`,
      "https://devnet.helius-rpc.com.evil.example:443/",
      "https://devnet.helius-rpc.com/#frag",
      "ftp://127.0.0.1/",
      "not a url",
      42,
    ],
  };
  for (const [field, values] of Object.entries(bad)) {
    for (const value of values) {
      const args = { ...init(), [field]: value };
      assert.match(
        text(() => checkCommand("init", args)),
        /missing or malformed/,
        `${field}`,
      );
    }
  }
  for (const rpcUrl of [
    `https://devnet.helius-rpc.com/?${KEY_NAME}=x`,
    `https://devnet.helius-rpc.com:443/?${KEY_NAME}=x`,
    `https://DEVNET.helius-rpc.com/?${KEY_NAME}=x`,
  ]) {
    checkCommand("init", { ...init(), rpcUrl });
  }
  for (const rpcUrl of LOOPBACK_URLS) {
    const args = { ...init(), rpcUrl };
    assert.match(
      text(() => checkCommand("init", args)),
      /missing or malformed/,
      `${rpcUrl} passed without the test mode`,
    );
  }
  step("init takes the Devnet Helius host only (not mainnet, a sibling, a port or a suffix)");
  step("init refuses a loopback URL while the test mode is off (the default)");
}

function otherCommands() {
  for (const bad of ["", "init ", "__proto__", "constructor", "toString", 7, undefined]) {
    assert.equal(
      text(() => checkCommand(bad, {})),
      "unknown command",
    );
  }
  for (const cmd of ["sync", "blockhash"]) checkCommand(cmd, {});
  assert.match(
    text(() => checkCommand("sync", { x: 1 })),
    /not allowed/,
  );
  for (const args of [null, [], "x", 1]) {
    assert.match(
      text(() => checkCommand("sync", args)),
      /must be an object/,
    );
  }
  const account = "4kf6Z6LTZC7E7PRvUAoADayFXQfDGppBx8m1AuUvUndE";
  checkCommand("readNonce", { account });
  checkCommand("treeFees", { tree: account });
  for (const bad of ["0OIl", account.slice(20), account + account, ""]) {
    assert.match(
      text(() => checkCommand("readNonce", { account: bad })),
      /malformed/,
    );
  }
  prepareFields();
  programReads(account);
  checkCommand("send", { tx: "AQID" });
  assert.match(
    text(() => checkCommand("send", { tx: "not base64!" })),
    /malformed/,
  );
  checkCommand("balance", { account });
  checkCommand("preflight", { tx: "AQID" });
  checkCommand("inspect", { tx: "AQID" });
  checkCommand("status", { signature: "5".repeat(88) });
  checkCommand("transaction", { signature: "5".repeat(88) });
  for (const [cmd, args] of [
    ["balance", { account: "0OIl" }],
    ["preflight", { tx: "not base64!" }],
    ["inspect", { tx: "not base64!" }],
    ["status", { signature: "short" }],
    ["transaction", { signature: "short" }],
  ]) {
    assert.match(
      text(() => checkCommand(cmd, args)),
      /malformed/,
    );
  }
  for (const cmd of ["balance", "preflight", "inspect", "status", "owned"]) {
    assert.match(
      text(() => checkCommand(cmd, { extra: 1 })),
      /not allowed/,
    );
  }
  assert.deepEqual(Object.keys(SCHEMA).sort(), [
    "account",
    "balance",
    "blockhash",
    "confirm",
    "history",
    "init",
    "inspect",
    "owned",
    "poolSlot",
    "preflight",
    "prepare",
    "readNonce",
    "recipientAccount",
    "rent",
    "reprove",
    "selftest",
    "send",
    "simulate",
    "status",
    "sync",
    "syncOld",
    "transaction",
    "treeFees",
  ]);
  step("every command refuses unknown fields, wrong types and malformed values");
}

/** prepare: the kind, the amounts and the payer (the fee key of a seat) are checked. */
function prepareFields() {
  const payer = "5TeWSsjg2gbxCyWVniXeCmwM7UtHTCK7svzJr5xYJzHf";
  const prepare = { kind: "pay", recipient: "01ab", amount: "1000000", expiry: "1900000000" };
  prepare.avoid = ["ab".repeat(32)];
  checkCommand("prepare", { ...prepare, payer });
  checkCommand("prepare", { ...prepare, payer, kind: "migrate" });
  checkCommand("prepare", { ...prepare, payer, kind: "withdraw" });
  // The payer (the fee key of a seat, as a base58 address) is a field that must be there.
  const lacking = text(() => checkCommand("prepare", prepare));
  assert.match(lacking, /prepare: field payer is missing or malformed/);
  for (const [field, value] of [
    ["kind", "withdrawal"],
    ["kind", "transfer"],
    ["amount", "-1"],
    ["amount", "01"],
    ["amount", "1".repeat(21)],
    ["expiry", "1e9"],
    ["recipient", "xyz"],
    ["payer", "0OIl"],
    ["payer", payer.slice(20)],
    ["payer", "ab".repeat(32)],
    ["avoid", ["zz"]],
    ["avoid", "ab".repeat(32)],
  ]) {
    assert.match(
      text(() => checkCommand("prepare", { ...prepare, payer, [field]: value })),
      /malformed/,
    );
  }
  reproveFields(payer);
}

/**
 * The reads of the program design: the old wallet, an account, its history, the rent, and the open
 * proposals of a fee key in a group (SOL-52).
 */
function programReads(account) {
  const key = "ab".repeat(32);
  checkCommand("syncOld", {});
  checkCommand("owned", { fee: key, group: key });
  checkCommand("account", { account });
  checkCommand("recipientAccount", { account });
  checkCommand("history", { account });
  checkCommand("rent", { space: "139" });
  for (const [cmd, args] of [
    ["account", { account: "0OIl" }],
    ["recipientAccount", { account: "0OIl" }],
    ["history", { account: "" }],
    ["rent", { space: "-1" }],
    ["rent", { space: 139 }],
    ["owned", { fee: key.slice(2), group: key }],
    ["owned", { fee: key, group: key.toUpperCase() }],
    ["owned", { fee: account, group: key }],
    ["owned", { group: key }],
  ]) {
    assert.match(
      text(() => checkCommand(cmd, args)),
      /malformed/,
      cmd,
    );
  }
}

/** reprove takes the payment as the session holds it: no secret, every field checked. */
function reproveFields(payer) {
  const reprove = {
    recipient: "01ab",
    withdraw: "0",
    payer,
    plan: "aa".repeat(33),
    inputIds: ["12".repeat(32)],
    transact: "10" + "00".repeat(40),
    commitment: "34".repeat(32),
  };
  checkCommand("reprove", reprove);
  for (const [field, value] of [
    ["inputIds", []],
    ["inputIds", ["12".repeat(31)]],
    ["inputIds", Array(41).fill("12".repeat(32))],
    ["inputIds", "12".repeat(32)],
    ["plan", "a"],
    ["transact", "zz"],
    ["transact", "00".repeat(8193)],
    ["commitment", "34".repeat(31)],
    ["payer", "ab".repeat(32)],
    ["withdraw", "-1"],
    ["withdraw", "01"],
  ]) {
    assert.match(
      text(() => checkCommand("reprove", { ...reprove, [field]: value })),
      /malformed/,
      field,
    );
  }
  for (const field of ["keyPackage", "solSeed", "signature"]) {
    assert.match(
      text(() => checkCommand("reprove", { ...reprove, [field]: "00" })),
      /not allowed/,
    );
  }
}

function redaction() {
  const redact = makeRedactor();
  redact.add(init().rpcUrl, KEY, SECRET);
  const messages = [
    `fetch failed for ${init().rpcUrl}`,
    `bad key ${KEY} and ${SECRET} twice ${SECRET}`,
    `GET /v1/zolana/x?${KEY_NAME}=${"z".repeat(30)}&b=1 failed`,
    "short: abc",
  ];
  const out = messages.map(redact);
  for (const secret of [KEY, SECRET, "z".repeat(30)]) {
    assert.equal(
      out.some((line) => line.includes(secret)),
      false,
      "a secret survived",
    );
  }
  assert.match(out[2], new RegExp(`${KEY_NAME}=\\[redacted\\]&b=1`));
  assert.equal(out[3], "short: abc");
  const wide = makeRedactor();
  const search = `?${KEY_NAME}=${KEY}&other=${"q".repeat(12)}`;
  const url = `https://devnet.helius-rpc.com/${search}`;
  wide.add(url, search, KEY);
  assert.equal(wide(`failed ${url}`), "failed [redacted]", "the rest of the query stayed");
  assert.equal(wide(`key ${KEY} in ${search}`), "key [redacted] in [redacted]");
  step("redact removes the URL, the key, api-key values and the role secrets");
}

/** Runs last: the test mode is a flag of the module that nothing can switch off again. */
function loopbackTestMode() {
  allowLoopbackForTests();
  for (const rpcUrl of LOOPBACK_URLS) checkCommand("init", { ...init(), rpcUrl });
  const bad = [
    "http://127.0.0.1.evil.example/",
    "http://evil.example/",
    "http://user:pass@127.0.0.1:9/",
    "http://127.0.0.1:9/#frag",
    "ftp://127.0.0.1/",
    "ws://localhost/",
    `http://devnet.helius-rpc.com/?${KEY_NAME}=x`,
    `https://mainnet.helius-rpc.com/?${KEY_NAME}=x`,
  ];
  for (const rpcUrl of bad) {
    assert.match(
      text(() => checkCommand("init", { ...init(), rpcUrl })),
      /missing or malformed/,
      `${rpcUrl} passed in test mode`,
    );
  }
  checkCommand("init", init());
  step("allowLoopbackForTests accepts loopback URLs and nothing else");
}

/** No file that ships (web/, cf/src) calls the test mode but guard.js, which defines it. */
function pageNeverEnables() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const name = Buffer.from("allowLoopbackForTests");
  const holders = [];
  let seen = 0;
  for (const dir of ["web", "cf/src"]) {
    for (const entry of readdirSync(`${root}${dir}`, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = `${entry.parentPath}/${entry.name}`;
      seen += 1;
      if (readFileSync(path).includes(name)) holders.push(relative(root, path));
    }
  }
  assert.ok(seen > 20, `only ${seen} files were scanned`);
  assert.deepEqual(holders, ["web/sol/guard.js"], "a shipped file names the test mode");
  step("no shipped file but guard.js names the test mode, so the product page never enables it");
}

initFields();
initValues();
otherCommands();
redaction();
pageNeverEnables();
loopbackTestMode();
console.log("worker schema tests passed");
