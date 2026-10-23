// The real presentation controller against a small DOM, with no wallet, authenticator or engine.
import assert from "node:assert/strict";
import test from "node:test";
import { approvalExamples, brandTilt, createMotionController, observeFeedbackSize,
  zecApprovalMotionValue }
  from "../app-motion.js";
import { approvalMotionValue } from "../sol/payview.js";

function classList() {
  const names = new Set();
  return { add: (...ns) => ns.forEach((n) => names.add(n)),
    remove: (...ns) => ns.forEach((n) => names.delete(n)), contains: (n) => names.has(n),
    toggle: (n, on) => on ? names.add(n) : names.delete(n) };
}

function attributeSelector(node, attribute) {
  const [, tag, key, value] = attribute;
  return (!tag || node.tag === tag) && node.hasAttribute(key)
    && (value === undefined || node.getAttribute(key) === value);
}

function selector(node, text) {
  if (text === "details:not([open])") return node.tag === "details" && !node.hasAttribute("open");
  if (text.startsWith(".")) return node.classList.contains(text.slice(1));
  if (text.startsWith("#")) return node.getAttribute("id") === text.slice(1);
  const attribute = text.match(/^(\w+)?\[([^=\]]+)(?:=([^\]]+))?\]$/);
  if (!attribute) return node.tag === text;
  return attributeSelector(node, attribute);
}

class Element {
  constructor(tag, attrs = {}, ...children) {
    this.tag = tag; this.attrs = new Map(Object.entries(attrs));
    this.children = []; this.parentElement = null; this.classList = classList();
    const styles = new Map();
    this.style = { setProperty: (key, value) => styles.set(key, value),
      getPropertyValue: (key) => styles.get(key) ?? "" };
    this.append(...children);
  }
  get isConnected() { return this.tag === "html" || this.parentElement?.isConnected === true; }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  hasAttribute(key) { return this.attrs.has(key); }
  append(...children) {
    children.forEach((node) => { node.parentElement = this; this.children.push(node); });
  }
  matches(text) { return text.split(",").some((s) => selector(this, s)); }
  contains(node) {
    return node === this || this.children.some((child) => child.contains(node));
  }
  closest(text) { return this.matches(text) ? this : this.parentElement?.closest(text) ?? null; }
  querySelectorAll(text) {
    return this.children.flatMap((node) => [node, ...node.querySelectorAll("*")])
      .filter((node) => text === "*" || node.matches(text));
  }
  querySelector(text) { return this.querySelectorAll(text)[0] ?? null; }
}

function events() {
  const listeners = new Map();
  return { addEventListener: (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
  }, removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
  emit: (name) => listeners.get(name)?.forEach((fn) => fn()),
  count: () => [...listeners.values()].reduce((n, group) => n + group.size, 0) };
}

function fixture(storage = new Map()) {
  const doc = { ...events(), documentElement: new Element("html"), hidden: false,
    activeElement: null };
  const media = { ...events(), matches: false };
  const memory = storage instanceof Map ? { getItem: (k) => storage.get(k),
    setItem: (k, v) => storage.set(k, v) } : storage;
  let time = 0;
  const controller = createMotionController({ document: doc, media, storage: memory,
    now: () => time });
  const draw = (view, identity = {}, layer = null) => {
    doc.documentElement.children.forEach((node) => { node.parentElement = null; });
    doc.documentElement.children = []; doc.documentElement.append(view);
    if (layer) doc.documentElement.append(layer);
    controller.present({ view, layer, identity });
  };
  return { doc, media, storage, controller, draw, at: (value) => { time = value; } };
}

function watch(key, value) {
  return new Element("section", { "data-motion-watch": key, "data-motion-value": value },
    new Element("span", { "data-motion-mark": "", "aria-hidden": "true" }));
}
const view = (...nodes) => new Element("main", {}, new Element("h1"), ...nodes);
const markOf = (node) => node.querySelector("[data-motion-mark]");
const has = (node, name = "motion-complete-enter") => node.classList.contains(name);

function protectionIntro(hidden = false) {
  const mark = new Element("span", { "data-passkey-arrival": "", "aria-hidden": "true" });
  const section = new Element("section", hidden ? { hidden: "" } : {}, mark);
  const layer = new Element("form", { "aria-labelledby": "create-title" }, section);
  return { mark, section, layer };
}

