// The sealed snapshot of the Solana sync (ZOLANA.md 3.6). It has its own IndexedDB database,
// `zigs-sol`, so the version 1 database (app-keystore.js) needs no upgrade. The snapshot is sealed
// with a key from solSeed (`sealKey`, a 32 byte base64url secret of the wasm roles), so the
// database shows no amount. A same-origin Worker can read the database but not the key. Every
// call is in try/catch: a browser without IndexedDB gets no snapshot and the page still works.
const DB = "zigs-sol",
  STORE = "snap";

let opened = null;
function handle() {
  opened ||= new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  }).catch((e) => {
    opened = null;
    throw e;
  });
  return opened;
}

function request(mode, run) {
  return handle().then(
    (db) =>
      new Promise((res, rej) => {
        const tx = db.transaction(STORE, mode),
          req = run(tx.objectStore(STORE));
        tx.oncomplete = () => res(req.result);
        tx.onerror = () => rej(tx.error || new Error("IndexedDB request failed"));
        tx.onabort = () => rej(tx.error || new Error("IndexedDB transaction aborted"));
      }),
  );
}

const context = (gid) => "sol\n" + gid;

/** Seals `snap` (a plain object) and stores it for wallet `gid`. Resolves true when saved. */
export async function saveSnap(Z, sealKey, gid, snap) {
  try {
    const sealed = Z.secretSeal(sealKey, context(gid), JSON.stringify(snap));
    await request("readwrite", (st) => st.put(sealed, gid));
    return true;
  } catch {
    return false;
  }
}

/** The stored snapshot of wallet `gid`, or null when there is none or it does not open. */
export async function loadSnap(Z, sealKey, gid) {
  try {
    const sealed = await request("readonly", (st) => st.get(gid));
    return sealed ? JSON.parse(Z.secretOpen(sealKey, context(gid), sealed)) : null;
  } catch {
    return null;
  }
}
