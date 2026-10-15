// Redaction of secrets in everything the harness logs or throws. The needles come from the files
// that tools/needle-sources.json names (the same list as tools/leak_scan.py), read here, inside
// this process. A needle is never printed. The harness never logs the parameters of its own CDP
// commands, because a command can carry a secret.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MARK = "[REDACTED]";
const KEY_PARAM = /(api-key=)[^&\s"'#\\]+/gi;

function hexForms(text) {
  const raw = Buffer.from(text.trim(), "hex");
  if (raw.length === 0 || raw.toString("hex") !== text.trim().toLowerCase()) {
    throw new Error("needle source: not a hex secret");
  }
  const b64 = raw.toString("base64").replace(/=+$/, "");
  const b64url = raw.toString("base64url");
  return [raw.toString("hex"), raw.toString("hex").toUpperCase(), b64, b64url];
}

function urlForms(text) {
  const url = text.trim();
  const key = new URL(url).searchParams.get("api-key");
  if (!key) throw new Error("needle source: the URL has no api-key value");
  return [url, key];
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Of(bytes) {
  let n = BigInt("0x0" + Buffer.from(bytes).toString("hex")),
    out = "";
  for (; n > 0n; n /= 58n) out = BASE58[Number(n % 58n)] + out;
  return (
    "1".repeat(
      bytes.findIndex((b) => b !== 0) === -1 ? bytes.length : bytes.findIndex((b) => b !== 0),
    ) + out
  );
}

/** A Solana keypair file: a JSON array of 64 bytes (the seed, then the public key). */
function keyJsonForms(text) {
  const list = JSON.parse(text);
  const ok =
    Array.isArray(list) &&
    list.length === 64 &&
    list.every((b) => Number.isInteger(b) && b >= 0 && b < 256);
  if (!ok) throw new Error("needle source: not a keypair file of 64 bytes");
  const full = Buffer.from(list);
  const parts = [full, full.subarray(0, 32)];
  const forms = [JSON.stringify(list), `[${list.join(", ")}]`];
  for (const raw of parts) {
    const hex = raw.toString("hex");
    forms.push(
      hex,
      hex.toUpperCase(),
      raw.toString("base64"),
      raw.toString("base64").replace(/=+$/, ""),
    );
    forms.push(raw.toString("base64url"), base58Of(raw));
  }
  return forms;
}

const KINDS = { "helius-url": urlForms, hex: hexForms, "key-json": keyJsonForms };

/**
 * The file of a needle source: the file named by its environment variable `env`, else the `file`
 * below `base` ("~/" is the home folder). Null when the source names no file.
 */
export function sourceFile(src, base) {
  if (src.env) {
    const named = process.env[src.env];
    if (named) return named;
    return src.file?.startsWith("~/") ? join(homedir(), src.file.slice(2)) : null;
  }
  return join(base, src.file);
}

/**
 * Reads every needle string. A missing file throws when the source is required and the file
 * is not at its place, and is skipped otherwise: a run with no secret has none to hide.
 */
export function loadNeedles(base = "", sources = null) {
  const list =
    sources ?? JSON.parse(readFileSync(join(HERE, "../tools/needle-sources.json"), "utf8")).sources;
  // A script source (leak_scan.py only) derives secrets that the runs add with redact.add().
  return list.filter((src) => !src.script).flatMap((src) => needlesOf(src, base));
}

function needlesOf(src, base) {
  const file = sourceFile(src, base);
  if (file && existsSync(file)) return KINDS[src.kind](readFileSync(file, "utf8"));
  if (src.required && src.file && !src.env) {
    throw new Error(`needle source missing (required): ${src.file}`);
  }
  return [];
}

/** A redact(text) function. redact.add(value) adds a secret that the harness learns at run time. */
export function makeRedactor(initial) {
  const needles = new Set(initial.filter(Boolean));
  const redact = (text) => {
    let out = String(text).replace(KEY_PARAM, `$1${MARK}`);
    for (const n of [...needles].sort((a, b) => b.length - a.length)) out = out.split(n).join(MARK);
    return out;
  };
  redact.add = (...values) => values.filter(Boolean).forEach((v) => needles.add(v));
  redact.size = () => needles.size;
  return redact;
}

let shared = null;
const real = () => (shared ??= makeRedactor(loadNeedles()));
/** The redactor of the real needles. It is built at the first use. */
export const redact = Object.assign((text) => real()(text), {
  add: (...values) => real().add(...values),
  size: () => real().size(),
});