test((
  "protection arrival continues across redraws without "
  + "replaying or restarting on step return"
), () => {
  const f = fixture(), first = protectionIntro();
  f.draw(view(), {}, first.layer);
  assert.ok(has(first.mark, "motion-passkey-arrival"));
  f.at(300);
  const redraw = protectionIntro(); f.draw(view(), {}, redraw.layer);
  assert.ok(has(redraw.mark, "motion-passkey-arrival"));
  assert.equal(redraw.mark.style.getPropertyValue("--passkey-arrival-offset"), "-300ms",
    "a replacement node resumes the same pulse instead of starting again");
  f.at(1900);
  const finished = protectionIntro(); f.draw(view(), {}, finished.layer);
  assert.equal(has(finished.mark, "motion-passkey-arrival"), false);
  const hidden = protectionIntro(true); f.draw(view(), {}, hidden.layer);
  const returned = protectionIntro(); f.draw(view(), {}, returned.layer);
  assert.equal(has(returned.mark, "motion-passkey-arrival"), false);
  f.draw(view());
  const reopened = protectionIntro(); f.draw(view(), {}, reopened.layer);
  assert.ok(has(reopened.mark, "motion-passkey-arrival"),
    "a newly opened dialog may introduce its control");
  assert.equal(reopened.mark.getAttribute("data-motion-value"), null,
    "an arrival effect adds no protection result or completion value");
  f.controller.destroy();
});

test("protection arrival respects hidden steps, reduced motion and document visibility", () => {
  const f = fixture(), hidden = protectionIntro(true);
  f.draw(view(), {}, hidden.layer);
  assert.equal(has(hidden.mark, "motion-passkey-arrival"), false);
  const shown = protectionIntro(); f.draw(view(), {}, shown.layer);
  assert.ok(has(shown.mark, "motion-passkey-arrival"));
  f.doc.hidden = true; f.doc.emit("visibilitychange");
  assert.equal(has(shown.mark, "motion-passkey-arrival"), false);
  f.doc.hidden = false; f.doc.emit("visibilitychange");
  const visibleAgain = protectionIntro(); f.draw(view(), {}, visibleAgain.layer);
  assert.equal(has(visibleAgain.mark, "motion-passkey-arrival"), false);
  f.draw(view()); f.media.matches = true;
  const reduced = protectionIntro(); f.draw(view(), {}, reduced.layer);
  assert.equal(has(reduced.mark, "motion-passkey-arrival"), false);
  f.media.matches = false; f.media.emit("change");
  const toggled = protectionIntro(); f.draw(view(), {}, toggled.layer);
  assert.equal(has(toggled.mark, "motion-passkey-arrival"), false,
    "no deferred replay after reduced motion");
  f.controller.destroy();
});

test("decorative pointer tilt stays within two degrees and rests at the centre", () => {
  assert.deepEqual(brandTilt(120, 120, 240, 240), { x: -0, y: 0 });
  for (const [x, y] of [[0, 0], [240, 240], [-100, 900], [800, -200]]) {
    const angle = brandTilt(x, y, 240, 240);
    assert.ok(Math.abs(angle.x) <= 2 && Math.abs(angle.y) <= 2);
  }
  assert.ok(Object.values(brandTilt(0, 0, 0, 0)).every(Number.isFinite));
});

test("illustrative combinations always contain exactly the proposed distinct shares", () => {
  for (let n = 2; n <= 7; n++) for (let t = 2; t <= n; t++) {
    const examples = approvalExamples(n, t);
    for (const group of examples) {
      assert.equal(new Set(group).size, t);
      assert.ok(group.every((i) => i >= 0 && i < n));
    }
    assert.deepEqual(examples[0], examples.at(-1), "settles to the static first combination");
  }
  for (const [n, t] of [[1, 1], [8, 2], [3, 4], [3.5, 2], [3, NaN]])
    assert.deepEqual(approvalExamples(n, t), []);
});

function educationNode(kind, value = "explanation") {
  const calls = [], marks = kind === "approval" ? ["0", "1", "2", "3"] : ["fingerprint", "lock"];
  const node = new Element("div", { "data-education": kind, "data-education-value": value },
    ...marks.map((mark) => {
      const child = new Element("span", { "data-education-mark": mark });
      child.animate = (frames, options) => {
        const call = { frames, options, cancelled: false }; calls.push(call);
        return { finished: new Promise(() => {}), cancel: () => { call.cancelled = true; } };
      };
      return child;
    }));
  return { node, calls };
}

