// The top-level names that one statement of the page uses: calls, reads, assignments and
// mutations, and the ones that run when its module loads (depth 0 of a statement that is not a
// function). A port of the scope walk of the split study (graph/analyze.mjs).

const MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill",
  "set", "delete", "add", "clear", "copyWithin"]);
const AT_LOAD = { call: "lcall", read: "lread", write: "lwrite", mut: "lwrite" };

const PATTERNS = {
  Identifier: (p, out) => out.push(p.name),
  ObjectPattern: (p, out) =>
    p.properties.forEach((q) => patternNames(q.type === "RestElement" ? q.argument : q.value, out)),
  ArrayPattern: (p, out) => p.elements.forEach((q) => patternNames(q, out)),
  AssignmentPattern: (p, out) => patternNames(p.left, out),
  RestElement: (p, out) => patternNames(p.argument, out),
};

/** The names that a binding pattern declares. */
export function patternNames(p, out = []) {
  if (p) PATTERNS[p.type]?.(p, out);
  return out;
}

/** The names that a top-level declaration declares. */
export function declaredNames(node) {
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
    return [node.id.name];
  }
  if (node.type !== "VariableDeclaration") return [];
  return node.declarations.flatMap((d) => patternNames(d.id));
}

class Scope {
  constructor(parent) {
    this.parent = parent;
    this.names = new Set();
  }
  has(name) {
    for (let s = this; s; s = s.parent) if (s.names.has(name)) return true;
    return false;
  }
}

const NOT_CHILD = new Set(["type", "loc", "start", "end"]);
const eachChild = (n, fn) => {
  for (const k of Object.keys(n)) {
    if (NOT_CHILD.has(k)) continue;
    const v = n[k];
    if (Array.isArray(v)) v.forEach(fn);
    else if (v && typeof v.type === "string") fn(v);
  }
};

/** Adds the `var` names of one function body to its scope (not the ones of inner functions). */
function hoistVars(node, scope) {
  const go = (n) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "VariableDeclaration" && n.kind === "var") {
      n.declarations.forEach((d) => patternNames(d.id).forEach((x) => scope.names.add(x)));
    }
    if (/Function|Arrow/.test(n.type)) return;
    eachChild(n, go);
  };
  go(node);
}

function declareLexical(stmts, scope) {
  for (const s of stmts) {
    if (s.type === "VariableDeclaration" && s.kind !== "var") {
      s.declarations.forEach((d) => patternNames(d.id).forEach((x) => scope.names.add(x)));
    } else if (s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") {
      scope.names.add(s.id.name);
    }
  }
}

const rootOf = (e) => {
  while (e && e.type === "MemberExpression") e = e.object;
  return e;
};

// One handler per node type that binds names or writes. Every other node: walk the children.
const HANDLERS = {
  Identifier: (w, n, s) => w.ref(n.name, s, "read"),
  FunctionDeclaration: (w, n, s) => w.fn(n, s),
  FunctionExpression: (w, n, s) => w.fn(n, s),
  ArrowFunctionExpression: (w, n, s) => w.fn(n, s),
  BlockStatement: (w, n, s) => w.block(n.body, s),
  ForStatement: (w, n, s) => w.loop(n, s),
  ForInStatement: (w, n, s) => w.loop(n, s),
  ForOfStatement: (w, n, s) => w.loop(n, s),
  CatchClause: (w, n, s) => {
    const inner = new Scope(s);
    if (n.param) patternNames(n.param).forEach((x) => inner.names.add(x));
    w.block(n.body.body, inner);
  },
  SwitchStatement: (w, n, s) => {
    w.visit(n.discriminant, s);
    const inner = new Scope(s);
    n.cases.forEach((c) => declareLexical(c.consequent, inner));
    for (const c of n.cases) {
      w.visit(c.test, inner);
      c.consequent.forEach((x) => w.visit(x, inner));
    }
  },
  VariableDeclaration: (w, n, s) => {
    for (const d of n.declarations) {
      if (d.id.type === "Identifier") {
        if (d.init) w.ref(d.id.name, s, "write");
      } else w.defaults(d.id, s);
      w.visit(d.init, s);
    }
  },
  ClassDeclaration: (w, n, s) => w.klass(n, s),
  ClassExpression: (w, n, s) => w.klass(n, s),
  MemberExpression: (w, n, s) => {
    w.visit(n.object, s);
    if (n.computed) w.visit(n.property, s);
  },
  Property: (w, n, s) => {
    if (n.computed) w.visit(n.key, s);
    w.visit(n.value, s);
  },
  LabeledStatement: (w, n, s) => w.visit(n.body, s),
  BreakStatement: () => {},
  ContinueStatement: () => {},
  AssignmentExpression: (w, n, s) => {
    w.target(n.left, s, "write");
    if (n.operator !== "=" && n.left.type === "Identifier") w.ref(n.left.name, s, "read");
    w.visit(n.right, s);
  },
  UpdateExpression: (w, n, s) => w.target(n.argument, s, "write"),
  CallExpression: (w, n, s) => w.call(n, s),
};

class Walk {
  constructor(own, top) {
    this.own = new Set(own);
    this.top = top;
    this.depth = 0;
    this.f = { call: new Set(), read: new Set(), write: new Set(), mut: new Set(),
      lcall: new Set(), lread: new Set(), lwrite: new Set() };
  }

