// Dedicated, bounded, best-effort public-image cache. No wallet storage or raw addresses.
const DB = 'zigs-metal-orb-preview-v1', STORE = 'images', LIMIT = 96;
const memory = new Map();
let connection;
const valid = (value) => typeof value === 'string' && value.startsWith('data:image/png;base64,') && value.length < 180000;
function remember(key, value) {
  memory.delete(key); memory.set(key, value);
  while (memory.size > LIMIT) memory.delete(memory.keys().next().value);
}
function database() {
  if (!connection) connection = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      const timeout = setTimeout(() => resolve(null), 1000);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
      req.onsuccess = () => { clearTimeout(timeout); req.result.onversionchange = () => req.result.close(); resolve(req.result); };
      req.onerror = req.onblocked = () => { clearTimeout(timeout); resolve(null); };
    } catch { resolve(null); }
  });
  return connection;
}
export async function readImage(key) {
  if (memory.has(key)) { const value = memory.get(key); remember(key, value); return value; }
  const db = await database();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE), req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => { const value = req.result?.value; if (valid(value)) { remember(key, value); resolve(value); } else resolve(null); };
      req.onerror = tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
}
export async function writeImage(key, value) {
  if (!valid(value)) return;
  remember(key, value);
  const db = await database();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE);
      store.put({ key, value });
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        const others = keys.result.filter((k) => k !== key);
        while (others.length >= LIMIT) store.delete(others.shift());
      };
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}
export async function clearImages() {
  memory.clear();
  const db = await database();
  if (!db) return;
  await new Promise((resolve) => {
    try { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear();
      tx.oncomplete = tx.onabort = tx.onerror = () => resolve(); } catch { resolve(); }
  });
}
