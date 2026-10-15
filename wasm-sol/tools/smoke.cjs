// Runs the vectors of vectors/smoke through the wasm build (wasm-bindgen --target nodejs) and
// compares each answer with the answer that the native build wrote (examples/gen_vectors.rs).
// Usage: node tools/smoke.cjs <dir with sol_wasm.js>
const fs = require("node:fs");
const path = require("node:path");

const wasmDir = path.resolve(process.argv[2] ?? "target/pkg-node");
const lib = require(path.join(wasmDir, "sol_wasm.js"));
const smoke = path.resolve(__dirname, "..", "vectors", "smoke");
const NOW = 1_800_000_000n - 3_600n;

let failed = 0;
const names = fs
  .readdirSync(smoke)
  .filter((f) => f.endsWith(".msg"))
  .map((f) => f.slice(0, -4));
for (const name of names.sort()) {
  const read = (ext) => fs.readFileSync(path.join(smoke, `${name}.${ext}`));
  const want = read("answer").toString("utf8");
  const inputs = ["msg", "intent", "pins", "snapshot"].map(read);
  const got = lib.check_message(...inputs, NOW);
  const ok = got === want;
  if (!ok) failed += 1;
  const shown = got.split("\n").slice(0, 2).join(" | ").slice(0, 70);
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(36)} ${shown}`);
}
// A malformed input is an error answer, never a throw.
const three = () => new Uint8Array(3);
const bad = lib.check_message(three(), three(), new Uint8Array(97), three(), NOW);
if (!bad.startsWith("error")) {
  failed += 1;
  console.log("FAIL malformed input is not an error answer:", bad);
}
const rules = lib.rule_list().split("\n").length;
console.log(`${names.length} vectors, ${rules} rules, ${failed} different from native`);
process.exit(failed === 0 ? 0 : 1);
