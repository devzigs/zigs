// Facts and expectations of the mock scenarios. facts() turns the CDP records and the page facts
// into plain values. expectations() lists what each scenario must show, as [description, ok].
import { FEES, FEE_BALANCE, GROUP, NONCE_ACCOUNT, SIGNATURE, UNITS } from "./synthetic.mjs";

const isControl = (r) => /\/(page|control-worker)\.js$/.test(r.source ?? "");
const base = (url) => (url ?? "").replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
const find = (facts, type, extra = () => true) => facts.find((f) => f.type === type && extra(f));
const control = (facts, scope, name) =>
  facts.find((f) => f.type === "control" && f.scope === scope && f.name === name);

/** The CSP events, split into product events (from the Worker or the bundle) and controls. */
function cspFacts(records) {
  const events = records.filter((r) => r.kind === "csp");
  return {
    product: events
      .filter((r) => !isControl(r))
      .map((r) => `${r.who}: ${r.directive} ${r.blocked} from ${base(r.source)}:${r.line}`),
    productDirectives: [...new Set(events.filter((r) => !isControl(r)).map((r) => r.directive))],
    controlEvents: events.filter(isControl).length,
  };
}

function networkFacts(records, servers) {
  const requests = records.filter((r) => r.kind === "request");
  const failed = new Map(records.filter((r) => r.kind === "failed").map((r) => [r.id, r]));
  const allowed = new Set([servers.origins.static, servers.origins.mock]);
  const origins = [...new Set(requests.map((r) => new URL(r.url).origin))];
  return {
    originsOutside: origins.filter((o) => !allowed.has(o)),
    unblockedOutside: requests
      .filter((r) => !allowed.has(new URL(r.url).origin) && !r.url.startsWith("data:"))
      .filter((r) => failed.get(r.id)?.blocked !== "csp")
      .map((r) => `${r.who} ${new URL(r.url).host}`),
    webSockets: records.filter((r) => r.kind === "websocket").length,
    decoyHits: servers.decoyHits.length,
    unmocked: servers.unmocked.filter((u) => u.path !== "/ping").map((u) => `${u.path} ${u.rpc}`),
    mockCalls: servers.mockLog.map((l) => `${l.path} ${l.rpc ?? ""}`.trim()),
    wasm: servers.requests.filter((r) => r.path.endsWith(".wasm")).map((r) => r.path),
  };
}

export function facts(records, servers, result) {
  return {
    ...cspFacts(records),
    ...networkFacts(records, servers),
    page: result?.facts ?? [],
    cspReports: servers.reports.length,
  };
}

const blocked = (c) => c !== undefined && c.ok === false;
const allowedCall = (c) => c !== undefined && c.ok === true;
const field = (v, type, name) => find(v.page, type)?.[name];
const is = (text, got, want) => [text, got === want];

function works(v, expected) {
  const fees = (name, want) => is(`treeFees reads ${name}`, field(v, "fees", name), `${want}`);
  return [
    is(
      "the Worker's owner hash equals the SDK value of key B",
      field(v, "init", "ownerHash"),
      expected.ownerHashHex,
    ),
    is("the replayed sync gives 0.035 SOL", field(v, "sync", "balance"), "35000000"),
    is("the sync stored 4 UTXOs", field(v, "sync", "storedUtxos"), 4),
    is("the unspent UTXOs add up to the balance", field(v, "sync", "sum"), "35000000"),
    is("blockhash reads 32 bytes", field(v, "blockhash", "blockhashHex")?.length, 64),
    is("readNonce reads the authority", field(v, "nonce", "authority"), GROUP),
    is("readNonce reads the nonce", field(v, "nonce", "nonce"), NONCE_ACCOUNT),
    is("readNonce reads the lamports", field(v, "nonce", "lamports"), "1056640"),
    fees("feePerNullifier", FEES.feePerNullifier),
    fees("appendReimbursement", FEES.appendReimbursement),
    fees("closeReimbursement", FEES.closeReimbursement),
    fees("feeBalance", FEE_BALANCE),
    is("the session survives the refusals", field(v, "after-refusals", "sync"), "35000000"),
    is("no step error", find(v.page, "step-error"), undefined),
  ];
}

