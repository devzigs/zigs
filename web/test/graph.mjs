// The link test of the page modules (APPJS-SPLIT.md, section 8). Run: node web/test/graph.mjs
// web/app.js lists every module of the page with an `import "./x.js";` line. The test checks
// the import graph by its text, then loads every listed module on a stub page in the order of
// the list, as the browser does:
// 1. every web/app-*.js is in the list, and every listed file exists;
// 2. app-kit.js and app-state.js import no page module;
// 3. no page module imports web/sol/ with a static import;
// 4. no name is exported by two page modules (page.mjs finds a name by its export), and no page
//    module imports a test setter;
// 5. every key that web/sol/*.js reads from the host is a key of solHost();
// 6. every file that a listed file imports is in the list (so the browser fetches them all at
//    the second level).
// The parser is the acorn of the node binary: the test starts itself again with
// --expose-internals. ponytail: that path is internal to node; the upgrade is acorn as a dev
// dependency of solspike.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";

if (!process.execArgv.includes("--expose-internals")) {
  const args = ["--expose-internals", ...process.argv.slice(1)];
  process.exit(spawnSync(process.execPath, args, { stdio: "inherit" }).status ?? 1);
}
const acorn = createRequire(import.meta.url)("internal/deps/acorn/acorn/dist/acorn");
const web = new URL("../", import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, web), "utf8");
const parse = (f) => acorn.parse(read(f), { ecmaVersion: "latest", sourceType: "module" });
const PAGE = /^app-[\w-]+\.js$/;
const SEAMS = ["setZ", "setDb", "setMe", "setDownloads", "setChain", "setAcct", "setPersonal",
  "setVault", "setLocked", "setSecrets", "setGkeys", "setIdb", "setIdbMs", "setTabBar"];
const problems = [];

const list = [...read("app.js").matchAll(/^import "\.\/([\w-]+\.js)";$/gm)].map((m) => m[1]);
const trees = new Map(list.filter((f) => fs.existsSync(new URL(f, web))).map((f) => [f, parse(f)]));

// The files that one module imports with a static import or a re-export, and the names.
function importsOf(ast) {
  const out = [];
  for (const n of ast.body) {
    if (!n.source) continue;
    const names = (n.specifiers ?? []).map((s) => s.imported?.name ?? s.local?.name);
    out.push({ from: n.source.value.replace(/^\.\//, ""), names });
  }
  return out;
}

const declared = (d) => (d?.id ? [d.id.name]
  : (d?.declarations ?? []).filter((v) => v.id.type === "Identifier").map((v) => v.id.name));

const exportsOf = (ast) => ast.body.filter((n) => n.type === "ExportNamedDeclaration")
  .flatMap((n) => [...declared(n.declaration), ...n.specifiers.map((s) => s.exported.name)]);

function checkList() {
  const pages = fs.readdirSync(web).filter((f) => PAGE.test(f));
  for (const f of pages) if (!list.includes(f)) problems.push(`${f} is not listed in app.js`);
  for (const f of list) if (!trees.has(f)) problems.push(`app.js lists ${f}, which does not exist`);
}

function checkImport(f, imp) {
  const leaf = f === "app-kit.js" || f === "app-state.js";
  if (leaf && PAGE.test(imp.from)) problems.push(`${f} imports the page module ${imp.from}`);
  if (imp.from.startsWith("sol/")) problems.push(`${f} imports ${imp.from} statically`);
  if (!list.includes(imp.from)) problems.push(`${f} imports ${imp.from}, which app.js lacks`);
  const seams = PAGE.test(f) ? imp.names.filter((n) => SEAMS.includes(n)) : [];
  if (seams.length) problems.push(`${f} imports the test setter ${seams.join(", ")}`);
}

function checkImports() {
  const owner = new Map();
  for (const [f, ast] of trees) {
    importsOf(ast).forEach((imp) => checkImport(f, imp));
    if (!PAGE.test(f)) continue;
    for (const name of exportsOf(ast)) {
      if (owner.has(name)) problems.push(`${name} is exported by ${owner.get(name)} and ${f}`);
      owner.set(name, f);
    }
  }
}

const walk = (n, fn) => {
  if (!n || typeof n.type !== "string") return;
  fn(n);
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) v.forEach((x) => walk(x, fn));
    else if (v && typeof v.type === "string") walk(v, fn);
  }
};
const isHost = (n) => (n.type === "Identifier" && n.name === "host")
  || (n.type === "MemberExpression" && !n.computed && n.property.name === "host");

// The keys that one node of web/sol reads from the host: host.k, c.host.k, { k } = c.host.
function hostKeys(n) {
  if (n.type === "MemberExpression" && !n.computed && isHost(n.object)) return [n.property.name];
  const pattern = n.type === "VariableDeclarator" && n.id.type === "ObjectPattern";
  return pattern && n.init && isHost(n.init) ? n.id.properties.map((p) => p.key?.name) : [];
}

// The keys of the object that solHost() returns, and the keys that web/sol reads from it.
function checkHost() {
  const keys = new Set();
  for (const ast of trees.values()) {
    walk(ast, (n) => {
      if (n.type === "VariableDeclarator" && n.id.name === "solHost") {
        n.init.body.properties.forEach((p) => keys.add(p.key.name));
      }
    });
  }
  if (!keys.size) problems.push("no solHost() in the page modules");
  for (const f of fs.readdirSync(new URL("sol/", web)).filter((x) => x.endsWith(".js"))) {
    walk(parse(`sol/${f}`), (n) => {
      for (const k of hostKeys(n)) if (k && !keys.has(k)) problems.push(`sol/${f} reads host.${k}`);
    });
  }
}

// A page that does nothing: any property is a function that returns the page again.
const stub = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : stub()),
  apply: () => stub(), construct: () => stub(), set: () => true, has: () => true,
});
const storage = new Map();
Object.assign(globalThis, {
  Node: class {}, document: stub(), history: { replaceState() {} }, requestAnimationFrame: () => 0,
  matchMedia: () => ({ matches: false }),
  location: { hash: "", href: "http://localhost/", origin: "http://localhost" },
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); }, removeItem: (k) => { storage.delete(k); },
  },
  window: new Proxy(stub(), { get: (t, k) => (k === "crypto" ? globalThis.crypto : t[k]) }),
});

checkList();
checkImports();
checkHost();
if (problems.length) {
  problems.forEach((p) => console.log(`graph: ${p}`));
  process.exit(1);
}
for (const f of list) {
  try {
    await import(new URL(f, web).href);
  } catch (e) {
    console.log(`graph: ${f} does not load: ${e.constructor.name}: ${e.message.split("\n")[0]}`);
    process.exit(1);
  }
}
console.log(`graph ok: ${list.length} modules`);
// app-chain.js starts a 60 s timer when it loads.
process.exit(0);
