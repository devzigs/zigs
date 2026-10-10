// The group store client of the page, reached through zigs.use(name), when it runs
// on Cloudflare. The server pushes every document, so reads use a local mirror.
// ponytail: no auth and full-store sync; fine for a proof of concept with few users.
(() => {
  const docs = new Map();
  const listeners = new Set();
  const waiting = new Map();
  let ws = null, rid = 0, loaded = false;
  let readyResolve;
  const ready = new Promise((r) => (readyResolve = r));

  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const lastSeg = (p) => p.split("/").pop();
  const parentOf = (p) => p.split("/").slice(0, -1).join("/");
  const docSnap = (path) => {
    const d = docs.get(path);
    return { id: lastSeg(path), exists: d != null, data: () => clone(d), metadata: {} };
  };
  const notify = () => { for (const l of [...listeners]) l(); };

  function connect() {
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "init") {
        docs.clear();
        for (const d of m.docs) docs.set(d.path, d.data);
        loaded = true; readyResolve(); notify();
      } else if (m.type === "put") {
        if (m.data == null) docs.delete(m.path); else docs.set(m.path, m.data);
        notify();
      } else if (m.type === "reply") {
        const w = waiting.get(m.rid); waiting.delete(m.rid);
        if (w) m.ok ? w.res(m.result) : w.rej({ code: m.code, message: m.message });
      }
    };
    ws.onclose = () => {
      for (const w of waiting.values()) w.rej({ code: "unavailable", message: "connection lost" });
      waiting.clear();
      setTimeout(connect, 1000);
    };
  }

  async function send(msg) {
    await ready;
    if (ws.readyState !== WebSocket.OPEN) throw { code: "unavailable", message: "not connected" };
    const id = ++rid;
    return new Promise((res, rej) => { waiting.set(id, { res, rej }); ws.send(JSON.stringify({ ...msg, rid: id })); });
  }

  function watch(fn) {
    const l = () => { if (loaded) fn(); };
    listeners.add(l); l();
    return () => listeners.delete(l);
  }

  const docRef = (path) => ({
    id: lastSeg(path), path,
    get: async () => { await ready; return docSnap(path); },
    set: (data) => send({ op: "set", path, data: clone(data) }),
    update: (data) => send({ op: "update", path, data: clone(data) }),
    delete: () => send({ op: "delete", path }),
    acquire: (o = {}) => send({ op: "acquire", path, holder: o.holder, ttlMs: o.ttlMs }),
    onSnapshot: (next) => watch(() => next(docSnap(path))),
    collection: (sub) => colRef(path + "/" + sub),
  });

  const colRef = (path) => ({
    path,
    doc: (id) => docRef(path + "/" + (id || crypto.randomUUID().replace(/-/g, "").slice(0, 20))),
    onSnapshot: (next) => watch(() => {
      const list = [...docs.keys()].filter((p) => parentOf(p) === path).map(docSnap);
      next({ docs: list, size: list.length, empty: list.length === 0 });
    }),
  });

  const db = { collection: colRef, doc: docRef };

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
    profiles: async (ids) => {
      await ready;
      return Object.fromEntries(ids.map((id) => [id, { id, name: (docs.get("profiles/" + id) || {}).name || "" }]));
    },
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

  async function ensureName() {
    await ready;
    let name = localStorage.getItem("zf-name");
    if (!name) name = (prompt("Your name (other participants will see it):") || "").trim();
    if (!name) name = "Guest " + myId().slice(0, 4);
    localStorage.setItem("zf-name", name);
    const cur = docs.get("profiles/" + myId());
    if (!cur || cur.name !== name) await send({ op: "set", path: "profiles/" + myId(), data: { name } });
  }

  const caps = { db, user, downloads };
  window.zigs = { use: async (name) => caps[name] || null };
  connect();
  ensureName();
})();
