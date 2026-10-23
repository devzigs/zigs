// Private presentation notes. Never part of a wallet document, key share or recovery file.
const PREFIX = "zf-wallet-description:";
const validId = (id) => typeof id === "string" && /^[0-9a-f]{20}$/.test(id);
const valid = (r) => r && r.v === 1 && typeof r.text === "string" && r.text.length <= 280
  && Object.keys(r).length === 2;
const ISSUE = "This browser could not read its private wallet description. The saved copy is kept.";
export function descriptionOf(gid) {
  if (!validId(gid)) return { text: "", error: "" };
  try {
    const raw = localStorage.getItem(PREFIX + gid);
    if (raw === null) return { text: "", error: "" };
    const r = JSON.parse(raw);
    return valid(r) ? { text: r.text, error: "" } : { text: "", error: ISSUE };
  } catch { return { text: "", error: ISSUE }; }
}
export function setWalletDescription(gid, text) {
  if (!validId(gid)) throw new Error("Open a wallet before saving its description.");
  if (typeof text !== "string" || text.length > 280) {
    throw new Error("Use at most 280 characters for the wallet description.");
  }
  if (descriptionOf(gid).error) throw new Error(ISSUE);
  const value = JSON.stringify({ v: 1, text: text.trim() });
  try {
    localStorage.setItem(PREFIX + gid, value);
    if (localStorage.getItem(PREFIX + gid) !== value) throw new Error();
  } catch {
    throw new Error("This browser could not save the description. "
      + "Your wallet and keys are unchanged.");
  }
}
