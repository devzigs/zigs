// Checks the load-failure notice of web/shim.js with a stub page. Run: node web/test/shim.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const code = readFileSync(new URL("../shim.js", import.meta.url), "utf8");

/** Runs shim.js in a stub page. `fire(target)` sends an error event to its listener. */
function load({ withApp = true } = {}) {
  const app = { nodes: [], get firstChild() { return this.nodes[0] ?? null; },
    append(node) { this.nodes.push(node); } };
  const listeners = [];
  const window = { addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }) };
  const document = {
    getElementById: (id) => (withApp && id === "app" ? app : null),
    createElement: (tag) => ({ tagName: tag.toUpperCase() }),
  };
  runInNewContext(code, { window, document });
  const errors = listeners.filter((l) => l.type === "error");
  assert.equal(errors.length, 1, "one error listener");
  assert.equal(errors[0].capture, true, "the error event of a <script> does not bubble");
  return { window, app, fire: (target) => errors[0].fn({ target }) };
}

const NOTICE = "Zigs did not load completely. Reload the page.";
const script = { tagName: "SCRIPT" };

// A module that does not load: the error comes on the <script> element.
let page = load();
assert.equal(typeof page.window.zigs.use, "function", "the store client is still there");
page.fire(script);
assert.equal(page.app.nodes.length, 1);
assert.equal(page.app.nodes[0].tagName, "P");
assert.equal(page.app.nodes[0].className, "notice bad");
assert.equal(page.app.nodes[0].textContent, NOTICE);
page.fire(script);
assert.equal(page.app.nodes.length, 1, "a second error adds no second notice");

// A module that does not link or throws when it runs: the error comes on window.
page = load();
page.fire(page.window);
assert.equal(page.app.nodes[0]?.textContent, NOTICE);

// A missing image, icon or preload before the first paint is no failure of the page.
page = load();
for (const tagName of ["IMG", "LINK"]) page.fire({ tagName });
page.fire(undefined);
assert.equal(page.app.nodes.length, 0);

// After the first paint, an error changes nothing.
page = load();
const painted = { tagName: "DIV" };
page.app.append(painted);
page.fire(script);
page.fire(page.window);
assert.deepEqual(page.app.nodes, [painted]);

// A page without #app is left alone.
page = load({ withApp: false });
page.fire(script);
page.fire(page.window);
console.log("shim ok");
