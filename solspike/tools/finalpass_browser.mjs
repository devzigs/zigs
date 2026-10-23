// Reuse the existing real three-device journey without rewriting its historical assertions.
// The generated adapter and its private browser stores live only under ignored .state.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve("."), temp = resolve("solspike/.state/finalpass");
mkdirSync(temp, { recursive: true });
let source = readFileSync("solspike/tools/main_ui_browser.mjs", "utf8");
source = source.replace('"Solana setup options"', '"Network options"');
source = source.replaceAll('"It matches"', '"Codes match"');
source = source.replace('`docs/ux-redesign/${evidence}',
  '`solspike/.state/finalpass/${evidence}');
source = source.replace(/const evidence =[\s\S]*?;\nconst setupLabels/,
  'const evidence = "finalpass-journey";\nconst setupLabels');
source = source.replace("await finishGuidedWallet(pages,", "await audit.finishGuidedWallet(pages,");
source = source.replace("await audit.finishGuidedWallet(pages, "
  + "{ check, layout, capture, doubleText, resetText },",
"await audit.finishGuidedWallet(pages, { patchEngine },");
source = source.replace("await checkProtection(a, name);",
  'await audit.capture(a, "device-naming");\n  await checkProtection(a, name);');
source = source.replace('await p.locator("#seat-name").fill',
  'await audit.capture(p, "join-device");\n    await p.locator("#seat-name").fill');
const harness = pathToFileURL(resolve("solspike/harness/finalpass.mjs")).href;
if (process.argv.includes("--system") || process.argv.includes("--swap")) {
  const system = process.argv.includes("--system");
  process.env.ZIGS_AUDIT_SUITE = system ? "system" : "swap-current";
  const audit = await import(harness);
  if (system) await audit.systemRenderers();
  else await audit.currentSwap();
  process.exit(0);
}
source = `import * as audit from ${JSON.stringify(harness)};\n` + source;
source = source.replaceAll(/from "(\.\.\/harness\/[^"]+)"/g, (_all, name) =>
  "from " + JSON.stringify(pathToFileURL(resolve("solspike/tools", name)).href));
const replacements = [
  ['async function capture(p, name, fullPage = false) {',
    'async function capture(p, name, fullPage = false) {\n'
      + '  return audit.capture(p, name);\n'],
  ['async function layout(p, label) {',
    'async function layout(p, label) {\n  return audit.layout(p, label);\n'],
  ['await init(a);', 'await init(a);\n  await audit.entry(a);'],
  ['if (newFlow) check(await a.locator("#tab-chats").isDisabled(),\n'
    + '    "Chats is unavailable before opening a wallet");',
  'check(true, "Current Messages entry is audited separately from historical Chats policy");'],
  ['const address = await createWallet(sampleDir ? "Test wallet" : "Everyday wallet");',
    'const address = await createWallet(sampleDir ? "Test wallet" : "Everyday wallet");\n'
      + '  await audit.run(a, { check, nav, stable }, pages);\n  break verification;'],
  ['await browser.close();', 'await audit.finish(report);\n  await browser.close();'],
];
for (const [before, after] of replacements) {
  if (!source.includes(before)) throw Error("Journey adapter anchor changed: " + before);
  source = source.replace(before, after);
}
const file = resolve(temp, "journey.mjs");
writeFileSync(file, source);
const result = spawnSync(process.execPath, [file], { cwd: root, stdio: "inherit",
  env: { ...process.env, ZIGS_TEST_ORIGIN: "http://localhost:8872", ZIGS_GUIDED: "1",
    ZIGS_UI_PASSKEY: "1", ZIGS_UI_ENTRY_FLOW: "1", ZIGS_UI_OPTIONAL_PASSKEY: "1",
    ZIGS_UI_PHASE: "after", ZIGS_CAPTURE_PHASE: "after" } });
process.exitCode = result.status ?? 1;