function proposalCalls(v) {
  const stale = field(v, "simulate-stale", "err") ?? "";
  return [
    is("simulate answers: no error", field(v, "simulate", "err"), null),
    is("simulate answers: the compute units", field(v, "simulate", "unitsConsumed"), `${UNITS}`),
    is(
      "simulate gives a stale root as a JSON text",
      stale,
      '{"InstructionError":[1,{"Custom":7008}]}',
    ),
    is("send answers with the signature", field(v, "send", "signature"), SIGNATURE),
    is("confirm answers: confirmed", field(v, "confirm", "status"), "confirmed"),
  ];
}

const REFUSALS = [
  ["initWithSolSeed", "not allowed"],
  ["initWithKeyPackage", "not allowed"],
  ["syncWithArgument", "not allowed"],
  ["unknownCommand", "unknown command"],
  // The move of the old wallet takes whole UTXOs of the tree of the client, and the replayed
  // notes of B are in none that it can spend, so the Worker stops before any proof.
  ["prepareWithoutProof", "the group key holds no private SOL to move"],
];

function refusals(v) {
  const text = (name) => find(v.page, "refusal", (f) => f.name === name)?.error ?? "";
  const redaction = find(v.page, "redaction");
  return [
    ...REFUSALS.map(([name, part]) => [`${name} is refused`, text(name).includes(part)]),
    is("the RPC error with the URL and key fails the command", redaction?.failed, true),
    is("the page does not see that URL or key", redaction?.leaked, false),
  ];
}

const PAGE_BLOCKED = ["eval", "fetchDecoy", "importDecoy"];
const WORKER_BLOCKED = ["eval", "newFunction", "fetchDecoy", "importDecoy", "fetchOther"];

function boundControls(v, { pageMock, workerMock }) {
  const p = (name) => control(v.page, "page", name);
  const w = (name) => control(v.page, "control-worker", name);
  const mockCall = (who, call, open) => [
    `${who} fetch of the mock host is ${open ? "allowed" : "blocked"}`,
    open ? allowedCall(call) : blocked(call),
  ];
  // One CSP event per blocked control: the fixed ones plus the mock fetch when it is blocked.
  const total = PAGE_BLOCKED.length + WORKER_BLOCKED.length;
  const events = total + Number(!pageMock) + Number(!workerMock);
  return [
    [
      "page controls are blocked: eval, decoy fetch, decoy import",
      PAGE_BLOCKED.every((n) => blocked(p(n))),
    ],
    [
      "Worker controls are blocked: eval, new Function, decoy, other host",
      WORKER_BLOCKED.every((n) => blocked(w(n))),
    ],
    mockCall("page", p("fetchMock"), pageMock),
    mockCall("Worker", w("fetchMock"), workerMock),
    is(`every blocked control raised one CSP event (${events})`, v.controlEvents, events),
    is("the decoy saw no request", v.decoyHits, 0),
  ];
}

const clean = (v) => [
  is("no CSP violation from the Worker or the bundle", v.product.length, 0),
  is("no request to another origin that CSP let through", v.unblockedOutside.length, 0),
  is("no WebSocket", v.webSockets, 0),
  is("no unmocked call", v.unmocked.length, 0),
];

const full = (v, expected, opts) => [
  ...clean(v),
  ...works(v, expected),
  ...proposalCalls(v),
  ...refusals(v),
  ...boundControls(v, opts),
];
const open = (v, e) => full(v, e, { pageMock: true, workerMock: true });

/** What each scenario must show: [description, ok] pairs. */
const EXPECT = {
  strict: open,
  "strict-unminified": open,
  "zigs+mock": open,
  product: (v, e) => full(v, e, { pageMock: false, workerMock: true }),
  "page-only": (v) => [
    ["the control Worker is not bound by a page-only CSP (the P3b finding)", v.decoyHits > 0],
    is("the product Worker still works", field(v, "sync", "balance"), "35000000"),
    is("no CSP event from the Worker", v.product.length, 0),
  ],
  "no-wasm-eval": (v) => [
    is("the hasher cannot start without wasm-unsafe-eval", find(v.page, "init"), undefined),
    is("only script-src is violated", v.productDirectives.join(), "script-src"),
  ],
  zigs: (v) => [
    ["under the page policy the Worker reaches the hasher", find(v.page, "init") !== undefined],
    is(
      "its sync is blocked: only connect-src is violated",
      v.productDirectives.join(),
      "connect-src",
    ),
    is("no sync result", find(v.page, "sync"), undefined),
  ],
};

export function expectations(name, v, expected) {
  if (!Object.hasOwn(EXPECT, name)) throw new Error(`no expectations for scenario ${name}`);
  return EXPECT[name](v, expected);
}
