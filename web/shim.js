// The group store client of the page, reached through zigs.use(name), when it runs on Cloudflare.
// The server keeps each group in its own store; the page opens one WebSocket per group it uses
// and reads from a local mirror of those groups.
(() => {
  const docs = new Map();
  const listeners = new Set();
  const groups = new Map();   // gid -> { ws, waiting, loaded, ready, resolve, delay }
  let rid = 0;
  const started = Date.now();

  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const lastSeg = (p) => p.split("/").pop();
  const parentOf = (p) => p.split("/").slice(0, -1).join("/");
  const gidOf = (p) => (String(p).match(/^groups\/([0-9a-f]{20})(\/|$)/) || [])[1];
  const docSnap = (path) => {
    const d = docs.get(path);
    return { id: lastSeg(path), exists: d != null, data: () => clone(d), metadata: {} };
  };
  // Calls the listeners that watch `path` (a document, or the collection that holds it). With no
  // path, every listener. `gid` limits a change to one group's listeners and the group list.
  // One failing listener must not stop the others.
  const hears = (l, path, gid) => path == null && gid == null
    || (path != null && (l.path === path || l.path === parentOf(path)))
    || (gid != null && (gidOf(l.path) === gid || !gidOf(l.path)));
  const notify = (path, gid) => {
    for (const l of [...listeners]) {
      if (!hears(l, path, gid)) continue;
      try { l(); } catch (e) { console.error("listener failed for", l.path, e); }
    }
  };

  function join(gid) {
    if (!gid) return null;
    if (groups.has(gid)) return groups.get(gid);
    const g = { ws: null, waiting: new Map(), loaded: false, delay: 1000 };
    g.ready = new Promise((r) => (g.resolve = r));
    groups.set(gid, g);
    open(gid, g);
    return g;
  }

  function open(gid, g) {
    const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws?g=" + gid);
    g.ws = ws;
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "init") {
        for (const p of [...docs.keys()]) if (gidOf(p) === gid) docs.delete(p);
        for (const d of m.docs) docs.set(d.path, d.data);
        g.loaded = true; g.delay = 1000; g.resolve(); notify(null, gid);
      } else if (m.type === "put") {
        if (m.data == null) docs.delete(m.path); else docs.set(m.path, m.data);
        notify(m.path);
      } else if (m.type === "reply") {
        const w = g.waiting.get(m.rid); g.waiting.delete(m.rid);
        if (w) m.ok ? w.res(m.result) : w.rej({ code: m.code, message: m.message });
      }
    };
    // A refused or dropped socket retries with a growing delay, so a busy server is not hammered.
    ws.onclose = () => {
      for (const w of g.waiting.values()) w.rej({ code: "unavailable", message: "connection lost" });
      g.waiting.clear();
      setTimeout(() => open(gid, g), g.delay);
      g.delay = Math.min(g.delay * 2, 30000);
    };
  }

  async function send(msg) {
    const g = join(gidOf(msg.path));
    if (!g) throw { code: "invalid_argument", message: "path outside a group: " + msg.path };
    await g.ready;
    if (g.ws.readyState !== WebSocket.OPEN) throw { code: "unavailable", message: "not connected" };
    const id = ++rid;
    return new Promise((res, rej) => { g.waiting.set(id, { res, rej }); g.ws.send(JSON.stringify({ ...msg, rid: id })); });
  }

  // A group path waits for its group; the top-level "groups" list waits for every joined group
  // (at most 4 s), so the wallet list does not flash empty while sockets open.
  function watch(path, fn) {
    const g = join(gidOf(path));
    const ok = () => g ? g.loaded : [...groups.values()].every((x) => x.loaded) || Date.now() - started > 4000;
    const l = () => { if (ok()) fn(); };
    l.path = path;
    listeners.add(l); l();
    if (!g) setTimeout(l, 4100);
    return () => listeners.delete(l);
  }

  const docRef = (path) => ({
    id: lastSeg(path), path,
    get: async () => { const g = join(gidOf(path)); if (g) await g.ready; return docSnap(path); },
    set: (data) => send({ op: "set", path, data: clone(data) }),
    update: (data) => send({ op: "update", path, data: clone(data) }),
    acquire: (o = {}) => send({ op: "acquire", path, holder: o.holder, ttlMs: o.ttlMs }),
    onSnapshot: (next) => watch(path, () => next(docSnap(path))),
    collection: (sub) => colRef(path + "/" + sub),
  });

  const colRef = (path) => ({
    path,
    doc: (id) => docRef(path + "/" + (id || crypto.randomUUID().replace(/-/g, "").slice(0, 20))),
    onSnapshot: (next) => watch(path, () => {
      const list = [...docs.keys()].filter((p) => parentOf(p) === path).map(docSnap);
      next({ docs: list, size: list.length, empty: list.length === 0 });
    }),
  });

  const db = { collection: colRef, doc: docRef, join: (gid) => { join(gid); } };

  function myId() {
    let id = localStorage.getItem("zf-uid");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("zf-uid", id); }
    return id;
  }

  const user = {
    id: async () => myId(),
    me: async () => ({ id: myId(), name: localStorage.getItem("zf-name") || "" }),
    can: async () => true,
    isOwner: () => false,
    canEdit: () => true,
  };

  const downloads = {
    save: async ({ filename, data }) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
  };

  const caps = { db, user, downloads };
  window.zigs = { use: async (name) => caps[name] || null };
})();
