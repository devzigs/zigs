// Additional real-renderer coverage in the existing isolated, unfunded wallet journey.
const THEMES = ["light", "dark"];
const WIDTHS = [320, 390, 1440];

async function matrix(page, qa, name) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    for (const theme of THEMES) {
      await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
      await qa.stable(page);
      await qa.layout(page, "v3 " + name + " " + width + " " + theme);
      await qa.capture(page, "53-" + name + "-" + width + "-" + theme);
    }
  }
}

async function show(page, kind) {
  return page.evaluate(async (value) => {
    const { ui } = await import("/app-state.js");
    const backup = await import("/app-backups.js");
    if (value === "backup") backup.openBackup(1);
    if (value === "backup-check") backup.openBackupCheck(1, "zec");
    if (value === "restore")
      ui.restore = { name: "Synthetic recovery file", text: "", busy: false };
    if (value === "new-chat") ui.newChat = true;
    if (value === "replace") ui.move = true;
    (await import("/app-loop.js")).render();
  }, kind);
}

async function dialog(page, qa, kind) {
  await show(page, kind);
  await page.getByRole("dialog").waitFor();
  await matrix(page, qa, kind);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  qa.check(await page.evaluate(async () => {
    const { ui } = await import("/app-state.js");
    return !ui.backup && !ui.restore && !ui.newChat && !ui.move;
  }), "v3 " + kind + " keeps existing Escape dismissal");
}

export async function v3Surfaces(page, qa) {
  const before = await page.evaluate(async () => {
    const { state } = await import("/app-state.js");
    return { gid: state.gid, wallet: JSON.stringify(state.wallet), groups: state.groups.length };
  });
  await qa.nav(page, "overview");
  for (const kind of ["backup", "backup-check", "restore", "new-chat", "replace"])
    await dialog(page, qa, kind);
  await page.evaluate(async () => {
    (await import("/app-state.js")).ui.tab = "members";
    (await import("/app-loop.js")).render();
  });
  await qa.stable(page);
  await matrix(page, qa, "devices");
  await qa.nav(page, "overview");
  qa.check(await page.evaluate(async (old) => {
    const { state } = await import("/app-state.js");
    return state.gid === old.gid && JSON.stringify(state.wallet) === old.wallet
      && state.groups.length === old.groups;
  }, before), "v3 additional surfaces do not create, restore or change the wallet");
  await page.setViewportSize({ width: 1440, height: 900 });
}
