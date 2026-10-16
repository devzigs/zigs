// Command schema and redaction of the Solana Worker. This file has no import, so Node tests load
// it as it is. The Worker gets the role secrets (the viewing key and the nullifier secrets of the
// group key and of the PDA identity) and nothing else (ZOLANA.md 3.3): a field outside its schema
// is refused by name, so a FROST share, solSeed or a nonce cannot reach it.

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const HELIUS_HOST = "devnet.helius-rpc.com";

let loopbackAllowed = false;

/**
 * Test mode: loopback RPC URLs pass the init check. Only the entry script of the mock run
 * (solspike/mock/page/test-worker.js) calls it. The product Worker starts from /sol/worker.js,
 * which never calls it, and no command can set the flag.
 */
export function allowLoopbackForTests() {
  loopbackAllowed = true;
}

const hexOf = (bytes) => (v) =>
  typeof v === "string" && v.length === bytes * 2 && /^[0-9a-f]+$/.test(v);
const base58 = (v) => typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const signature = (v) => typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(v);
const base64 = (v) =>
  typeof v === "string" && v.length > 0 && v.length <= 8192 && /^[A-Za-z0-9+/]+={0,2}$/.test(v);
const decimal = (v) => typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/.test(v);
const addressHex = (v) => typeof v === "string" && /^([0-9a-f]{2}){1,256}$/.test(v);
const payKind = (v) => v === "pay" || v === "migrate";
const hexText = (v) => typeof v === "string" && v.length <= 16384 && /^([0-9a-f]{2})+$/.test(v);
const idList = (v) =>
  Array.isArray(v) && v.length >= 1 && v.length <= 40 && v.every(hexOf(32));

function hostAllowed(url) {
  if (LOOPBACK.has(url.hostname)) {
    return loopbackAllowed && (url.protocol === "http:" || url.protocol === "https:");
  }
  return url.protocol === "https:" && url.host === HELIUS_HOST;
}

/** An https URL on the Devnet Helius host (default port). In test mode also a loopback URL. */
function rpcUrl(v) {
  if (typeof v !== "string") return false;
  let url;
  try {
    url = new URL(v);
  } catch {
    return false;
  }
  return hostAllowed(url) && url.username === "" && url.password === "" && url.hash === "";
}

/** Per command: the allowed fields, each with its check. A field must be present and valid. */
export const SCHEMA = {
  init: {
    rpcUrl,
    nullifierSecret: hexOf(31),
    pdaNullifierSecret: hexOf(31),
    viewingSecret: hexOf(32),
    groupKey: hexOf(32),
    pda: hexOf(32),
  },
  sync: {},
  syncOld: {},
  account: { account: base58 },
  rent: { space: decimal },
  history: { account: base58 },
  blockhash: {},
  readNonce: { account: base58 },
  treeFees: { tree: base58 },
  prepare: {
    kind: payKind,
    recipient: addressHex,
    amount: decimal,
    expiry: decimal,
    payer: base58,
  },
  reprove: {
    recipient: addressHex,
    payer: base58,
    plan: hexText,
    inputIds: idList,
    transact: hexText,
    commitment: hexOf(32),
  },
  inspect: { tx: base64 },
  balance: { account: base58 },
  simulate: { tx: base64 },
  preflight: { tx: base64 },
  send: { tx: base64 },
  status: { signature },
  confirm: { signature },
};

const shown = (name) => JSON.stringify(String(name).slice(0, 40));

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Throws a short error that names the command or field and never a value. */
export function checkCommand(cmd, args) {
  if (typeof cmd !== "string" || !Object.hasOwn(SCHEMA, cmd)) throw new Error("unknown command");
  if (!isObject(args)) throw new Error(`${cmd}: the arguments must be an object`);
  const fields = SCHEMA[cmd];
  const extra = Object.keys(args).find((name) => !Object.hasOwn(fields, name));
  if (extra !== undefined) throw new Error(`${cmd}: field ${shown(extra)} is not allowed`);
  const bad = Object.keys(fields).find((name) => !fields[name](args[name]));
  if (bad !== undefined) throw new Error(`${cmd}: field ${bad} is missing or malformed`);
}

const KEY_NAME = "api-key";
const KEY_PARAM = new RegExp(`(${KEY_NAME}=)[^&\\s"'#\\\\)]+`, "gi");
const MARK = "[redacted]";

/**
 * redact(text) removes every added secret, longest first, and then the value of any api-key
 * parameter. redact.add(...values) adds secrets. The longest go first: the whole URL must go
 * before its key, or the rest of the query would stay in the text.
 */
export function makeRedactor() {
  const secrets = [];
  const redact = (text) => {
    let out = String(text);
    for (const secret of secrets) out = out.split(secret).join(MARK);
    return out.replace(KEY_PARAM, `$1${MARK}`);
  };
  redact.add = (...values) => {
    for (const v of values) {
      if (typeof v === "string" && v.length >= 8 && !secrets.includes(v)) secrets.push(v);
    }
    secrets.sort((a, b) => b.length - a.length);
  };
  return redact;
}
