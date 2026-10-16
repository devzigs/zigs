// Shared code of the app.js split tools (APPJS-SPLIT.md, step A5). Step E4 deletes this folder.
// A page file is web/app.js or web/app-*.js. A chunk is one top-level statement, or the
// statements that share a line, with the comment and blank lines above it ("lead"). Imports are
// not chunks: move.mjs writes them again from the facts.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { declaredNames, refsOf } from "./refs.mjs";

export const SPLIT = dirname(fileURLToPath(import.meta.url));
// SPLIT_ROOT moves the tools to another clone (selftest.mjs runs them on a fixture).
export const ROOT = process.env.SPLIT_ROOT ?? resolve(SPLIT, "../..");
export const WEB = join(ROOT, "web");

// The move order (D1 to D25) and the heading line of each module.
export const MODULES = [
  ["state", "Shared state objects (state, ui, raw, inbox, ready, busy), the log and the banner."],
  ["kit", "Pure helpers and the localStorage merge helpers. Imports no page module."],
  ["engine", "The WebAssembly engine, and the worker for slow engine calls."],
  ["keystore", "Local secrets, the passkey lock, other-tab sync and IndexedDB."],
  ["seats", "Facts derived from state: the seats of this browser and their keys."],
  ["links", "Invite links and hash routing."],
  ["chain", "Networks, chain sync, the balance cache, memo reading and the 60 s refresh."],
  ["filter", "Pins, signature checks, signed writes and the filter from store to state."],
  ["groups", "Boot, the sealed store, the group and session watchers and the approval queue."],
  ["dom", "el, act, widgets, wording and labels."],
  ["messages", "Wallet rooms, read marks, notices and direct chats."],
  ["dkg", "Wallet creation, the key ceremony, safety number, address check and seat join."],
  ["payments", "Propose, approve, sign, cancel and broadcast; the payment check and expiry."],
  ["payreq", "Payment requests: logic, card and form."],
  ["account", "The personal account: store, sync, send and contacts; startUp."],
  ["thread", "The message card, composer and bubbles; the direct chat page."],
  ["backups", "Backup and restore: logic and dialogs."],
  ["account-view", "The pages of the personal account and its contacts."],
  ["shell", "Side navigation, lock screen, wallet list and create dialog."],
  ["drawer", "The payment drawer."],
  ["loop", "Reactor, render loop, focus, layers and page listeners."],
  ["setup", "The setup page: join, invite, safety and progress."],
  ["sol", "Solana host glue: solHost() and the lazy load of web/sol."],
  ["wallet", "The wallet page: tabs, overview, activity, signers and details."],
  ["send", "Receive and send dialogs."],
];
export const ORDER = MODULES.map(([m]) => m);
export const HEADING = Object.fromEntries(MODULES);
// The pure modules, in the order of the imports of the old app.js.
export const PURE = ["qr", "payees", "vault", "util", "signed", "chat", "personal", "requests"];
export const ENTRY = "app.js";
export const REST = "app-rest.js";
export const fileOf = (m) => (m === "entry" ? ENTRY : `app-${m}.js`);
export const moduleOfFile = (f) =>
  (f === ENTRY ? "entry" : f === REST ? "rest" : f.replace(/^app-/, "").replace(/\.js$/, ""));
export const BANNER = /^\/\/ ─+ .* ─+$|^\/\/ ── .* ──$/;

/** Starts this tool again with --expose-internals when node runs it without the flag. */
export function withInternals() {
  if (process.execArgv.includes("--expose-internals")) return;
  const args = ["--expose-internals", ...process.execArgv, ...process.argv.slice(1)];
  process.exit(spawnSync(process.execPath, args, { stdio: "inherit" }).status ?? 1);
}

let acornLib;
const acorn = () =>
  (acornLib ??= createRequire(import.meta.url)("internal/deps/acorn/acorn/dist/acorn"));

