// Chrome CDP WebAuthn virtual authenticators. No platform or real-user credential is used.
// hasPrf is defined in the local Playwright CDP protocol and the official protocol:
// https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/#type-VirtualAuthenticatorOptions
const authenticators = new WeakMap();
const role = (p, name) => p.getByRole("button", { name, exact: true });
const protectedText = "This browser’s shares are protected by its passkey.";
const currentEntry = process.env.ZIGS_UI_OPTIONAL_PASSKEY === "1"
  || process.env.ZIGS_UI_SECURITY_EXPLAINERS === "1"
  || process.env.ZIGS_UI_ENTRY_FLOW === "1" && process.env.ZIGS_UI_PHASE !== "before";
const continueLabel = currentEntry ? "Continue to approval rule" : "Set up my wallet";

async function replaceAuthenticator(p, prf) {
  const old = authenticators.get(p), cdp = old?.cdp || await p.context().newCDPSession(p);
  if (old) await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: old.id });
  else await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId: id } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    hasPrf: prf,
  } });
  authenticators.set(p, { cdp, id });
}

export async function installAuthenticator(p) { await replaceAuthenticator(p, true); }

async function credentialCounts(p) {
  const { cdp, id } = authenticators.get(p);
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId: id });
  return credentials.map((v) => ({ id: v.credentialId, count: v.signCount }));
}

async function localProtection(p) {
  return p.evaluate(async () => {
    const k = await import("/app-keystore.js"), { state } = await import("/app-state.js");
    return { protected: k.passkeyProtected(), sealed: !!localStorage.getItem("zf-vault"),
      plain: ["zf-secrets", "zf-keys", "zf-chats"].some((key) => !!localStorage.getItem(key)),
      groups: state.groups.length, secrets: Object.keys(k.secrets).length,
      extractable: k.vault?.key?.extractable };
  });
}

async function unchangedBeforeProtection(p, qa, before, label) {
  const after = await localProtection(p);
  qa.check(!after.protected && !after.sealed && after.groups === before.groups
    && after.secrets === before.secrets, label + " creates no vault, wallet or local seat");
  qa.check(await role(p, continueLabel).isDisabled(),
    label + " cannot advance into wallet creation");
}

async function cancelledProtection(p, qa, before) {
  const { cdp, id } = authenticators.get(p);
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", {
    authenticatorId: id, enabled: false,
  });
  await p.evaluate(() => {
    window.__credentialCreate = navigator.credentials.create;
    navigator.credentials.create = (options) => {
      window.__cancelPasskey = new AbortController();
      return window.__credentialCreate.call(navigator.credentials,
        { ...options, signal: window.__cancelPasskey.signal });
    };
  });
  await role(p, "Protect this browser").click();
  await p.getByText(/Protecting this device…/).first().waitFor();
  await qa.capture(p, "27-passkey-pending");
  await p.evaluate(() => window.__cancelPasskey.abort(
    new DOMException("Synthetic platform cancellation", "NotAllowedError")));
  await p.getByText(/Passkey setup was cancelled or timed out/).first().waitFor();
  await unchangedBeforeProtection(p, qa, before, "Cancelled passkey setup");
  await qa.capture(p, "27-passkey-cancelled");
  await p.evaluate(() => { navigator.credentials.create = window.__credentialCreate; });
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", {
    authenticatorId: id, enabled: true,
  });
  await p.locator("#banner-close").click();
}

async function recoveryReachable(p, qa) {
  await role(p, "Save and exit").click();
  const choosing = p.waitForEvent("filechooser");
  await role(p, "Recover access").click();
  const file = await choosing;
  qa.check(!file.isMultiple(), "recovery file chooser remains reachable without a passkey");
  await file.setFiles([]);
  await role(p, "Create wallet").click();
  await p.getByRole("heading", { name: "Protect this browser", exact: true }).waitFor();
}

async function unsupportedPrf(p, qa, before) {
  await replaceAuthenticator(p, false);
  await role(p, "Protect this browser").click();
  await p.getByText(/does not support the PRF extension/).first().waitFor();
  await unchangedBeforeProtection(p, qa, before, "Unsupported PRF");
  await qa.capture(p, "28-passkey-prf-unavailable");
  await p.locator("#banner-close").click();
  await replaceAuthenticator(p, true);
}

