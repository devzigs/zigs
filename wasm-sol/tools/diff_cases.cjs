// Ported from the verifier of P3c (tools/v_wasm_cases.cjs). Runs truncated and mutated inputs
// through the WASM build and records each answer in logs/diffcases/cases.json.
// tests/wasm_native_diff.rs replays every case natively and compares the answers (a wasm32
// versus native difference, a trap, or an accept of a changed input shows up there).
// Usage: node tools/diff_cases.cjs pkg-node
const fs = require("node:fs");
const path = require("node:path");

const lib = require(path.resolve(process.argv[2] ?? "pkg-node", "sol_wasm.js"));
const smoke = path.resolve(__dirname, "..", "vectors", "smoke");
const NOW = 1_800_000_000n - 3_600n;
const names = [
  "transfer",
  "withdrawal",
  "transfer-spl",
  "register",
  "shield",
  "ts-transfer-sol",
  "ts-withdraw-with-dummy",
  "ts-withdraw-everything-zero-change",
  "ts-transfer-sol-and-spl-with-dummy",
];
let state = 0x9e3779b97f4a7c15n;
const MASK = 0xffffffffffffffffn;
const next = () => {
  state ^= (state << 13n) & MASK;
  state ^= state >> 7n;
  state ^= (state << 17n) & MASK;
  return state;
};
const cases = [];
let traps = 0;
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const run = (inputs) => {
  let answer;
  try {
    answer = lib.check_message(inputs[0], inputs[1], inputs[2], inputs[3], NOW);
  } catch {
    traps += 1;
    answer = "TRAP";
  }
  const [m, i, p, s] = inputs.map(hex);
  cases.push({ m, i, p, s, a: answer });
};
for (const name of names) {
  const parts = ["msg", "intent", "pins", "snapshot"];
  const read = (e) => new Uint8Array(fs.readFileSync(path.join(smoke, `${name}.${e}`)));
  const base = parts.map(read);
  run(base);
  for (let which = 0; which < 4; which++) {
    const len = base[which].length;
    const step = Math.max(1, Math.floor(len / 40));
    for (let cut = 0; cut < len; cut += step) {
      const inputs = base.map((b) => b.slice());
      inputs[which] = inputs[which].slice(0, cut);
      run(inputs);
    }
  }
  for (let round = 0; round < 400; round++) {
    const inputs = base.map((b) => b.slice());
    const edits = 1 + Number(next() % 4n);
    for (let e = 0; e < edits; e++) {
      const which = Number(next() % 4n);
      const at = Number(next() % BigInt(inputs[which].length));
      inputs[which][at] = Number(next() % 256n);
    }
    run(inputs);
  }
}
fs.mkdirSync(path.resolve(__dirname, "..", "logs", "diffcases"), { recursive: true });
const file = path.resolve(__dirname, "..", "logs", "diffcases", "cases.json");
fs.writeFileSync(file, JSON.stringify(cases));
const kinds = {};
for (const c of cases) {
  const kind = c.a.split(/[\t\n]/)[0];
  kinds[kind] = (kinds[kind] ?? 0) + 1;
}
console.log(cases.length, "cases;", traps, "traps;", JSON.stringify(kinds));