export const parse = (text) =>
  acorn().parse(text, { ecmaVersion: "latest", sourceType: "module", locations: true });

export const fail = (msg) => {
  throw new Error(msg);
};

const isBlankOrComment = (line) => {
  const t = line.trim();
  return t === "" || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
};

const kindOf = (node) => {
  if (node.type === "FunctionDeclaration") return node.async ? "async function" : "function";
  if (node.type === "ClassDeclaration") return "class";
  if (node.type !== "VariableDeclaration") return "stmt";
  const fnValue = node.declarations.every((d) => d.init && /Function/.test(d.init.type));
  return fnValue ? `${node.kind}-fn` : node.kind;
};

// The statement text of a chunk with every `export ` removed, and where each statement starts.
function plainText(src, from, to, nodes) {
  let plain = "";
  let at = from;
  const starts = [];
  for (const node of nodes) {
    plain += src.slice(at, node.start);
    starts.push(plain.length);
    at = node.start;
    if (node.type === "ExportNamedDeclaration") {
      if (src.slice(at, at + 7) !== "export ") fail(`no "export " at offset ${at}`);
      at += 7;
    }
  }
  return { plain: plain + src.slice(at, to), starts };
}

/** The key of a statement with no name: the first 60 characters, blanks folded. */
export const keyOf = (plain) => plain.replace(/\s+/g, " ").slice(0, 60);

function groupByLine(stmts) {
  const groups = [];
  for (const node of stmts) {
    const last = groups.at(-1);
    if (last && node.loc.start.line === last.at(-1).loc.end.line) last.push(node);
    else groups.push([node]);
  }
  return groups;
}

// The comment lines at the top of a file: the lines above the first import, or (no import) the
// first run of comment lines.
function headerEnd(lines, firstImport) {
  if (firstImport) return firstImport.loc.start.line - 1;
  let n = 0;
  while (n < lines.length && lines[n].trim().startsWith("//")) n++;
  return n;
}

function makeChunk({ file, src, lines, offsets }, group, leadFrom) {
  const first = group[0], last = group.at(-1);
  const start = first.loc.start.line, end = last.loc.end.line;
  if (lines[start - 1].slice(0, first.loc.start.column).trim()) {
    fail(`${file}:${start}: a statement does not start a line`);
  }
  const lead = lines.slice(leadFrom - 1, start - 1);
  const bad = lead.findIndex((l) => !isBlankOrComment(l));
  if (bad >= 0) fail(`${file}:${leadFrom + bad}: code outside a statement`);
  const lineEnd = offsets[end - 1] + lines[end - 1].length;
  const { plain, starts } = plainText(src, offsets[start - 1], lineEnd, group);
  const nodes = group.map((n) => (n.type === "ExportNamedDeclaration" ? n.declaration : n));
  if (nodes.some((n) => !n)) fail(`${file}:${start}: an export with no declaration`);
  return { file, start, end, lead, plain, starts, nodes,
    exported: group.map((n) => n.type === "ExportNamedDeclaration") };
}

/**
 * Parses one page file into header, imports, chunks and trailer.
 * @param {string} file The file name inside web/.
 * @param {string} src The text.
 * @returns {object} { file, header, imports, importText, chunks, trailer }
 */
export function parseFile(file, src) {
  const ast = parse(src);
  const lines = src.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const imports = ast.body.filter((n) => n.type === "ImportDeclaration");
  const stmts = ast.body.filter((n) => n.type !== "ImportDeclaration");
  if (imports.at(-1)?.start > stmts[0]?.start) fail(`${file}: an import after a statement`);
  const head = headerEnd(lines, imports[0]);
  const importEnd = imports.at(-1)?.loc.end.line ?? head;
  const { chunks, next } = chunksOf({ file, src, lines }, stmts, importEnd + 1);
  const trailer = lines.slice(next - 1);
  if (trailer.some((l) => !isBlankOrComment(l))) fail(`${file}: code after the last statement`);
  return { file, header: lines.slice(0, head), imports,
    importText: lines.slice(head, importEnd), chunks, trailer };
}

