// Unfunded browser checks for the guided journey, using real encrypted downloads.
const PASSPHRASE = "synthetic local recovery check 4728 only";
const role = (p, name) => p.getByRole("button", { name, exact: true });

async function shareDigest(p) {
  return p.evaluate(async () => {
    const { state } = await import("/app-state.js");
    const { localSeats } = await import("/app-seats.js");
    const { sec } = await import("/app-keystore.js");
    const text = JSON.stringify(sec(state.gid, localSeats()[0]));
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
  });
}

async function saveFile(p) {
  await role(p, "Save ZEC backup").click();
  await p.locator("#bk-pass").fill(PASSPHRASE);
  await p.locator("#bk-again").fill(PASSPHRASE);
  const download = p.waitForEvent("download");
  await role(p, "Encrypt and save").click();
  const file = await download;
  await p.getByRole("dialog").waitFor({ state: "hidden" });
  return file.path();
}

async function checkFile(p, path, passphrase) {
  await p.locator("#bc-file").setInputFiles(path);
  await p.locator("#bc-pass").fill(passphrase);
  await role(p, "Check saved file").click();
}

async function reopenFile(p, path, check, wrongPassword) {
  await optionalChecks(p);
  await role(p, "Check saved ZEC file").click();
  const before = await shareDigest(p);
  if (wrongPassword) {
    await checkFile(p, path, "wrong synthetic recovery passphrase");
    await p.getByRole("alert").filter({ hasText: "could not be opened" }).waitFor();
    check(before === await shareDigest(p), "wrong passphrase leaves the share unchanged");
  }
  await checkFile(p, path, PASSPHRASE);
  await p.getByRole("dialog").waitFor({ state: "hidden" });
  check(before === await shareDigest(p), "reopening a saved file never restores or changes shares");
}

async function optionalChecks(p) {
  const summary = p.getByText("Optional: check saved files", { exact: true }).first();
  await summary.waitFor();
  if (!await role(p, "Check saved ZEC file").first().isVisible()) {
    await summary.click();
  }
}

async function openRecoveryGuide(p) {
  const previous = role(p, "Review recovery progress");
  if (await previous.isVisible()) { await previous.click(); return; }
  await role(p, "Review Security").click();
  await p.locator("#panel-recovery").waitFor();
  await p.locator("#security-files>summary").click();
  await role(p, "Open recovery guide").click();
  await p.getByRole("heading", { name: /^Your wallet is (?:ready|prepared)$/ }).waitFor();
}

async function verifyPause(p, qa) {
  const { check, layout, capture } = qa;
  await layout(p, "guided backup screen");
  await capture(p, "17-guided-backups", true);
  check(await role(p, "Open Overview").isEnabled(),
    "verified formation permits Overview with zero backup files");
  await role(p, "Save and exit").click();
  const picker = p.locator("#welcome-wallets > summary");
  if (await picker.count()) await picker.press("Enter");
  await p.getByText("Setup unfinished", { exact: true }).first().waitFor();
  await p.locator("[data-key^=wallet-row-]").first().click();
  await p.getByRole("heading", { name: /^Your wallet is (?:ready|prepared)$/ }).waitFor();
  check(true, "Save and exit resumes the next verified stage");
}

async function backupLayouts(p, qa) {
  for (const width of [320, 390, 768, 1440]) {
    await p.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await p.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await qa.layout(p, "guided backups " + width + " " + theme);
      await qa.capture(p, "17-guided-backups-" + width + "-" + theme);
    }
  }
  await p.setViewportSize({ width: 320, height: 1000 });
  await qa.doubleText(p, "guided backups actual2x320");
  await qa.capture(p, "17-guided-backups-2x-320");
  await qa.resetText(p);
  await p.setViewportSize({ width: 390, height: 1000 });
}

async function localCompletion(p, qa, extensive) {
  const { check, capture } = qa;
  await role(p, "Open Overview").click();
  await p.getByText(/Device backups · Zcash 0 of 3/).waitFor();
  check(true, "zero backups do not block opening Overview");
  await openRecoveryGuide(p);
  const path = await saveFile(p);
  check(await role(p, "Open Overview").isEnabled(), "a download needs no reupload to continue");
  if (extensive) {
    await p.locator("#banner-close").click();
    await capture(p, "18-guided-local-ready", true);
  }
  await role(p, "Open Overview").click();
  await p.getByRole("heading", { name: "Your assets", exact: true }).waitFor();
  await p.getByText(/Device backups · Zcash 1 of 3/).waitFor();
  check(true, "one download is counted as partial progress without claiming full recovery");
  if (extensive) {
    await openRecoveryGuide(p);
    await reopenFile(p, path, check, true);
    await p.locator("#banner-close").click();
    await role(p, "Open Overview").click();
  }
  return path;
}

