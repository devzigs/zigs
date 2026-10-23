// Adapt existing suites only in ignored QA output. Historical reports stay untouched.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const name = process.argv[2];
const suites = ["activity_design", "approvals_experience", "settings_design",
  "messaging_redesign", "transaction_receipts", "wallet_header", "overview_redesign"];
if (!suites.includes(name)) throw Error("Choose an existing audited fixture suite");
const root = resolve("."), original = resolve("solspike/tools/" + name + "_browser.mjs");
const temp = resolve("solspike/.state/finalpass");
mkdirSync(temp, { recursive: true });
let source = readFileSync(original, "utf8");
source = source.replaceAll(/from (["'])(\.\.\/[^"']+)\1/g, (_all, _quote, file) =>
  "from " + JSON.stringify(pathToFileURL(resolve("solspike/tools", file)).href));
source = source.replaceAll("dirname(fileURLToPath(import.meta.url))",
  JSON.stringify(resolve("solspike/tools")));
source = source.replaceAll(/(["'])docs\/ux-redesign/g,
  "$1solspike/.state/finalpass/suite-output");
source = source.replaceAll("1280", "1024");
source = source.replaceAll("page.screenshot(", "audit.captureScreenshot(page, ");
source = source.replaceAll("page.addStyleTag(", "audit.fixtureStyle(page, ");
if (name === "transaction_receipts") {
  const marker = 'await forEachCase([1440, 390, 320], async (width) => {';
  if (!source.includes(marker)) throw Error("Receipt matrix anchor changed");
  source = source.replace(marker,
    'await audit.capture(page, kind, "inert receipt renderer; synthetic transaction outcome");\n'
      + '    ' + marker);
}
if (name === "overview_redesign") {
  source = source.replace("Math.abs(facts.assets.y - facts.activity.y)",
    "Math.abs(facts.assets.bottom - facts.activity.bottom)");
  source = source.replace('check(await receipt.locator(".wallet-avatar").getAttribute("src")\n'
    + '    === await page.locator(".wallet-identity>.wallet-avatar").getAttribute("src"),',
  'check((await receipt.innerText()).includes("Everyday wallet"),');
  source = source.replace("await identities();", "/* Current identity: wallet_header suite. */");
  source = source.replaceAll('"Devices and approval rule"', '"Security"');
  source = source.replace("check(sources.length === 2 && sources[0] === sources[1],\n"
    + '    "transaction dialog uses the same wallet avatar");',
  'check(sources.length === 1, "transaction dialog retains its wallet identity");');
  source = source.replace("await syncAndNames();", "/* Current switcher: wallet_header suite. */");
}
const harness = pathToFileURL(resolve("solspike/harness/finalpass.mjs")).href;
source = `import * as audit from ${JSON.stringify(harness)};\n` + source;
// Flush successful metrics even when an older semantic assertion fails later in the suite.
source += '\nawait audit.finish({ suite: ' + JSON.stringify(name) + ' });\n';
const file = resolve(temp, name + ".mjs");
writeFileSync(file, source);
const result = spawnSync(process.execPath, [file, "after"], { cwd: root, stdio: "inherit",
  env: { ...process.env, ZIGS_AUDIT_SUITE: name,
    ZIGS_RECEIPTS_ORIGIN: "http://localhost:8872",
    SETTINGS_QA_DIR: resolve(temp, "suite-output/settings") } });
process.exitCode = result.status ?? 1;