// The chunks of the statements, from line `leadFrom` on. `next`: the first line after them.
function chunksOf(ctx, stmts, leadFrom) {
  ctx.offsets = [0];
  for (const line of ctx.lines) ctx.offsets.push(ctx.offsets.at(-1) + line.length + 1);
  const chunks = [];
  let next = leadFrom;
  for (const group of groupByLine(stmts)) {
    const chunk = makeChunk(ctx, group, next);
    chunks.push(chunk);
    next = chunk.end + 1;
  }
  return { chunks, next };
}

/** The page files of the working tree, or of a commit. */
export function pageFiles(rev) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
  const names = rev ? git("ls-tree", "--name-only", `${rev}:web/`).split("\n") : readdirSync(WEB);
  const page = names.filter((f) => f === ENTRY || /^app-.+\.js$/.test(f)).sort();
  return page.map((f) => ({
    file: f,
    text: rev ? git("show", `${rev}:web/${f}`) : readFileSync(join(WEB, f), "utf8"),
  }));
}

function addPure(pure, file, source, spec) {
  if (spec.type !== "ImportSpecifier") fail(`${file}: only named imports of ${source}.js`);
  const row = { source, imported: spec.imported.name };
  const old = pure.get(spec.local.name);
  const clash = old && (old.source !== row.source || old.imported !== row.imported);
  if (clash) fail(`${spec.local.name} is imported from two places`);
  pure.set(spec.local.name, row);
}

// Local name -> { source, imported } for every import of a pure module in the page files.
function pureImports(files) {
  const pure = new Map();
  for (const f of files) {
    for (const imp of f.imports) {
      const m = /^\.?\/(\w+)\.js$/.exec(imp.source.value);
      if (m && PURE.includes(m[1])) imp.specifiers.forEach((s) => addPure(pure, f.file, m[1], s));
    }
  }
  return pure;
}

/**
 * Parses the page and computes the facts of every statement.
 * @param {Array<{file: string, text: string}>} list The page files (pageFiles()).
 * @returns {object} { files, chunks, items, owner, pure, top }. An item is one statement:
 *   names, kind, runsAtLoad, chunk, and the refs of refs.mjs.
 */
export function loadPage(list) {
  const files = list.map(({ file, text }) => parseFile(file, text));
  const chunks = files.flatMap((f) => f.chunks);
  const pure = pureImports(files);
  const items = chunks.flatMap((chunk) => chunk.nodes.map((node) => {
    const kind = kindOf(node);
    return { names: declaredNames(node), kind, node, chunk,
      runsAtLoad: !/function|-fn$/.test(kind) };
  }));
  const owner = new Map();
  for (const it of items) {
    for (const n of it.names) {
      if (owner.has(n) || pure.has(n)) fail(`the name ${n} is declared twice`);
      owner.set(n, it);
    }
  }
  const top = new Set([...owner.keys(), ...pure.keys()]);
  for (const it of items) Object.assign(it, refsOf(it.node, top));
  return { files, chunks, items, owner, pure, top };
}

export const usesOf = (it) => [...it.calls, ...it.reads, ...it.writes, ...it.muts];

/**
 * The name table: solspike/split/table.tsv. A row is "name<TAB>module" for a named statement and
 * "@key<TAB>module" for a statement with no name (key: keyOf()).
 */
export function readTable(file = join(ROOT, "solspike/split/table.tsv")) {
  const table = { names: new Map(), keys: new Map() };
  const rows = readFileSync(file, "utf8").split("\n");
  rows.forEach((line, i) => line && !line.startsWith("#") && addRow(table, line, i + 1));
  return table;
}

