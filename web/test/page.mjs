// The page for the tests: app.mjs and sol-rig.mjs load the real page modules through loadPage().
// A test installs its stub page (document, window, localStorage) first. loadPage() imports the
// files that web/app.js lists, in that order, as the browser does; they run depth first along
// their imports, not in list order. It does not import web/app.js itself: that file boots the page.
import fs from "node:fs";
import { proposalFields } from "../signed.js";

// The page names that the tests read, as t.NAME, and the names that this file reads (the
// setters of SETTERS, idb). Each one must stay exported. Another t.NAME throws.
export const NAMES = [
  "accountCard", "accountInbox", "acct", "acctBalance", "act", "addPersonalContact", "addressBlock",
  "addressFor", "adoptPersonal", "applyBackup", "approve", "backupDialog", "backupNote",
  "backupText", "balCache", "banner", "blockTime", "broadcastTx", "busy", "cancelAction",
  "cancelPayment", "canWriteAs", "chain", "changePersonal", "chatRequest", "checkShape",
  "cleanGroup",
  "composer", "confirmedNetwork", "contactDialog", "contactsCard", "contactView",
  "copyFundingRequest", "createGroup",
  "createPersonal", "damagedCard", "deviceRead", "dmChoices", "docMemo", "expired", "expiryLine",
  "expiryAt", "expiryOf", "failSession", "fillFromRequest", "finalizeTx", "finishButtons",
  "flightNow",
  "forgetBox", "fundBlock", "fundFromWallet", "fundingUri", "getIdb", "gkeys", "groupName",
  "groupView", "heldApprovals", "idb", "inbox", "inFlight", "layers", "leaveBox", "localSeats",
  "lockWithPasskey",
  "loggedIgnored", "mainView", "memoBody", "messageWhy", "moveState", "mySeatSecrets",
  "named", "noteSessions",
  "needsMyApproval", "netConfirmed", "newSpend", "nextAction", "openContact", "openContactDialog",
  "openDoc",
  "once", "openGroup", "otherMessages", "persistPersonal", "persistSealed", "personal",
  "personalCard",
  "personalError", "personalPending", "priorityTimes", "proposalFields", "proposeAgain", "proposer",
  "proposeRequest", "proposeWallets", "putSec", "raw", "reactSession", "readsMemos", "ready",
  "recipientCheck", "refilter", "removeAccount", "requestCard", "requestOf", "rereadPersonal",
  "restore", "restoreAccount", "restoredFor", "restoreWatch", "roomRequest", "round3V1", "runMemos",
  "sawSigning",
  "runSync", "safetyNo", "saveAccountBackup", "saveBackup", "sealAndSave", "seatCheck", "seatIds",
  "sec", "secrets", "sendBlocker", "sendDialog", "sendOnChain", "sentStateOf", "sessionLayer",
  "setAcct",
  "setChain", "setDb", "setDownloads", "setGkeys", "setIdb", "setIdbMs", "setLocked", "setMe",
  "setMemoReading", "setPersonal", "setSecrets", "setTabBar", "settleRestore", "setVault", "setZ",
  "showBanner", "signedDoc", "signedMode", "signing", "signPins", "sigPart", "sol", "solError",
  "solLoad", "solLoading", "solOn", "solTab", "staleRestoreNote", "startAccount", "startUp",
  "state", "statusChip",
  "submitMessage", "submitRequest", "tabBar", "takeDeviceAccount", "takeFromTab", "takeSeat",
  "txDetails", "typingMessage", "ui", "unboxFrom", "undoRestore", "unlockVault", "verdict",
  "walletView",
  "wantFocus", "writer",
];

// The tests assign these four names: each goes to the setter of its module.
const SETTERS = { personal: "setPersonal", secrets: "setSecrets", gkeys: "setGkeys",
  tabBar: "setTabBar" };

// The page measures some lifetimes with Date.now(): a nonce proposal lives 120 s (BLOCKHASH_MS,
// web/sol/approve.js). A computer that sleeps during a test run made such a proposal expire at
// random (VEL-4). The test clock leaves out every gap of more than STALL_MS in which no JavaScript
// ran, and every step back of the wall clock. A heartbeat reads it every 200 ms, so a wait counts
// as usual. Timers (setTimeout) still count a stall.
const STALL_MS = 5000;

/**
 * A clock on `wall` that leaves out each gap of more than `stallMs` between two of its reads, and
 * each step back of `wall`.
 * @returns {() => number} a clock that never goes back and never jumps forward by a stall.
 */
export function stallFreeClock(wall, stallMs) {
  let offset = 0, last = wall();
  return () => {
    const now = wall();
    if (now - last > stallMs || now < last) offset += now - last;
    last = now;
    return now - offset;
  };
}

function installTestClock() {
  if (Date.now.stallFree) return;
  Date.now = stallFreeClock(Date.now.bind(Date), STALL_MS);
  Date.now.stallFree = true;
  setInterval(Date.now, 200).unref();
}

/**
 * Installs the test clock, imports the page modules and returns `t`, a live view of the names in
 * NAMES. The modules load once per process: a second call gives a view of the same instances.
 * @returns {Promise<object>} t: t.NAME reads the export now; t.personal = v calls setPersonal.
 */
export async function loadPage() {
  installTestClock();
  const web = new URL("../", import.meta.url);
  const entry = fs.readFileSync(new URL("app.js", web), "utf8");
  const files = [...entry.matchAll(/^import "\.\/([\w-]+\.js)";$/gm)].map((m) => m[1]);
  const owner = new Map();
  for (const f of files) {
    const ns = await import(new URL(f, web).href);
    if (f.startsWith("app-")) for (const k of Object.keys(ns)) owner.set(k, ns);
  }
  // Not page names: an import of the old app.js, and the function binding idb, read now.
  const extra = { proposalFields, getIdb: () => owner.get("idb").idb };
  for (const n of [...NAMES, ...Object.values(SETTERS)]) {
    if (!Object.hasOwn(extra, n) && !owner.has(n)) {
      throw new Error(`page.mjs: no page module exports ${n}`);
    }
  }
  return new Proxy({}, {
    get(_, k) {
      if (typeof k === "symbol" || k === "then") return undefined;
      if (Object.hasOwn(extra, k)) return extra[k];
      if (!NAMES.includes(k)) throw new Error(`t.${k} is not in NAMES of page.mjs`);
      return owner.get(k)[k];
    },
    set(_, k, v) {
      const setter = SETTERS[k];
      if (!setter) throw new Error(`t.${String(k)} cannot be assigned: no setter in page.mjs`);
      owner.get(setter)[setter](v);
      return true;
    },
  });
}