  ref(name, scope, how) {
    if (scope.has(name) || !this.top.has(name)) return;
    if (this.own.has(name) && how !== "write" && how !== "mut") return;
    this.f[how].add(name);
    if (this.depth === 0) this.f[AT_LOAD[how]].add(name);
  }

  visit(n, scope) {
    if (!n || typeof n.type !== "string") return;
    const handler = HANDLERS[n.type];
    if (handler) handler(this, n, scope);
    else eachChild(n, (x) => this.visit(x, scope));
  }

  fn(n, scope) {
    this.depth++;
    const s = new Scope(scope);
    if (n.id && n.type === "FunctionExpression") s.names.add(n.id.name);
    n.params.forEach((p) => patternNames(p).forEach((x) => s.names.add(x)));
    hoistVars(n.body, s);
    n.params.forEach((p) => this.defaults(p, s));
    if (n.body.type === "BlockStatement") {
      declareLexical(n.body.body, s);
      n.body.body.forEach((x) => this.visit(x, s));
    } else this.visit(n.body, s);
    this.depth--;
  }

  block(stmts, scope) {
    const s = new Scope(scope);
    declareLexical(stmts, s);
    stmts.forEach((x) => this.visit(x, s));
  }

  loop(n, scope) {
    const s = new Scope(scope);
    const decl = n.type === "ForStatement" ? n.init : n.left;
    if (decl && decl.type === "VariableDeclaration" && decl.kind !== "var") {
      decl.declarations.forEach((d) => patternNames(d.id).forEach((x) => s.names.add(x)));
    }
    if (n.type === "ForStatement") [n.init, n.test, n.update].forEach((x) => this.visit(x, s));
    else {
      if (decl.type === "VariableDeclaration") {
        decl.declarations.forEach((d) => this.target(d.id, s, "write"));
      } else this.target(decl, s, "write");
      this.visit(n.right, s);
    }
    this.visit(n.body, s);
  }

  klass(n, scope) {
    this.visit(n.superClass, scope);
    for (const m of n.body.body) {
      if (m.computed) this.visit(m.key, scope);
      this.visit(m.value, scope);
    }
  }

  // Default values and computed keys inside a binding pattern.
  defaults(p, scope) {
    if (p) DEFAULTS[p.type]?.(this, p, scope);
  }

  // The left side of an assignment: a name is written, a member path mutates its root.
  target(t, scope, how) {
    if (t) TARGETS[t.type]?.(this, t, scope, how);
  }

  // One property of an object pattern: a computed key is read, the value goes to `inner`.
  property(q, scope, inner) {
    if (q.type === "RestElement") return inner(q.argument);
    if (q.computed) this.visit(q.key, scope);
    return inner(q.value);
  }

  call(n, scope) {
    const c = n.callee;
    if (c.type === "Identifier") this.ref(c.name, scope, "call");
    else {
      this.mutCall(c, n.arguments[0], scope);
      this.visit(c, scope);
    }
    n.arguments.forEach((a) => this.visit(a, scope));
  }

  // x.push(...) and the other MUTATORS mutate x; Object.assign(x, ...) mutates x.
  mutCall(c, first, scope) {
    if (c.type !== "MemberExpression" || c.computed) return;
    if (MUTATORS.has(c.property.name)) this.mutRoot(c.object, scope);
    const assign = c.object.type === "Identifier" && c.object.name === "Object"
      && c.property.name === "assign";
    if (assign && first) this.mutRoot(first, scope);
  }

  mutRoot(e, scope) {
    const r = rootOf(e);
    if (r && r.type === "Identifier") this.ref(r.name, scope, "mut");
  }
}

const DEFAULTS = {
  AssignmentPattern: (w, p, s) => {
    w.defaults(p.left, s);
    w.visit(p.right, s);
  },
  ObjectPattern: (w, p, s) =>
    p.properties.forEach((q) => w.property(q, s, (v) => w.defaults(v, s))),
  ArrayPattern: (w, p, s) => p.elements.forEach((q) => w.defaults(q, s)),
  RestElement: (w, p, s) => w.defaults(p.argument, s),
  MemberExpression: (w, p, s) => w.visit(p, s),
};

const TARGETS = {
  Identifier: (w, t, s, how) => w.ref(t.name, s, how),
  MemberExpression: (w, t, s) => {
    w.mutRoot(t, s);
    w.visit(t, s);
  },
  ObjectPattern: (w, t, s, how) =>
    t.properties.forEach((q) => w.property(q, s, (v) => w.target(v, s, how))),
  ArrayPattern: (w, t, s, how) => t.elements.forEach((q) => w.target(q, s, how)),
  AssignmentPattern: (w, t, s, how) => {
    w.target(t.left, s, how);
    w.visit(t.right, s);
  },
  RestElement: (w, t, s, how) => w.target(t.argument, s, how),
};

const sorted = (set) => [...set].sort();

/**
 * Facts of one top-level statement.
 * @param {object} node The statement (an export is already unwrapped).
 * @param {Set<string>} top Every top-level name of the page, imported names included.
 * @returns {object} calls, reads, writes, muts; lcalls, lreads, lwrites run at load.
 */
export function refsOf(node, top) {
  const w = new Walk(declaredNames(node), top);
  if (node.type === "FunctionDeclaration") w.fn(node, new Scope(null));
  else w.visit(node, new Scope(null));
  const f = w.f;
  return { calls: sorted(f.call), reads: sorted(f.read), writes: sorted(f.write),
    muts: sorted(f.mut), lcalls: sorted(f.lcall), lreads: sorted(f.lread),
    lwrites: sorted(f.lwrite) };
}
