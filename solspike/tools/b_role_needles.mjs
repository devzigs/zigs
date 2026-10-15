// Prints the secrets of key B (the P4 test key) that the mock run uses, one hex value per line:
// the seed, the nullifier secret and the viewing scalar. tools/leak_scan.py runs this script and
// reads the pipe, so that the scan also looks for values that no file holds (the derived roles).
// It refuses to print to a terminal.
import { roleSecretsOfB } from "../mock/roles.mjs";

if (process.stdout.isTTY) throw new Error("this script prints secrets: pipe it, never print it");
const { seedHex, secrets } = await roleSecretsOfB();
process.stdout.write(`${seedHex}\n${secrets.nullifierSecret}\n${secrets.viewingSecret}\n`);
