// The group store client of the page, reached through zigs.use(name).
// The server keeps each group in its own store; the page opens one WebSocket per group it uses
// and reads from a local mirror of those groups.
(() => {
  const docs = new Map();
  const listeners = new Set();
  const groups = new Map();   // gid -> { ws, waiting, open, loaded, failed, retryAt, ready, ... }
  const linkFns = new Set();
  let rid = 0;
  let probe = { at: 0, code: null };   // the last check of a refused socket (probeRefusal)
  const CONNECT_MS = 10000, SEND_MS = 10000, PROBE_MS = 30000;
  const NO_ANSWER = { code: "unavailable",
    message: "The group server did not answer. Check your connection, then try again." };

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

  // The state of the link to the group server: "idle" (no group joined yet), "connecting",
  // "open" (every socket), or "retrying" (some socket is closed). retryAt: the time of the next
  // try. code: the HTTP status of the last refusal (0: no network), or null when it is not known;
  // it is one value for the page, because every socket goes to the same server. groups: for each
  // group, open, loaded, failed (it failed before it loaded, and has not loaded since) and retryAt.
  function linkState() {
    const all = [...groups.values()], late = all.filter((g) => g.retryAt);
    const state = !all.length ? "idle" : late.length ? "retrying"
      : all.every((g) => g.open) ? "open" : "connecting";
    const retryAt = late.length ? Math.min(...late.map((g) => g.retryAt)) : 0;
    const each = [...groups].map(([gid, g]) => [gid, { open: g.open, loaded: g.loaded,
      failed: g.failed, retryAt: g.retryAt }]);
    const code = late.length ? probe.code : null;
    return { state, retryAt, code, groups: Object.fromEntries(each) };
  }
  const linkChanged = () => {
    const s = linkState();
    for (const fn of [...linkFns]) {
      try { fn(s); } catch (e) { console.error("link listener failed", e); }
    }
  };

  // A browser does not tell the page why a server refused a socket. One plain request to the same
  // address shows the HTTP status (401: the password, 429: the limit for each network). It counts
  // against that limit too, so it runs at most once in PROBE_MS for the page.
  // A changed password can make the browser ask for it again.
  function probeRefusal(gid) {
    if (Date.now() - probe.at < PROBE_MS) return;
    probe.at = Date.now();
    fetch(wsUrl(gid, "http"), { cache: "no-store" }).then((r) => r.status, () => 0).then((code) => {
      // 426: the server would take a socket. An answer after every socket opened again is old.
      const late = [...groups.values()].some((g) => g.retryAt);
      probe.code = code === 426 || !late ? null : code;
      linkChanged();
    });
  }
  const wsUrl = (gid, scheme) => (location.protocol === "https:" ? scheme + "s://" : scheme + "://")
    + location.host + "/ws?g=" + gid;

  // The first failure of a group that never loaded: the wallet list stops waiting for it, and each
  // watcher of the group or of the list hears it, at most once for each watcher.
  function firstFailure(gid, g) {
    g.failed = true;
    notify(null, gid);
    for (const l of [...listeners]) {
      if (!l.onError || l.told || (gidOf(l.path) && gidOf(l.path) !== gid)) continue;
      l.told = true;
      try { l.onError(NO_ANSWER); } catch (e) { console.error("error callback failed", e); }
    }
  }

  function join(gid) {
    if (!gid) return null;
    if (groups.has(gid)) return groups.get(gid);
    const g = { ws: null, waiting: new Map(), open: false, loaded: false, failed: false, retryAt: 0,
      delay: 1000 };
    g.ready = new Promise((r) => (g.resolve = r));
    groups.set(gid, g);
    open(gid, g);
    linkChanged();
    return g;
  }

  function open(gid, g) {
    const ws = new WebSocket(wsUrl(gid, "ws"));
    g.ws = ws;
    let opened = false;
    // A socket that hangs while it connects counts as refused.
    const hang = setTimeout(() => ws.readyState === WebSocket.CONNECTING && ws.close(), CONNECT_MS);
    ws.onopen = () => {
      clearTimeout(hang);
      opened = g.open = true;
      g.retryAt = 0;
      probe.code = null;   // the server takes sockets again
      linkChanged();
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "init") {
        for (const p of [...docs.keys()]) if (gidOf(p) === gid) docs.delete(p);
        for (const d of m.docs) docs.set(d.path, d.data);
        g.loaded = true; g.failed = false; g.delay = 1000; g.resolve(); notify(null, gid);
        linkChanged();
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
      clearTimeout(hang);
      for (const w of g.waiting.values()) w.rej({ code: "unavailable", message: "connection lost" });
      g.waiting.clear();
      g.open = false;
      g.retryAt = Date.now() + g.delay;
      setTimeout(() => open(gid, g), g.delay);
      g.delay = Math.min(g.delay * 2, 30000);
      if (!opened) probeRefusal(gid);
      if (!g.loaded && !g.failed) firstFailure(gid, g);
      linkChanged();
    };
  }

  // A write that gets no answer in SEND_MS fails. A write that was not sent yet is never sent
  // after that; one that was sent can still reach the server.
  async function send(msg) {
    const g = join(gidOf(msg.path));
    if (!g) throw { code: "invalid_argument", message: "path outside a group: " + msg.path };
    const id = ++rid, late = { yes: false };
    let timer;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => { late.yes = true; g.waiting.delete(id); rej(NO_ANSWER); }, SEND_MS);
    });
    try { return await Promise.race([deliver(g, msg, id, late), timeout]); }
    finally { clearTimeout(timer); }
  }
  async function deliver(g, msg, id, late) {
    await g.ready;
    if (late.yes) return undefined;
    if (g.ws.readyState !== WebSocket.OPEN) throw { code: "unavailable", message: "not connected" };
    return new Promise((res, rej) => {
      g.waiting.set(id, { res, rej });
      g.ws.send(JSON.stringify({ ...msg, rid: id }));
    });
  }

  // A group path waits for its group. The top-level "groups" list waits until each joined group
  // loaded or failed once, so the wallet list does not show empty while sockets open.
  function watch(path, fn, onError) {
    const g = join(gidOf(path));
    const ok = () => g ? g.loaded : [...groups.values()].every((x) => x.loaded || x.failed);
    const l = () => { if (ok()) fn(); };
    l.path = path;
    l.onError = typeof onError === "function" ? onError : null;
    listeners.add(l); l();
    return () => listeners.delete(l);
  }

  const docRef = (path) => ({
    id: lastSeg(path), path,
    get: async () => { const g = join(gidOf(path)); if (g) await g.ready; return docSnap(path); },
    set: (data) => send({ op: "set", path, data: clone(data) }),
    update: (data) => send({ op: "update", path, data: clone(data) }),
    acquire: (o = {}) => send({ op: "acquire", path, holder: o.holder, ttlMs: o.ttlMs }),
    onSnapshot: (next, onError) => watch(path, () => next(docSnap(path)), onError),
    collection: (sub) => colRef(path + "/" + sub),
  });

  const colRef = (path) => ({
    path,
    doc: (id) => docRef(path + "/" + (id || crypto.randomUUID().replace(/-/g, "").slice(0, 20))),
    onSnapshot: (next, onError) => watch(path, () => {
      const list = [...docs.keys()].filter((p) => parentOf(p) === path).map(docSnap);
      next({ docs: list, size: list.length, empty: list.length === 0 });
    }, onError),
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

  // The page reads the link state with now(), or hears each change with watch(fn), which calls fn
  // at once and returns the stop function (linkState has the fields).
  const link = {
    now: linkState,
    watch: (fn) => { linkFns.add(fn); fn(linkState()); return () => linkFns.delete(fn); },
  };

  const caps = { db, user, downloads, link };
  window.zigs = { use: async (name) => caps[name] || null };
})();

// A module that does not load or link leaves an empty page. Until the first paint, show a notice.
// A failed <script> fires "error" on itself and the event does not bubble: listen in the capture
// phase. A link or run error of a module reaches window. Images and styles are not watched.
window.addEventListener("error", (e) => {
  const app = document.getElementById("app");
  const fromScript = e.target === window || e.target?.tagName === "SCRIPT";
  if (!app || app.firstChild || !fromScript) return;
  const note = document.createElement("p");
  note.className = "notice bad";
  note.textContent = "Zigs did not load completely. Reload the page.";
  app.append(note);
}, true);