test("education runs once, settles on redraw and stops on reduced motion or hidden tabs", () => {
  const old = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "#9f481d" });
  const f = fixture(), arrangement = educationNode("approval", "4:2");
  try {
    f.draw(view(arrangement.node));
    assert.equal(arrangement.calls.length, 4);
    for (let frame = 0; frame < 5; frame++) {
      assert.equal(arrangement.calls.filter((call) =>
        !call.frames[frame].boxShadow.includes("transparent")).length, 2);
    }
    assert.ok(arrangement.calls.every((call) => call.options.iterations === 1));
    f.draw(view(arrangement.node));
    assert.equal(arrangement.calls.length, 4, "ordinary redraw never replays the illustration");
    assert.ok(arrangement.calls.every((call) => call.cancelled));
    arrangement.node.attrs.set("data-education-value", "4:3");
    f.controller.education(arrangement.node);
    assert.equal(arrangement.calls.length, 8,
      "a new proposed rule can illustrate its combinations");
    f.draw(view(arrangement.node));
    assert.equal(arrangement.calls.length, 8, "a redraw after live input does not replay it");
    const passkey = educationNode("passkey"); f.draw(view(passkey.node), { panel: "protect" });
    assert.equal(passkey.calls.length, 2);
    f.media.matches = true; f.media.emit("change");
    assert.ok(passkey.calls.every((call) => call.cancelled));
    f.media.matches = false; f.controller.education(passkey.node);
    f.doc.hidden = true; f.doc.emit("visibilitychange");
    assert.ok(passkey.calls.every((call) => call.cancelled));
    const count = passkey.calls.length; f.controller.education(passkey.node);
    assert.equal(passkey.calls.length, count, "hidden documents cannot start educational effects");
  } finally { f.controller.destroy(); globalThis.getComputedStyle = old; }
});

test("entrances preserve DOM, focus and forms; refreshes settle immediately", () => {
  const f = fixture(), control = new Element("input");
  Object.defineProperty(control, "value", { value: "kept draft", writable: false });
  const first = view(control); f.doc.activeElement = control;
  f.draw(first, { wallet: "A", panel: "overview" });
  assert.ok(has(first.children[0], "motion-content-enter"));
  assert.equal(first.children[1], control); assert.equal(control.value, "kept draft");
  assert.equal(f.doc.activeElement, control);
  f.controller.present({ view: first, identity: { wallet: "A", panel: "overview" } });
  assert.equal(has(first.children[0], "motion-content-enter"), false);
  const next = view(); f.draw(next, { wallet: "B", panel: "overview" });
  assert.equal(first.isConnected, false, "no prior wallet is retained for an exit");
  assert.ok(has(next.children[0], "motion-content-enter")); f.controller.destroy();
});

test("both chains animate new approvals and threshold once; history stays settled", () => {
  const f = fixture(), identity = { wallet: "A", panel: "solana" };
  const keys = ["approval:zec:1", "threshold:zec", "approval:sol:S:2", "threshold:sol:S"];
  f.draw(view(...keys.map((key) => watch(key, "off"))), identity);
  const fresh = keys.map((key) => watch(key, "on")); f.draw(view(...fresh), identity);
  fresh.forEach((node) => assert.ok(has(markOf(node)), node.getAttribute("data-motion-watch")));
  f.draw(view(...keys.map((key) => watch(key, "off"))), identity);
  const repeated = keys.map((key) => watch(key, "on")); f.draw(view(...repeated), identity);
  repeated.forEach((node) => assert.equal(has(markOf(node)), false, "same result cannot replay"));
  const historical = watch("threshold:zec", "on");
  f.draw(view(historical), { wallet: "B", panel: "solana" });
  assert.equal(has(markOf(historical)), false, "first observation is settled");
  f.controller.destroy();
});

test("unknown and newly inserted statuses cannot invent a completion transition", () => {
  const f = fixture(), id = { wallet: "A" };
  f.draw(view(watch("landed:zec", "off")), id);
  f.draw(view(watch("landed:zec", "unknown")), id);
  const unknown = watch("landed:zec", "on"), inserted = watch("threshold:sol:S", "on");
  f.draw(view(unknown, inserted), id);
  assert.equal(has(markOf(unknown)), false); assert.equal(has(markOf(inserted)), false);
  f.controller.destroy();
});

