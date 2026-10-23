// Device-private payment destinations. No amounts, memos, resolved names or wallet secrets.
// Keep this eager module independent of /sol: servers with Solana disabled do not serve that
// path. These format checks match Send; actual payment validation remains in the existing rail.
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const publicSolAddress = (address) => {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false;
  let n = 0n;
  for (const ch of address) n = n * 58n + BigInt(BASE58.indexOf(ch));
  const body = n === 0n ? "" : n.toString(16);
  return /^1*/.exec(address)[0].length + Math.ceil(body.length / 2) === 32;
};
export const shieldedSolAddress = (address) => /^[0-9a-f]{198}$/.test(address);

export const emptyRecipients = () => ({ version: 1, entries: [] });
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max
  && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const fields = ["id", "name", "address", "asset", "network", "type"];
export const recipientKind = (v) => v.asset === "ZEC"
  ? v.type === "shielded" && ["testnet", "mainnet"].includes(v.network)
  : v.asset === "SOL" && v.network === "devnet" && ["shielded", "public"].includes(v.type);

/** A strict versioned record. Unknown/damaged records must be kept, never replaced by empty. */
export function readRecipients(value) {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.entries)
    || value.entries.length > 500 || Object.keys(value).some((k) => !["version", "entries"].includes(k))) {
    throw new Error("The saved address book cannot be read. Its stored copy has been kept.");
  }
  const ids = new Set();
  for (const r of value.entries) {
    if (!object(r) || Object.keys(r).some((k) => !fields.includes(k))
      || !/^[0-9a-f]{32}$/.test(r.id) || ids.has(r.id) || !text(r.name, 80)
      || !text(r.address, 2048) || !recipientKind(r)) {
      throw new Error("The saved address book cannot be read. Its stored copy has been kept.");
    }
    ids.add(r.id);
  }
  return { version: 1, entries: value.entries.map((r) => ({ ...r })) };
}

/** Check an address using the same formats as Send. This does not verify ownership. */
export function checkedRecipient(value, normalizeZec) {
  const name = String(value.name ?? "").trim();
  let address = String(value.address ?? "").trim();
  const { asset, network, type } = value;
  if (!text(name, 80)) throw new Error("Enter a recipient name of at most 80 characters.");
  if (!recipientKind({ asset, network, type })) throw new Error("Choose a supported destination.");
  if (!text(address, 2048)) throw new Error("Enter the full recipient address.");
  if (asset === "ZEC") {
    let normalized = null;
    try { normalized = normalizeZec(address); } catch { /* the Send validator refused it */ }
    if (!normalized?.startsWith(network === "testnet" ? "utest1" : "u1")) {
      throw new Error("Enter a shielded Zcash " + network + " address, not a name or request.");
    }
    address = normalized;
  } else if (type === "public") {
    if (!publicSolAddress(address)) throw new Error("Enter a public Solana address for withdrawals.");
  } else {
    address = address.toLowerCase();
    if (!shieldedSolAddress(address)) throw new Error("Enter the full shielded Solana address (99 bytes).");
  }
  return { name, address, asset, network, type };
}

export const matchingRecipients = (book, filter = {}, search = "") => {
  const query = search.trim().toLowerCase();
  return book.entries.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v)
    && (!query || [r.name, r.address, r.asset, r.network, r.type]
      .some((s) => s.toLowerCase().includes(query))))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
};

/** An edit/delete must still refer to exactly the entry that the person saw. */
export function changeRecipient(book, previous, next, id) {
  const copy = readRecipients(book), at = previous ? copy.entries.findIndex((r) => r.id === previous.id) : -1;
  if (previous && (at < 0 || fields.some((k) => copy.entries[at][k] !== previous[k]))) {
    throw new Error("This recipient changed in another tab. Reopen it before editing or deleting.");
  }
  if (!next) {
    if (!previous) throw new Error("Choose a recipient to delete.");
    copy.entries.splice(at, 1);
  } else {
    if (copy.entries.some((r) => r.id !== previous?.id && r.asset === next.asset
      && r.network === next.network && r.type === next.type && r.address === next.address)) {
      throw new Error("This destination is already in the address book.");
    }
    if (previous) copy.entries[at] = { id: previous.id, ...next };
    else {
      if (copy.entries.length >= 500) throw new Error("This device can save up to 500 recipients.");
      copy.entries.push({ id, ...next });
    }
  }
  return readRecipients(copy);
}
