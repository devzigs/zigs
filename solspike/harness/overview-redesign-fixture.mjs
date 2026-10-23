// Isolated renderer fixture: no wallet boot, keys, funds, writes or external requests.
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";

export const OVERVIEW_ORIGIN = "http://127.0.0.1:55846";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const solFixture = (
  "\nexport function overviewFixtureSol(mode = 'synced') "
  + "{\n  collections=[]; setupSummary=()=>({status:'ready'})"
  + "; pendingCount=()=>0;\n  pendingRows=()=>[]; "
  + "loadingCount=()=>0; olderCount=()=>0; "
  + "activityRows=()=>[];\n  activityWaits=()=>false;\n  "
  + "sol={ctl:{gid:state.gid,loaded:{},wait:0,sync:{\n    "
  + "balance:mode==='unsynced'?null:'0 SOL',\n    "
  + "text:mode==='stale'?'failed: synthetic "
  + "offline':'',busy:mode==='resync'}},observe(){},close(){"
  + "}};\n}\n"
);

function fixtureModule(relative, content) {
  if (relative === "app.js") return "// Isolated fixture; no wallet boot.";
  if (relative === "network-privacy-demo-entry.js") return content.replace(
    "installPrivacyPopup();", "installPrivacyPopup({ autoOpen: false });");
  if (relative === "app-sol.js") return content + solFixture;
  if (relative === "app-groups.js") return content.replace("dbReady = false;", "dbReady = true;");
  if (relative === "app-loop.js") return content.replace(
    "if (!dbReady) return loadingView();", "if (!dbReady && !state.g) return loadingView();");
  if (relative === "app-wallet.js") return content + "\nexport { balanceOverview };";
  return content;
}

export async function overviewFixture(context, page) {
  const web = resolve("web");
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== OVERVIEW_ORIGIN) return route.abort();
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = resolve(web, relative);
    if (!file.startsWith(web + "/") || !existsSync(file))
      return route.fulfill({ status: 404, body: "" });
    const bytes = readFileSync(file);
    const body = relative.endsWith(".js") ? fixtureModule(relative, bytes.toString()) : bytes;
    return route.fulfill({ body, contentType: types[extname(file)] || "application/octet-stream" });
  });
  await page.goto(OVERVIEW_ORIGIN);
  await page.evaluate(async () => {
    const { state, ui } = await import("/app-state.js");
    const { signPins } = await import("/app-filter.js");
    const chain = await import("/app-chain.js");
    const g = { id: "ab".repeat(10), name: "Everyday wallet", n: 3, t: 2,
      version: 3, network: "testnet" };
    Object.assign(state, { g, gid: g.id, groups: [g, { ...g, id: "ac".repeat(10),
      name: "Travel wallet" }], seats: { 1: { name: "Phone" }, 2: { name: "Laptop" },
      3: { name: "Reserve" } }, seatsLoaded: true, seatsSettled: true,
    sessionsLoaded: true, sessionsSettled: true, sessionsFailed: false, sessions: [],
    wallet: { address: "utest1" + "q".repeat(180), birthday: 4528000 }, pending: false });
    signPins["version:" + g.id] = "3";
    signPins["confirmednet:" + g.id] = "testnet";
    ui.tab = "overview";
    ui.overviewActivity = "pending";
    chain.setChain({ gid: g.id, birthday: 4528000, cw: { free() {} }, bal: { spendable: 0,
      pending: 0,
      height: 4528665, tip: 4528665 }, sent: new Set(), received: [] });
    await (await import("/app-sol.js")).overviewFixtureSol();
    (await import("/app-loop.js")).draw();
    document.getElementById("engine-dot").className = "dot ok";
    document.getElementById("engine-text").textContent = "Crypto engine ready (WebAssembly)";
  });
}

export async function settleOverview(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}
