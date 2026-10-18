// The link test of the page modules (APPJS-SPLIT.md, section 8). Run: node web/test/graph.mjs
// web/app.js lists every module of the page with an `import "./x.js";` line. The test checks
// the import graph by its text, then imports every listed module on a stub page in the order of
// the list, as the browser does. The modules run depth first along their imports, not in list
// order. A second run loads them with a passkey-locked vault in storage, the other branch at load.
// The rules:
// 1. every web/app-*.js is in the list, and every listed file exists;
// 2. app-kit.js, app-state.js and the pure modules import no page module;
// 3. no page module imports web/sol/ with a static import;
// 4. no name is exported by two page modules (page.mjs finds a name by its export), no page
//    module and not web/app.js imports a test setter, and no page module imports another one
//    with `import * as`;
// 5. every key that web/sol/*.js reads from the host is a key of solHost();
// 6. every file that a listed file imports is in the list (so the browser fetches them all at
//    the second level);
// 7. every name that web/app.js or a listed file imports is an export of its source: the tests
//    never load web/app.js, so its imports are checked here by their text;
// 8. no page module imports a top-level name of a page module from a pure module: personal.js
//    and app-chain.js both export NETWORKS, and the page means the one of app-chain.js;
// 9. no file of web/sol imports web/app.js or a page module, statically or with import():
//    web/sol reaches the page only through the keys of solHost().
// A promise of a module that rejects soon after the load fails the test too.
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
  "setVault", "setLocked", "setSecrets", "setGkeys", "setIdb", "setIdbMs"];
const problems = [];

const list = [...read("app.js").matchAll(/^import "\.\/([\w-]+\.js)";$/gm)].map((m) => m[1]);
const parseOrSay = (f) => {
  try {
    return [[f, parse(f)]];
  } catch (e) {
    problems.push(`${f} does not parse: ${e.message}`);
    return [];
  }
};
const trees = new Map(list.filter((f) => fs.existsSync(new URL(f, web))).flatMap(parseOrSay));

// The files that one module imports with a static import or a re-export, and the names.
function importsOf(ast) {
  const out = [];
  for (const n of ast.body) {
    if (!n.source) continue;
    const specs = n.specifiers ?? [];
    const names = specs.filter((s) => s.imported).map((s) => s.imported.name);
    const star = specs.some((s) => s.type === "ImportNamespaceSpecifier");
    const locals = specs.map((s) => s.local.name);
    out.push({ from: n.source.value.replace(/^\.\//, ""), names, locals, star });
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

// The top-level names that the page modules declare.
const pageNames = new Set([...trees].filter(([f]) => PAGE.test(f)).flatMap(([, ast]) => ast.body
  .map((n) => n.declaration ?? n).flatMap(declared)));
const borrowed = (f, imp) => (isPage(f) && !PAGE.test(imp.from)
  ? imp.locals.filter((n) => pageNames.has(n)) : []);

// The rules of one import of file f: each one gives a problem text, or nothing.
const isPage = (f) => PAGE.test(f) || f === "app.js";
const leaf = (f) => f === "app-kit.js" || f === "app-state.js" || !isPage(f);
const setters = (f, imp) => (isPage(f) ? imp.names.filter((n) => SEAMS.includes(n)) : []);
const unknown = (imp) => {
  const source = trees.get(imp.from);
  return source ? imp.names.filter((n) => !exportsOf(source).includes(n)) : [];
};
const IMPORT_RULES = [
  (f, imp) => leaf(f) && PAGE.test(imp.from) && `${f} imports the page module ${imp.from}`,
  (f, imp) => imp.from.startsWith("sol/") && `${f} imports ${imp.from} statically`,
  (f, imp) => !list.includes(imp.from) && `${f} imports ${imp.from}, which app.js lacks`,
  (f, imp) => setters(f, imp).length > 0
    && `${f} imports the test setter ${setters(f, imp).join(", ")}`,
  (f, imp) => isPage(f) && imp.star && PAGE.test(imp.from) && `${f} imports * from ${imp.from}`,
  (f, imp) => unknown(imp).length > 0
    && `${f} imports ${unknown(imp).join(", ")}, which ${imp.from} does not export`,
  (f, imp) => borrowed(f, imp).length > 0
    && `${f} imports the page name ${borrowed(f, imp).join(", ")} from ${imp.from}`,
];

function checkImport(f, imp) {
  for (const rule of IMPORT_RULES) {
    const problem = rule(f, imp);
    if (problem) problems.push(problem);
  }
}

function checkImports() {
  const owner = new Map();
  importsOf(parse("app.js")).forEach((imp) => checkImport("app.js", imp));
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

// The source of an import or re-export node, and the paths of the page seen from web/sol.
const SOURCES = new Set(["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration",
  "ImportExpression"]);
const sourceOf = (n) => (SOURCES.has(n.type) && n.source?.type === "Literal" ? n.source.value : "");
const PAGE_PATH = /^(\.\.)?\/app(-[\w-]+)?\.js$/;

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
      if (PAGE_PATH.test(sourceOf(n))) problems.push(`sol/${f} imports ${sourceOf(n)}`);
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
const VAULT = JSON.stringify({ v: 1, cred: "c", salt: "s", iv: "i", box: "b" });
const locked = process.env.GRAPH_VAULT === VAULT;
if (locked) storage.set("zf-vault", VAULT);

checkList();
checkImports();
checkHost();
if (problems.length) {
  problems.forEach((p) => console.log(`graph: ${p}`));
  process.exit(1);
}
process.on("unhandledRejection", (e) => {
  console.log(`graph: a promise rejected after the load: ${e?.message ?? e}`);
  process.exit(1);
});
for (const f of list) {
  try {
    await import(new URL(f, web).href);
  } catch (e) {
    console.log(`graph: ${f} does not load: ${e.constructor.name}: ${e.message.split("\n")[0]}`);
    process.exit(1);
  }
}
await new Promise((r) => setTimeout(r, 300));
if (!locked) {
  const env = { ...process.env, GRAPH_VAULT: VAULT };
  const again = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)],
    { env, encoding: "utf8" });
  if (again.status !== 0) {
    console.log(`graph: with a locked vault in storage: ${again.stdout}${again.stderr}`.trim());
    process.exit(1);
  }
}
const how = locked ? "with a locked vault" : "also with a locked vault";
console.log(`graph ok: ${list.length} modules, ${how}`);
// app-chain.js starts a 60 s timer when it loads.
process.exit(0);