/** Simulates the platform prompt only; successful hardware authentication is not claimed. */
export async function protectionFallback(p, qa) {
  await p.evaluate(() => {
    window.__publicKeyBefore = window.PublicKeyCredential;
    window.__createBefore = navigator.credentials.create;
    window.PublicKeyCredential = undefined;
  });
  await p.evaluate(async () => (await import("/app-loop.js")).render());
  await p.getByText(/This browser does not support the required passkey protection/).waitFor();
  qa.check(await role(p, "Protect this device").isDisabled(),
    "unsupported passkeys have a distinct explanation and disabled protection action");
  await p.evaluate(() => { window.PublicKeyCredential = window.__publicKeyBefore; });
  await p.evaluate(async () => (await import("/app-loop.js")).render());
  await p.getByText(/Use the existing passkey lock for the shares in this browser/).waitFor();
  await p.evaluate(() => {
    navigator.credentials.create = () => new Promise((_resolve, reject) => {
      window.__rejectProtection = () => reject(new DOMException("Synthetic cancellation",
        "NotAllowedError"));
    });
  });
  await role(p, "Protect this device").click();
  await p.getByText("Protecting this device… Wait while the encrypted copy is checked.")
    .waitFor();
  qa.check(await p.getByText("This browser’s shares are protected by its passkey.").count() === 0,
    "pending protection never displays a protected badge");
  await p.evaluate(() => window.__rejectProtection());
  await p.getByText(/Passkey setup was cancelled or timed out/).first().waitFor();
  qa.check(await p.evaluate(async () => !(await import("/app-keystore.js")).vault),
    "cancelled passkeys keep the browser unprotected and preserve the supported fallback");
  await p.locator("#banner-close").click();
  await p.evaluate(() => { navigator.credentials.create = window.__createBefore; });
}

/** Display intent cannot opt into a chain or bypass an unavailable service. */
export async function unavailableService(p, qa) {
  const before = await shareDigest(p);
  await p.context().route("**/sol/config.json", (r) => r.fulfill({
    status: 503, contentType: "application/json", body: "{}",
  }));
  await p.evaluate(async () => {
    const { state, ui } = await import("/app-state.js");
    const m = await import("/app-guided-setup.js");
    m.beginGuided(state.gid, { solExpected: true });
    m.reviewGuided(null);
    ui.tab = "overview";
  });
  await p.reload();
  await qa.patchEngine(p);
  await p.getByText("Solana setup is waiting for service availability. "
    + "Your Zcash setup is saved.", { exact: true }).first().waitFor();
  await role(p, "Save ZEC backup").waitFor();
  await optionalChecks(p);
  await role(p, "Check saved ZEC file").waitFor();
  qa.check(await role(p, "Save ZEC backup").isVisible()
    && await role(p, "Check saved ZEC file").isVisible(),
  "unavailable Solana leaves existing Zcash backups accessible");
  qa.check(before === await shareDigest(p), "service retry keeps the existing Zcash share");
  qa.check(await p.evaluate(async () => {
    const { sol, solPlanned } = await import("/app-sol.js");
    return !sol && !solPlanned();
  }), "tutorial intent does not create a Solana wallet or grant consent");
  await qa.layout(p, "unavailable Solana preparation");
  await qa.capture(p, "19-guided-service-unavailable");
}

async function wrongSeat(p, path, check) {
  await optionalChecks(p);
  await role(p, "Check saved ZEC file").click();
  const before = await shareDigest(p);
  await checkFile(p, path, PASSPHRASE);
  await p.getByRole("alert").filter({ hasText: "not the saved recovery file" }).waitFor();
  check(before === await shareDigest(p), "another device's file is rejected without overwriting");
  await role(p, "Cancel").click();
}

async function reportDiagnostic(p) {
  return p.evaluate(async () => {
    const m = await import("/app-guided-setup.js");
    const f = m.guidedState();
    return { backups: f.backups, reportIssue: f.reportIssue, local: f.localSeats,
      reports: m.setupReports() };
  });
}

/** The same three browser stores that formed the wallet check their separate files. */
export async function finishGuidedWallet(pages, qa, extensive) {
  const [first, second, reserve] = pages;
  for (const p of pages) {
    await p.getByRole("heading", { name: /^Your wallet is (?:ready|prepared)$/ })
      .waitFor({ timeout: 90000 });
    qa.check(await p.locator(".asset-card").count() === 0,
      "formation shows the optional recovery summary before Overview");
  }
  if (extensive) {
    await backupLayouts(first, qa);
    await verifyPause(first, qa);
  }
  const firstFile = await localCompletion(first, qa, extensive);
  if (extensive) await wrongSeat(second, firstFile, qa.check);
  await saveFile(second);
  await role(second, "Open Overview").click();
  await role(reserve, "Open Overview").click();
  try {
    await first.getByText(/Device backups · Zcash 2 of 3/).waitFor();
  } catch (error) {
    throw new Error("Backup report propagation: "
      + JSON.stringify(await Promise.all(pages.map(reportDiagnostic))), { cause: error });
  }
  qa.check(true, "signed saved-only reports update Overview while one device skips backups");
}