async function protectionLayouts(p, qa) {
  for (const width of [320, 390, 768, 1440]) {
    await p.setViewportSize({ width, height: 1000 });
    for (const theme of ["dark", "light"]) {
      await p.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await qa.layout(p, "passkey first " + width + " " + theme);
      await qa.capture(p, "26-passkey-first-" + width + "-" + theme);
    }
  }
  await p.setViewportSize({ width: 320, height: 1000 });
  try { await qa.doubleText(p, "passkey first actual2x320"); }
  finally { await qa.capture(p, "26-passkey-first-2x320"); }
  const protect = role(p, "Protect this browser");
  await protect.evaluate((n) => n.scrollIntoView({ block: "center" }));
  await protect.focus();
  qa.check(await protect.evaluate((n) => {
    const r = n.getBoundingClientRect();
    const bottom = n.closest(".dialog").querySelector(".dialog-actions").getBoundingClientRect();
    return document.activeElement === n && r.top >= 0 && r.bottom <= bottom.top + 1;
  }), "2× text keeps the Protect action reachable above the fixed action bar by internal scroll");
  await qa.capture(p, "26-passkey-first-2x320-action");
  await qa.resetText(p);
  await p.setViewportSize({ width: 390, height: 1000 });
  await p.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await qa.layout(p, "passkey first forced colors");
  await qa.capture(p, "26-passkey-first-forced-colors");
  await p.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
}

async function joinBlocked(p, qa) {
  const buttons = p.getByRole("button", { name: /^Join as device \d+$/ });
  if (!await buttons.count()) return;
  qa.check(await buttons.evaluateAll((ns) => ns.every((n) => n.disabled)),
    "every new-seat Join control is disabled before passkey protection");
}

async function verifiedProtection(p, qa, before) {
  const after = await localProtection(p), creds = await credentialCounts(p);
  qa.check(after.protected && after.sealed && !after.plain && after.extractable === false,
    "actual registration and PRF assertion create a verified sealed vault before wallet/seat");
  qa.check(after.groups === before.groups && after.secrets === before.secrets,
    "passkey protection itself creates no wallet or local seat");
  qa.check(creds.length === 1 && creds[0].count >= 1,
    "virtual credential completes a real WebAuthn assertion after registration");
}

export async function protectBeforeSetup(p, qa, extensive = false) {
  const before = await localProtection(p);
  if (before.protected) return;
  await joinBlocked(p, qa);
  if (extensive) {
    await qa.layout(p, "passkey required before setup");
    await qa.capture(p, "26-passkey-required");
    await protectionLayouts(p, qa);
    await cancelledProtection(p, qa, before);
    await recoveryReachable(p, qa);
    await unsupportedPrf(p, qa, before);
  }
  await role(p, "Protect this browser").click();
  await p.getByText(protectedText, { exact: true }).first().waitFor();
  await verifiedProtection(p, qa, before);
  if (extensive) {
    qa.check(await role(p, continueLabel).isEnabled(),
      "verified passkey protection enables the setup continuation");
    await qa.capture(p, "29-passkey-protected");
  }
  const banner = p.locator("#banner-close");
  if (await banner.isVisible()) await banner.click();
}

export async function unlockIfNeeded(p, check) {
  const locked = await p.evaluate(async () => !!(await import("/app-keystore.js")).lockedVault);
  if (!locked) return;
  const before = await credentialCounts(p);
  await role(p, "Unlock").click();
  await p.waitForFunction(async () => (await import("/app-keystore.js")).passkeyProtected());
  const after = await credentialCounts(p);
  check(after.some((v) => before.some((old) => old.id === v.id && v.count > old.count)),
    "reload unlocks the sealed vault with the same virtual passkey and a fresh PRF assertion");
}

/** A separate empty store exercises Chrome's actual IP-host RP refusal. */
export async function invalidRpAddress(browser, origin, qa) {
  const target = new URL(origin);
  target.hostname = "127.0.0.1";
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 },
    colorScheme: "dark", reducedMotion: "reduce" });
  const errors = [];
  try {
    await context.route("**/*", (r) =>
      ["127.0.0.1", "localhost"].includes(new URL(r.request().url()).hostname)
        ? r.continue() : r.abort());
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.name));
    await installAuthenticator(p);
    await p.goto(target.href);
    await p.waitForFunction(async () => !!(await import("/app-engine.js")).Z);
    await role(p, "Create wallet").click();
    await p.getByRole("heading", { name: "Protect this browser", exact: true }).waitFor();
    const before = await localProtection(p);
    await role(p, "Protect this browser").click();
    const refusal = process.env.ZIGS_UI_OPTIONAL_PASSKEY === "1"
      ? /This site address cannot create a passkey/
      : /This site address cannot create the required passkey/;
    const message = p.getByText(refusal).first();
    await message.waitFor();
    qa.check(/localhost.*Wallet data stays at the browser address/s.test(await message.innerText()),
      "invalid RP address explains localhost and preserves the existing origin's wallet data");
    await unchangedBeforeProtection(p, qa, before, "Actual Chrome IP-host RP refusal");
    qa.check(await p.getByText(protectedText, { exact: true }).count() === 0,
      "invalid RP address never shows a protected badge");
    await qa.layout(p, "invalid RP address");
    await qa.capture(p, "30-passkey-invalid-rp");
    qa.check(errors.length === 0, "invalid RP address is handled without uncaught browser errors");
  } finally { await context.close(); }
}