test("historical SOL approvals wait for their snapshot and signature verification", () => {
  const f = fixture(), session = { id: "historical" };
  const context = { wait: 0, sessWait: 0, raw: { solcommits: {} } };
  const draw = (approved) => {
    const value = approvalMotionValue(context, session, approved);
    const node = watch("approval:sol:historical:1", value); f.draw(view(node));
    return { value, animated: has(markOf(node)) };
  };
  assert.deepEqual(draw(false), { value: "unknown", animated: false }, "no first snapshot");
  context.raw.solcommits.historical = { 1: {} }; context.sessWait = 1;
  assert.deepEqual(draw(false), { value: "unknown", animated: false }, "signature check pending");
  context.sessWait = 0;
  assert.deepEqual(draw(true), { value: "on", animated: false }, "historical record settles");
  const live = { id: "live" }; context.raw.solcommits.live = {};
  assert.equal(approvalMotionValue(context, live, false), "off", "loaded empty snapshot is known");
  context.wait = 1;
  assert.equal(approvalMotionValue(context, live, true), "unknown", "ceremony still checking");
  context.wait = 0;
  const liveNode = (approved) => watch("approval:sol:live:1",
    approvalMotionValue(context, live, approved));
  f.draw(view(liveNode(false)));
  const arrived = liveNode(true); f.draw(view(arrived));
  assert.ok(has(markOf(arrived)), "a genuinely new approval after a known empty snapshot animates");
  f.controller.destroy();
});

test("ZEC history and first approvals stay settled without a known prior snapshot", () => {
  const f = fixture(), facts = { status: "collecting", snapshotKnown: false };
  const node = (approved) => watch("approval:zec:1", zecApprovalMotionValue(facts, approved));
  f.draw(view(node(false))); facts.snapshotKnown = true;
  const first = node(true); f.draw(view(first));
  assert.equal(has(markOf(first)), false, "first approval has no reliable earlier snapshot");
  for (const patch of [{ pending: true }, { packaged: true }, { error: true },
    { checking: true }, { status: "complete" }, { snapshotKnown: false }]) {
    assert.equal(zecApprovalMotionValue({ ...facts, ...patch }, true), "unknown");
  }
  const other = (approved) => watch("approval:zec:2", zecApprovalMotionValue(facts, approved));
  f.draw(view(node(true), other(false)));
  const second = other(true); f.draw(view(node(true), second));
  assert.ok(has(markOf(second)), "a later verified new participant may animate");
  f.controller.destroy();
});

test("payment identity and closing or reopening a layer reset its observation baseline", () => {
  const f = fixture(), make = (value) => new Element("aside", { "aria-label": "Payment details" },
    new Element("h2"), watch("landed:zec", value));
  f.draw(view(), { wallet: "A", session: "old" }, make("off"));
  const other = make("on"); f.draw(view(), { wallet: "A", session: "new" }, other);
  assert.equal(has(markOf(other)), false, "another payment's historical success is settled");
  f.draw(view(), { wallet: "A" });
  const reopened = make("on"); f.draw(view(), { wallet: "A", session: "new" }, reopened);
  assert.equal(has(markOf(reopened)), false); f.controller.destroy();
});

test("passkey marks follow existing pending, error and verified values only", () => {
  const f = fixture(); f.draw(view(watch("passkey:create", "idle")));
  for (const value of ["pending", "error", "pending", "verified"]) {
    const status = watch("passkey:create", value); f.draw(view(status));
    assert.ok(has(markOf(status), value === "verified"
      ? "motion-complete-enter" : "motion-feedback-enter"));
    assert.equal(has(status), false, "status text and wrapper stay static");
  }
  const old = watch("passkey:create", "verified"); f.draw(view(old));
  assert.equal(has(markOf(old)), false); f.controller.destroy();
});

test("a readiness observer cannot animate a nested passkey mark as setup completion", () => {
  const f = fixture(), first = watch("setup", "off"); f.draw(first);
  const nested = watch("passkey:review", "verified");
  const parent = new Element("main", { "data-motion-watch": "setup", "data-motion-value": "on" },
    new Element("h1"), nested);
  f.draw(parent); assert.equal(has(markOf(nested)), false); f.controller.destroy();
});

