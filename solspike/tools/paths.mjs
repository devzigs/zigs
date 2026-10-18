// Where the tools find what stays outside the repo. Each path comes from an environment variable.
// A missing variable stops the tool and names itself. Only the Helius URL file has a default.
// A mock run (SOLSPIKE_MOCK=1, harness/mock.mjs) gets neither the Helius URL nor the funder key.
import { homedir } from "node:os";
import { join } from "node:path";

const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`set ${name}`);
  return value;
};

/** The checkout of the Zolana repo at the commit PIN of build.mjs (ZOLANA.md section 8). */
export const zolanaRepo = () => need("ZOLANA_REPO");
const live = (what) => {
  if (process.env.SOLSPIKE_MOCK === "1") throw new Error(`a mock run has no ${what}`);
};

/** The file with the Helius Devnet URL. The URL holds the API key: never print it. */
export const heliusFile = () => {
  live("Helius URL");
  return process.env.HELIUS_URL_FILE ?? join(homedir(), ".config", "zigs", "helius-app.url");
};
/** The Devnet funder key: a JSON array of 64 bytes. */
export const funderFile = () => {
  live("funder key");
  return need("SOLSPIKE_FUNDER");
};
/** A JSON file with the field seedHex: key B, a registered Devnet key (mock/roles.mjs). */
export const keyBFile = () => need("SOLSPIKE_KEY_B");
/** The file where scenario-f keeps the passphrases of the backups of its test group. */
export const interimFile = () => need("SOLSPIKE_INTERIM");