function addRow(table, line, n) {
  const [key, mod, extra] = line.split("\t");
  if (!mod || extra !== undefined) fail(`table.tsv:${n}: want two columns`);
  if (mod !== "entry" && !HEADING[mod]) fail(`table.tsv:${n}: unknown module ${mod}`);
  const unnamed = key.startsWith("@");
  const map = unnamed ? table.keys : table.names;
  const k = unnamed ? key.slice(1) : key;
  if (map.has(k)) fail(`table.tsv:${n}: ${key} is listed twice`);
  map.set(k, mod);
}

/** The module of a chunk by the table, or { error }. */
export function tableModule(table, chunk) {
  const names = chunk.nodes.flatMap(declaredNames);
  if (!names.length) {
    const key = keyOf(chunk.plain);
    return table.keys.get(key) ?? { error: `no row for the statement "${key}"` };
  }
  const mods = new Set(names.map((n) => table.names.get(n)));
  if (mods.has(undefined)) {
    return { error: `no row for ${names.filter((n) => !table.names.has(n)).join(", ")}` };
  }
  if (mods.size > 1) return { error: `${names.join(", ")} map to ${[...mods].join(" and ")}` };
  return [...mods][0];
}

/** The module that a file holds. app.js is the rest until step C2 makes app-rest.js. */
export function holderOf(file, files) {
  const restExists = files.some((f) => f.file === REST);
  return file === ENTRY && !restExists ? "rest" : moduleOfFile(file);
}

/**
 * Checks that every chunk is in the file of its module by the table. A chunk of a module that
 * has no file yet is in the rest.
 * @returns {{ target: Map<object, string>, errors: string[] }}
 */
export function placement(page, table) {
  const target = new Map(), errors = [];
  const own = new Set(page.files.map((f) => moduleOfFile(f.file)));
  for (const c of page.chunks) {
    const m = tableModule(table, c);
    if (m.error) {
      errors.push(`web/${c.file}:${c.start}: ${m.error}`);
      continue;
    }
    target.set(c, m);
    const home = holderOf(c.file, page.files);
    const inRest = home === "rest" && (m === "entry" ? !own.has("rest") : !own.has(m));
    if (home !== m && !inRest) errors.push(`web/${c.file}:${c.start}: the table puts this in ${m}`);
  }
  return { target, errors };
}

/** The names that the tests read from the page: NAMES of web/test/page.mjs. */
export function testNames(root = ROOT) {
  const file = join(root, "web/test/page.mjs");
  if (!existsSync(file)) return new Set();
  const decls = parse(readFileSync(file, "utf8")).body
    .map((node) => node.declaration ?? node)
    .filter((node) => node.type === "VariableDeclaration")
    .flatMap((node) => node.declarations);
  const list = decls.find((d) => d.id.name === "NAMES")?.init;
  if (list?.type !== "ArrayExpression") fail("web/test/page.mjs: no array NAMES");
  return new Set(list.elements.map((e) => e.value));
}

/** The text of a chunk, with `export ` before the statements whose flag is true. */
export function chunkText(chunk, flags) {
  let text = chunk.plain;
  for (let i = chunk.starts.length - 1; i >= 0; i--) {
    if (flags[i]) text = text.slice(0, chunk.starts[i]) + "export " + text.slice(chunk.starts[i]);
  }
  return text;
}

const byName = (a, b) => {
  const x = a.split(" as ").at(-1), y = b.split(" as ").at(-1);
  return x.toLowerCase().localeCompare(y.toLowerCase()) || (x < y ? -1 : x > y ? 1 : 0);
};

/** One import declaration, wrapped at 100 characters in the style of the old app.js. */
export function importLine(specs, from) {
  const list = [...specs].sort(byName);
  const one = `import { ${list.join(", ")} } from "${from}";`;
  if (one.length <= 100) return [one];
  const out = ["import {"];
  let line = " ";
  for (const s of list) {
    if (line.length + s.length + 2 > 100) {
      out.push(line);
      line = " ";
    }
    line += ` ${s},`;
  }
  out.push(line, `} from "${from}";`);
  return out;
}