test("QR surfaces and ancestors, disclosures and focused controls remain static", () => {
  for (const kind of ["qr", "descendant-qr", "notice", "focus", "control"]) {
    const f = fixture(), title = new Element("h1"), page = new Element("main", {}, title);
    if (kind === "qr") page.classList.add("qr");
    if (kind === "descendant-qr") {
      const code = new Element("div"); code.classList.add("qr"); title.append(code);
    }
    if (kind === "notice") page.classList.add("callout");
    if (kind === "focus") f.doc.activeElement = title;
    if (kind === "control") title.append(new Element("button"));
    f.draw(page); assert.equal(has(title, "motion-content-enter"), false, kind);
    f.controller.destroy();
  }
});

test("incoming motion selects a visible heading rather than hidden accessibility headings", () => {
  for (const kind of ["sr-only", "hidden", "aria-hidden"]) {
    const f = fixture(), hidden = new Element("div"), actual = new Element("h2");
    if (kind === "sr-only") hidden.classList.add("sr-only");
    else hidden.attrs.set(kind, kind === "hidden" ? "" : "true");
    hidden.append(new Element("h1", { "data-motion": "content" }));
    const page = new Element("main", {}, hidden, actual); f.draw(page);
    assert.ok(has(actual, "motion-content-enter"), kind);
    assert.equal(has(hidden.children[0], "motion-content-enter"), false);
    f.controller.destroy();
  }
});

test("brand sweep runs once per tab; storage failure uses memory and never delays a replay", () => {
  const storage = new Map(), f = fixture(storage);
  const plate = () => new Element("div", { "data-motion": "brand" });
  const first = plate(); f.draw(view(first)); assert.ok(has(first, "motion-brand-sweep"));
  const second = plate(); f.draw(view(second));
  assert.equal(has(second, "motion-brand-sweep"), false);
  f.controller.destroy();
  const reload = fixture(storage), historical = plate(); reload.draw(view(historical));
  assert.equal(has(historical, "motion-brand-sweep"), false); reload.controller.destroy();
  const denied = fixture({ getItem() { throw Error("denied"); },
    setItem() { throw Error("denied"); } });
  const fallback = plate(); denied.draw(view(fallback));
  assert.ok(has(fallback, "motion-brand-sweep"));
  const later = plate(); denied.draw(view(later));
  assert.equal(has(later, "motion-brand-sweep"), false);
  denied.controller.destroy();
});

test("live reduced motion and hidden-document changes immediately settle all effects", () => {
  const f = fixture(), brand = new Element("div", { "data-motion": "brand" }), first = view(brand);
  f.draw(first); assert.ok(has(brand, "motion-brand-sweep"));
  f.media.matches = true; f.media.emit("change");
  assert.equal(has(brand, "motion-brand-sweep"), false);
  const reduced = view(); f.draw(reduced, { panel: "settings" });
  assert.equal(has(reduced.children[0], "motion-content-enter"), false);
  f.media.matches = false; f.media.emit("change");
  assert.equal(has(reduced.children[0], "motion-content-enter"), false, "no deferred replay");
  const next = view(); f.draw(next, { panel: "activity" });
  f.doc.hidden = true; f.doc.emit("visibilitychange");
  assert.equal(has(next.children[0], "motion-content-enter"), false);
  assert.ok(f.doc.documentElement.classList.contains("motion-document-hidden"));
  f.doc.hidden = false; f.doc.emit("visibilitychange");
  assert.equal(has(next.children[0], "motion-content-enter"), false);
  f.controller.destroy(); assert.equal(f.doc.count(), 0); assert.equal(f.media.count(), 0);
});

test("feedback clearance follows size and visibility without touching state", () => {
  const values = new Map(), banner = { hidden: false, height: 120.25,
    getBoundingClientRect() { return { height: this.height }; } };
  const doc = { getElementById: () => banner,
    documentElement: { style: { setProperty: (key, value) => values.set(key, value) } } };
  class Observer {
    constructor(callback) { this.emit = callback; }
    observe(node) { assert.equal(node, banner); }
  }
  const observer = observeFeedbackSize(doc, Observer);
  observer.emit(); assert.equal(values.get("--feedback-height"), "121px");
  banner.height = 248; observer.emit();
  assert.equal(values.get("--feedback-height"), "248px");
  banner.height = 72; observer.emit(); assert.equal(values.get("--feedback-height"), "72px");
  banner.hidden = true; observer.emit();
  assert.equal(values.get("--feedback-height"), "0px");
  assert.equal(observeFeedbackSize(doc, null), null, "CSS fallback needs no observer");
  assert.equal(observeFeedbackSize(null, Observer), null);
});
